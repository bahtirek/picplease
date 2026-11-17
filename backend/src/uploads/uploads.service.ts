import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import { type Photo, PhotosRepository } from '../database/photos.repository';
import { R2_CLIENT, type R2Client } from '../database/r2.client';
import { buildKey } from '../database/r2-key';
import { EVENT_BUS, type EventBus } from '../eventbus';
import { isTerminal, stateErrorCode } from '../sessions/session-state';
import { SessionsService } from '../sessions/sessions.service';
import { MODERATION_HOOK, type ModerationHook } from './moderation.hook';
import { checkObject } from './upload-limits';
import { photoEvent } from './upload.events';
import {
  CONFIRM_STATES,
  MAX_IN_FLIGHT,
  UPLOAD_URL_TTL_SECONDS,
  type UploadContentType,
} from './uploads.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IssuedUpload {
  photoId: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ConfirmedUpload {
  photoId: string;
  status: 'uploaded';
}

/** What reconcileStale did with a photo. */
export type ReconcileResult = 'promoted' | 'discarded' | 'deleted' | 'skipped';

type VerifyResult =
  | { kind: 'promoted'; photo: Photo }
  | { kind: 'already' }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: string }
  | { kind: 'state' };

/**
 * Upload slots, signed PUT URLs and confirmation. Photo bytes go phone -> R2 directly;
 * the API only signs and checks with `head`.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly photos: PhotosRepository,
    private readonly sessions: SessionsService,
    private readonly database: DatabaseService,
    @Inject(R2_CLIENT) private readonly r2: R2Client,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(MODERATION_HOOK) private readonly moderation: ModerationHook,
  ) {}

  /** Session must be claimed and have fewer than 5 photos in flight. */
  async issueUploadUrl(sessionId: string, contentType: UploadContentType): Promise<IssuedUpload> {
    const photoId = randomUUID();
    const r2Key = buildKey(sessionId, photoId);
    const photo = await this.photos.reserveIfUnderLimit(
      { photoId, sessionId, r2Key, contentType, ttlSeconds: UPLOAD_URL_TTL_SECONDS },
      MAX_IN_FLIGHT,
    );
    if (!photo) {
      const { state } = await this.sessions.getStatus(sessionId);
      if (state === 'claimed') throw new AppError('UPLOAD_LIMIT_REACHED');
      throw new AppError(stateErrorCode(state));
    }

    let signed;
    try {
      signed = await this.r2.signUpload(r2Key, contentType, UPLOAD_URL_TTL_SECONDS);
    } catch (err) {
      // Give the slot back; nothing can have been uploaded without a URL.
      await this.photos.discardPending(photoId);
      throw err;
    }
    await this.sessions.touchActivity(sessionId);
    return {
      photoId,
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /**
   * Helper confirms an upload. Idempotent: a second call succeeds without a second event.
   * Missing object: refused, the photo stays pending so the helper can retry. Wrong size
   * or type: the object and the photo are discarded.
   */
  async confirmUpload(sessionId: string, photoId: string): Promise<ConfirmedUpload> {
    if (!UUID.test(photoId)) throw new AppError('NOT_FOUND');
    const photo = await this.photos.findById(photoId.toLowerCase());
    if (photo?.sessionId !== sessionId) throw new AppError('NOT_FOUND');

    const { state } = await this.sessions.getStatus(sessionId);
    if (!CONFIRM_STATES.includes(state)) {
      // A late upload on an ended session is deleted, never promoted.
      if (isTerminal(state)) await this.discard(photo, true);
      throw new AppError(stateErrorCode(state));
    }

    const result = await this.verifyAndPromote(photo);
    switch (result.kind) {
      case 'promoted':
      case 'already':
        await this.sessions.touchActivity(sessionId);
        return { photoId: photo.id, status: 'uploaded' };
      case 'missing':
        throw new AppError('INVALID_REQUEST', 'Photo was not uploaded');
      case 'refused':
        throw new AppError('INVALID_REQUEST', result.reason);
      case 'state': {
        // The session moved on between the checks above and the update.
        const now = await this.sessions.getStatus(sessionId);
        if (isTerminal(now.state)) await this.discard(photo, true);
        throw new AppError(stateErrorCode(now.state));
      }
    }
  }

  /**
   * Called by Jobs for a pending photo whose upload URL has expired; no helper token.
   * Terminal session: deletes the object and the photo. Otherwise the same check as
   * confirm: promote if the object is fine, else discard (publishing photo.discarded).
   */
  async reconcileStale(photoId: string): Promise<ReconcileResult> {
    const photo = await this.photos.findById(photoId);
    if (photo?.status !== 'pending') return 'skipped';

    let state;
    try {
      ({ state } = await this.sessions.getStatus(photo.sessionId));
    } catch {
      return 'skipped'; // Session purged; its photos went with it.
    }
    if (isTerminal(state)) {
      await this.discard(photo, true);
      return 'deleted';
    }

    const result = await this.verifyAndPromote(photo);
    switch (result.kind) {
      case 'promoted':
        return 'promoted';
      case 'already':
        return 'skipped';
      case 'missing':
        await this.discard(photo, false);
        return 'discarded';
      case 'refused':
        return 'discarded';
      case 'state':
        await this.discard(photo, true);
        return 'deleted';
    }
  }

  /**
   * Head check, moderation, then pending -> uploaded with photo.uploaded in the same
   * transaction. A refused object is deleted and the photo discarded.
   */
  private async verifyAndPromote(photo: Photo): Promise<VerifyResult> {
    if (photo.status === 'uploaded') return { kind: 'already' };

    const info = await this.r2.head(photo.r2Key);
    if (!info) return { kind: 'missing' };

    let reason = checkObject(info, photo);
    if (!reason) {
      const allowed = await this.moderation.review({
        sessionId: photo.sessionId,
        photoId: photo.id,
        key: photo.r2Key,
        sizeBytes: info.size,
        contentType: photo.contentType,
      });
      if (!allowed) reason = 'Photo was refused';
    }
    if (reason) {
      await this.discard(photo, true);
      return { kind: 'refused', reason };
    }

    const promoted = await this.database.transaction(async (tx) => {
      const row = await this.photos.markUploaded(photo.id, info.size, CONFIRM_STATES, tx);
      if (row) await this.bus.publish('photo.uploaded', photoEvent(row.sessionId, row.id), tx);
      return row;
    });
    if (promoted) return { kind: 'promoted', photo: promoted };

    // Lost a race: a concurrent confirm promoted it, it was discarded, or the state moved.
    const current = await this.photos.findById(photo.id);
    if (current?.status === 'uploaded') return { kind: 'already' };
    if (!current) throw new AppError('NOT_FOUND');
    return { kind: 'state' };
  }

  /** Removes a pending photo (and optionally its object) and publishes photo.discarded. */
  private async discard(photo: Photo, deleteObject: boolean): Promise<void> {
    // Object first: if the row went first and the delete failed, nothing would find it again.
    if (deleteObject) await this.r2.delete(photo.r2Key);
    await this.database.transaction(async (tx) => {
      const row = await this.photos.discardPending(photo.id, tx);
      if (row) await this.bus.publish('photo.discarded', photoEvent(row.sessionId, row.id), tx);
    });
  }
}
