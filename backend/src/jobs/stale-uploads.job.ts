import { Injectable } from '@nestjs/common';
import { PhotosRepository } from '../database/photos.repository';
import { UploadsService } from '../uploads/uploads.service';
import type { ReconcileResult } from '../uploads/uploads.service';
import { STALE_UPLOAD_MARGIN_SECONDS, SWEEP_BATCH } from './jobs.constants';

/**
 * Runs every minute: settles pending photos whose upload URL has expired (promote, discard,
 * or delete a late object of a terminal session). One batch per run, because a photo
 * reconcileStale skips stays pending and would be picked again.
 */
@Injectable()
export class StaleUploadsJob {
  constructor(
    private readonly photos: PhotosRepository,
    private readonly uploads: UploadsService,
  ) {}

  async run(): Promise<ReconcileResult[]> {
    const stale = await this.photos.findStalePending(STALE_UPLOAD_MARGIN_SECONDS, SWEEP_BATCH);
    const results: ReconcileResult[] = [];
    for (const photo of stale) results.push(await this.uploads.reconcileStale(photo.id));
    return results;
  }
}
