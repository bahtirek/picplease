import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import {
  type Session,
  type SessionState,
  SessionsRepository,
} from '../database/sessions.repository';
import type { AuthContext, AuthenticatedRequest, SessionRole } from './auth-context';
import { TokenService } from './token.service';

const BEARER = /^Bearer ([^\s]+)$/i;

/** Header first; the web beacon cannot set headers, so it may send `{ token }` in the body. */
export function readToken(request: AuthenticatedRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.length > 0) {
    return BEARER.exec(header.trim())?.[1] ?? null;
  }
  const body: unknown = request.body;
  if (typeof body === 'object' && body !== null && 'token' in body) {
    const { token } = body;
    if (typeof token === 'string' && token.length > 0) return token;
  }
  return null;
}

/**
 * Shared check for both guards: read the token, load its session, verify the hash for the
 * role, check the state, attach {sessionId, role}. Every failure is the same UNAUTHORIZED,
 * so a wrong token and an unknown session look identical.
 */
// Decorated here so Nest finds the constructor's parameter types from the subclasses.
@Injectable()
export abstract class SessionTokenGuard implements CanActivate {
  protected abstract readonly role: SessionRole;
  /** States in which this role's token is accepted. Per-route rules live in Sessions. */
  protected abstract readonly allowedStates: ReadonlySet<SessionState>;
  protected abstract storedHash(session: Session): string | null;

  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readToken(request);
    const parsed = token === null ? null : this.tokens.parse(token);
    if (token === null || parsed === null) throw new AppError('UNAUTHORIZED');

    // A token for session A must not open routes of session B.
    const routeId = (request.params as Record<string, string | undefined> | undefined)?.id;
    if (routeId !== undefined && routeId.toLowerCase() !== parsed.sessionId) {
      throw new AppError('UNAUTHORIZED');
    }

    const session = await this.sessions.findById(parsed.sessionId);
    // verify() runs even for an unknown session so both paths do the same work.
    const matches = this.tokens.verify(parsed.random, session ? this.storedHash(session) : null);
    if (!session || !matches || !this.allowedStates.has(session.state)) {
      throw new AppError('UNAUTHORIZED');
    }

    const auth: AuthContext = { sessionId: session.id, role: this.role };
    request.auth = auth;
    return true;
  }
}
