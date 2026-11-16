import { Injectable } from '@nestjs/common';
import type { R2Key } from '../database/r2-key';

export interface ModerationInput {
  sessionId: string;
  photoId: string;
  key: R2Key;
  sizeBytes: number;
  contentType: string;
}

/**
 * Undecided (docs/backend/modules/uploads.md): a step between the head check and
 * photo.uploaded. Returning false treats the photo like a failed check.
 */
export interface ModerationHook {
  review(photo: ModerationInput): Promise<boolean>;
}

export const MODERATION_HOOK = Symbol('MODERATION_HOOK');

/** Default: allows everything. */
@Injectable()
export class NoopModeration implements ModerationHook {
  review(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
