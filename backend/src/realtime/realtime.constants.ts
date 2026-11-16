/** WebSocket path, from docs/backend/protocol-and-events.md. */
export const WS_PATH = '/ws';

/** Close codes from the protocol. Clients must not retry after SESSION_GONE. */
export const WS_CLOSE = {
  /** No valid auth message within the time limit, or a bad token. */
  UNAUTHORIZED: 4401,
  /** The session is expired, revoked or closed. */
  SESSION_GONE: 4410,
} as const;

/** The first message must arrive within this time. */
export const AUTH_TIMEOUT_MS = 5_000;

/** The server pings this often; a client that has not answered the previous ping is dropped. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Clients only ever send the small auth message. */
export const MAX_CLIENT_MESSAGE_BYTES = 4_096;
