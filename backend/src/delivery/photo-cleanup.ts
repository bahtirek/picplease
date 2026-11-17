import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Photo, PhotosRepository } from '../database/photos.repository';
import { R2_CLIENT, type R2Client } from '../database/r2.client';
import type { R2Key } from '../database/r2-key';

export interface CleanupResult {
  deleted: number;
  failed: number;
}

type PhotoObject = Pick<Photo, 'id' | 'r2Key'>;

/**
 * Deletes photo objects from R2 and records it on the row (`object_deleted_at`). A failed
 * delete leaves the row unmarked so the 48 hour sweep finds it again.
 */
@Injectable()
export class PhotoCleanup {
  private readonly logger = new Logger(PhotoCleanup.name);

  constructor(
    private readonly photos: PhotosRepository,
    @Inject(R2_CLIENT) private readonly r2: R2Client,
  ) {}

  /** After an acknowledgement. Never throws: the photo is already saved on the phone. */
  async deleteAfterAck(photo: PhotoObject): Promise<boolean> {
    try {
      await this.r2.delete(photo.r2Key);
      await this.photos.markObjectsDeleted([photo.id]);
      return true;
    } catch (err) {
      this.logger.warn(`Delete after ack failed for photo ${photo.id}: ${message(err)}`);
      return false;
    }
  }

  /** Batch delete (the 48 hour sweep). Marks only the objects R2 confirmed. */
  async deleteMany(photos: readonly PhotoObject[]): Promise<CleanupResult> {
    if (photos.length === 0) return { deleted: 0, failed: 0 };
    let refused: ReadonlySet<R2Key>;
    try {
      const result = await this.r2.deleteMany(photos.map((p) => p.r2Key));
      refused = new Set(result.failed);
    } catch (err) {
      this.logger.warn(`Batch delete of ${String(photos.length)} objects failed: ${message(err)}`);
      return { deleted: 0, failed: photos.length };
    }
    const done = photos.filter((p) => !refused.has(p.r2Key)).map((p) => p.id);
    await this.photos.markObjectsDeleted(done);
    return { deleted: done.length, failed: photos.length - done.length };
  }

  /**
   * On revoke: deletes the objects of uploaded photos not yet downloaded. Downloaded photos
   * are left alone. Pending photos are left to the stale-upload job, which deletes them
   * when the session is terminal, so a late upload never leaves an object without a row.
   */
  async deleteUndelivered(sessionId: string): Promise<CleanupResult> {
    return this.deleteMany(await this.photos.listPending(sessionId));
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
