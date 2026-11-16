import { Injectable } from '@nestjs/common';
import type { Session, SessionState } from '../database/sessions.repository';
import type { SessionRole } from './auth-context';
import { SessionTokenGuard } from './session-token.guard';

/** The requester may always read their own session, including revoked, expired and closed. */
const REQUESTER_STATES: ReadonlySet<SessionState> = new Set([
  'pending',
  'claimed',
  'finished',
  'revoked',
  'expired',
  'closed',
]);

@Injectable()
export class RequesterGuard extends SessionTokenGuard {
  protected readonly role: SessionRole = 'requester';
  protected readonly allowedStates = REQUESTER_STATES;

  protected storedHash(session: Session): string {
    return session.requesterTokenHash;
  }
}
