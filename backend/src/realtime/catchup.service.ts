import { Inject, Injectable } from '@nestjs/common';
import type { SessionRole } from '../auth';
import { type SessionStatus, SessionsService } from '../sessions/sessions.service';

/** A photo the requester has not saved yet. Filled in by Delivery (slice 8). */
export interface PendingPhoto {
  photoId: string;
}

/** Where the requester's pending photos come from. Delivery provides it in slice 8. */
export interface PendingPhotosSource {
  listPending(sessionId: string): Promise<PendingPhoto[]>;
}

export const PENDING_PHOTOS_SOURCE = Symbol('PENDING_PHOTOS_SOURCE');

/** Until Delivery exists there are no photos. */
export const noPendingPhotos: PendingPhotosSource = {
  listPending: () => Promise.resolve([]),
};

export interface Snapshot {
  role: SessionRole;
  session: SessionStatus;
  /** Requester only. */
  pendingPhotos?: PendingPhoto[];
}

/** Builds the `snapshot` message sent right after auth and after every reconnect. */
@Injectable()
export class CatchupService {
  constructor(
    private readonly sessions: SessionsService,
    @Inject(PENDING_PHOTOS_SOURCE) private readonly photos: PendingPhotosSource,
  ) {}

  async buildSnapshot(sessionId: string, role: SessionRole): Promise<Snapshot> {
    const session = await this.sessions.getStatus(sessionId);
    if (role === 'helper') return { role, session };
    return { role, session, pendingPhotos: await this.photos.listPending(sessionId) };
  }
}
