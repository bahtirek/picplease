import type { EventPayload } from '../eventbus';

/** Payload of photo.acknowledged. IDs only. */
export function acknowledgedEvent(sessionId: string, photoId: string): EventPayload {
  return { sessionId, photoId };
}

/** Payload of delivery.window-closed. */
export function windowClosedEvent(sessionId: string, delivered: number): EventPayload {
  return { sessionId, delivered };
}
