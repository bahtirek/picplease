import { Injectable } from '@nestjs/common';
import { PhotosRepository } from '../database/photos.repository';
import { SessionsRepository } from '../database/sessions.repository';
import { PhotoCleanup } from '../delivery/photo-cleanup';
import { CLEANUP_BATCH, MAX_BATCHES, RETENTION_SECONDS } from './jobs.constants';

export interface HardDeleteResult {
  objectsDeleted: number;
  objectsFailed: number;
  sessionsPurged: number;
}

/**
 * Every 15 minutes: deletes R2 objects of photos that were downloaded or are older than 48
 * hours, then deletes session rows older than 48 hours (photos and devices cascade). A
 * session keeps its row while any of its objects failed to delete, so the next run retries.
 */
@Injectable()
export class HardDeleteJob {
  constructor(
    private readonly photos: PhotosRepository,
    private readonly sessions: SessionsRepository,
    private readonly cleanup: PhotoCleanup,
  ) {}

  async run(): Promise<HardDeleteResult> {
    let objectsDeleted = 0;
    let objectsFailed = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const due = await this.photos.findForObjectCleanup(RETENTION_SECONDS, CLEANUP_BATCH);
      const result = await this.cleanup.deleteMany(due);
      objectsDeleted += result.deleted;
      objectsFailed += result.failed;
      // Stop on a short batch, or when R2 refused everything (the same rows would come back).
      if (due.length < CLEANUP_BATCH || result.deleted === 0) break;
    }
    const sessionsPurged = await this.sessions.purgeSettled(RETENTION_SECONDS);
    return { objectsDeleted, objectsFailed, sessionsPurged };
  }
}
