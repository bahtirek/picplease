import type { EventPayload } from '../eventbus';

/** Payload of photo.uploaded and photo.discarded. IDs only. */
export function photoEvent(sessionId: string, photoId: string): EventPayload {
  return { sessionId, photoId };
}
