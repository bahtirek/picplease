import type { Photo } from '../database/photos.repository';
import type { ObjectInfo } from '../database/r2.client';
import { MAX_PHOTO_BYTES } from './uploads.constants';

/**
 * The real size and type check, done with `head` after upload: R2 cannot pin a size
 * range on a signed PUT. Returns why the object is refused, or null when it is fine.
 */
export function checkObject(
  info: ObjectInfo,
  photo: Photo,
  maxBytes = MAX_PHOTO_BYTES,
): string | null {
  if (info.size <= 0) return 'Photo is empty';
  if (info.size > maxBytes) return 'Photo is too large';
  if (info.contentType !== photo.contentType) return 'Photo has the wrong content type';
  return null;
}

/** Undecided placeholder (docs/open-items.md): a cap on photos over a session's lifetime. Allows everything. */
export function checkLifetimeCap(): void {
  // Intentionally empty until the owner decides the cap.
}
