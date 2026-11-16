/** Limits sent to clients in create and claim responses (docs/backend/decisions.md). */
export const SESSION_LIMITS = {
  maxInFlight: 5,
  maxPhotoBytes: 5 * 1024 * 1024,
  uploadUrlTtlSeconds: 10 * 60,
} as const;

export type SessionLimits = typeof SESSION_LIMITS;

/** A pending session expires this long after creation. */
export const SESSION_TTL_SECONDS = 5 * 60;

/** Grace finish requests are capped at this many seconds. */
export const MAX_GRACE_SECONDS = 30;

/** QR link: {LINK_BASE_URL}/s/{sessionId}?t={pairingSecret} */
export function buildSessionLink(baseUrl: string, sessionId: string, secret: string): string {
  return `${baseUrl}/s/${sessionId}?t=${encodeURIComponent(secret)}`;
}
