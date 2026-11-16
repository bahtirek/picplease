/**
 * R2 object keys. A key is built by the server only, from IDs the server generated:
 * `sessions/{sessionId}/{photoId}.jpg`. Every R2 client method checks the key again,
 * so a string that came from a request can never reach the bucket.
 */
declare const r2KeyBrand: unique symbol;
export type R2Key = string & { readonly [r2KeyBrand]: true };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const KEY_PATTERN = new RegExp(`^sessions/${UUID}/${UUID}\\.jpg$`);

export class InvalidR2KeyError extends Error {
  constructor() {
    // The offending value is left out on purpose: it may have come from a client.
    super('Invalid R2 object key');
    this.name = 'InvalidR2KeyError';
  }
}

/** Both IDs must be lowercase UUIDs, as Postgres returns them. */
export function buildKey(sessionId: string, photoId: string): R2Key {
  if (!UUID_PATTERN.test(sessionId) || !UUID_PATTERN.test(photoId)) {
    throw new InvalidR2KeyError();
  }
  return `sessions/${sessionId}/${photoId}.jpg` as R2Key;
}

export function isR2Key(value: unknown): value is R2Key {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

export function assertR2Key(value: unknown): asserts value is R2Key {
  if (!isR2Key(value)) throw new InvalidR2KeyError();
}
