import type { EventPayload } from '../eventbus';

/** Payloads Sessions publishes. IDs and small scalars only. */
export function sessionEvent(sessionId: string): EventPayload {
  return { sessionId };
}

export function finishRequestedEvent(sessionId: string, graceSeconds: number): EventPayload {
  return { sessionId, graceSeconds };
}
