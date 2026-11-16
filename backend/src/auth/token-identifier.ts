import { Injectable } from '@nestjs/common';
import { type SessionState, SessionsRepository } from '../database/sessions.repository';
import type { SessionRole } from './auth-context';
import { TokenService } from './token.service';

export interface IdentifiedToken {
  sessionId: string;
  role: SessionRole;
  /** The session's current state. Callers apply their own state rules. */
  state: SessionState;
}

/**
 * Finds which session and role a token belongs to, in any state. For callers without an
 * HTTP request (the WebSocket handshake). Returns null for a malformed token, an unknown
 * session or a hash that matches neither role, so all three look identical.
 */
@Injectable()
export class TokenIdentifier {
  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionsRepository,
  ) {}

  async identify(token: string): Promise<IdentifiedToken | null> {
    const parsed = this.tokens.parse(token);
    if (parsed === null) return null;
    const session = await this.sessions.findById(parsed.sessionId);
    // Both checks always run so every path does the same work.
    const isRequester = this.tokens.verify(parsed.random, session?.requesterTokenHash);
    const isHelper = this.tokens.verify(parsed.random, session?.helperTokenHash);
    if (!session || (!isRequester && !isHelper)) return null;
    return {
      sessionId: session.id,
      role: isRequester ? 'requester' : 'helper',
      state: session.state,
    };
  }
}
