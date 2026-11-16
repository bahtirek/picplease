import { Injectable } from '@nestjs/common';
import { type AuthContext, TokenIdentifier } from '../auth';
import type { SessionState } from '../database/sessions.repository';
import { WS_CLOSE } from './realtime.constants';

export type WsAuthResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; closeCode: (typeof WS_CLOSE)[keyof typeof WS_CLOSE] };

/** A session in one of these states is over; the client gets 4410 and must not retry. */
const GONE_STATES: ReadonlySet<SessionState> = new Set(['expired', 'revoked', 'closed']);

/**
 * Checks the first WebSocket message, `{ "type": "auth", "token": "..." }`. A malformed
 * message or a token that matches no session is 4401; a valid token for a session that is
 * over is 4410.
 */
@Injectable()
export class WsAuthGuard {
  constructor(private readonly identifier: TokenIdentifier) {}

  async authenticate(raw: string): Promise<WsAuthResult> {
    const token = readAuthToken(raw);
    const found = token === null ? null : await this.identifier.identify(token);
    if (found === null) return { ok: false, closeCode: WS_CLOSE.UNAUTHORIZED };
    if (GONE_STATES.has(found.state)) return { ok: false, closeCode: WS_CLOSE.SESSION_GONE };
    return { ok: true, auth: { sessionId: found.sessionId, role: found.role } };
  }
}

function readAuthToken(raw: string): string | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null) return null;
  const { type, token } = message as Record<string, unknown>;
  if (type !== 'auth' || typeof token !== 'string' || token.length === 0) return null;
  return token;
}
