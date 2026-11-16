import type { SessionState } from '../database/sessions.repository';
import { SESSION_LIMITS } from '../sessions/sessions.constants';

/** Owner decision (slice 7b): JPEG only. Keys end in .jpg. */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg'] as const;
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

export const MAX_IN_FLIGHT = SESSION_LIMITS.maxInFlight;
export const MAX_PHOTO_BYTES = SESSION_LIMITS.maxPhotoBytes;
export const UPLOAD_URL_TTL_SECONDS = SESSION_LIMITS.uploadUrlTtlSeconds;

/** States in which a pending photo may still be confirmed (api-contract.md). */
export const CONFIRM_STATES: readonly SessionState[] = ['claimed', 'finished'];
