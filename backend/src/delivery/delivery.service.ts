import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import { type Photo, PhotosRepository } from '../database/photos.repository';
import { R2_CLIENT, type R2Client } from '../database/r2.client';
import type { SessionState } from '../database/sessions.repository';
import { EVENT_BUS, type EventBus } from '../eventbus';
import { isTerminal, stateErrorCode } from '../sessions/session-state';
import { SessionsService } from '../sessions/sessions.service';
import { DELIVERY_STATES, DOWNLOAD_URL_TTL_SECONDS } from './delivery.constants';
import { acknowledgedEvent, windowClosedEvent } from './delivery.events';
import { isClosable, loadWindowState } from './delivery-window';
import { PhotoCleanup } from './photo-cleanup';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PendingPhotoItem {
  photoId: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface PendingList {
  state: SessionState;
  photos: PendingPhotoItem[];
}

export interface DownloadUrl {
  photoId: string;
  url: string;
  expiresAt: string;
}

export interface Acknowledged {
  photoId: string;
  status: 'downloaded';
}

/**
 * Getting photos to the requester: list, signed GET URL, acknowledge. Photo bytes go
 * R2 -> phone directly. Also decides when the delivery window closes.
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly photos: PhotosRepository,
    private readonly sessions: SessionsService,
    private readonly database: DatabaseService,
    private readonly cleanup: PhotoCleanup,
    @Inject(R2_CLIENT) private readonly r2: R2Client,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  /** Uploaded photos not yet saved, oldest first. Refused once the session has ended. */
  async listPending(sessionId: string): Promise<PendingList> {
    const { state } = await this.sessions.getStatus(sessionId);
    if (isTerminal(state)) throw new AppError(stateErrorCode(state));
    const photos = await this.photos.listPending(sessionId);
    return { state, photos: photos.map(toItem) };
  }

  /** Signed GET URL for an uploaded photo of this session. Marks nothing. */
  async getDownloadUrl(sessionId: string, photoId: string): Promise<DownloadUrl> {
    const photo = await this.ownPhoto(sessionId, photoId);
    await this.assertDeliveryState(sessionId);
    if (photo.status !== 'uploaded') throw new AppError('INVALID_REQUEST', 'Photo is not uploaded');
    // Already saved, or its object is gone: nothing left to download.
    if (photo.downloadedAt || photo.objectDeletedAt) throw new AppError('NOT_FOUND');
    const signed = await this.r2.signDownload(photo.r2Key, DOWNLOAD_URL_TTL_SECONDS);
    return { photoId: photo.id, url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  /**
   * Marks the photo downloaded (publishing photo.acknowledged in the same transaction),
   * then deletes the object. Idempotent: an already acknowledged photo answers the same in
   * any session state (owner decision, slice 7c) and retries a delete that failed before.
   */
  async acknowledge(sessionId: string, photoId: string): Promise<Acknowledged> {
    const photo = await this.ownPhoto(sessionId, photoId);
    const done: Acknowledged = { photoId: photo.id, status: 'downloaded' };
    if (photo.downloadedAt) {
      if (!photo.objectDeletedAt) await this.cleanup.deleteAfterAck(photo);
      return done;
    }
    if (photo.status !== 'uploaded') throw new AppError('INVALID_REQUEST', 'Photo is not uploaded');

    const marked = await this.database.transaction(async (tx) => {
      const row = await this.photos.markDownloaded(photo.id, sessionId, DELIVERY_STATES, tx);
      if (row)
        await this.bus.publish('photo.acknowledged', acknowledgedEvent(sessionId, row.id), tx);
      return row;
    });
    if (!marked) {
      // A concurrent ack won (harmless), or the session moved to a state that refuses it.
      const current = await this.photos.findById(photo.id);
      if (current?.downloadedAt) return done;
      await this.assertDeliveryState(sessionId);
      throw new AppError('NOT_FOUND');
    }
    await this.cleanup.deleteAfterAck(marked);
    return done;
  }

  /**
   * Closes the delivery window if it is closable: finished -> closed, then
   * delivery.window-closed with the delivered count. Returns whether it closed now.
   */
  async evaluateWindow(sessionId: string): Promise<boolean> {
    const state = await loadWindowState(this.photos, sessionId);
    if (!state || !isClosable(state)) return false;
    if (!(await this.sessions.markClosed(sessionId))) return false;
    await this.bus.publish('delivery.window-closed', windowClosedEvent(sessionId, state.delivered));
    return true;
  }

  /** On revoke: deletes the objects of photos that were not downloaded. */
  async deleteUndelivered(sessionId: string): Promise<void> {
    await this.cleanup.deleteUndelivered(sessionId);
  }

  private async ownPhoto(sessionId: string, photoId: string): Promise<Photo> {
    if (!UUID.test(photoId)) throw new AppError('NOT_FOUND');
    const photo = await this.photos.findById(photoId.toLowerCase());
    if (photo?.sessionId !== sessionId) throw new AppError('NOT_FOUND');
    return photo;
  }

  private async assertDeliveryState(sessionId: string): Promise<void> {
    const { state } = await this.sessions.getStatus(sessionId);
    if (!DELIVERY_STATES.includes(state)) throw new AppError(stateErrorCode(state));
  }
}

function toItem(photo: Photo): PendingPhotoItem {
  return {
    photoId: photo.id,
    sizeBytes: photo.sizeBytes ?? 0,
    uploadedAt: (photo.uploadedAt ?? photo.createdAt).toISOString(),
  };
}
