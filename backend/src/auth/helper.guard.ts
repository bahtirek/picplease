import { Injectable } from '@nestjs/common';
import type { Session, SessionState } from '../database/sessions.repository';
import type { SessionRole } from './auth-context';
import { SessionTokenGuard } from './session-token.guard';

/** The helper token only exists once the session is claimed, and dies with it. */
const HELPER_STATES: ReadonlySet<SessionState> = new Set(['claimed', 'finished']);

@Injectable()
export class HelperGuard extends SessionTokenGuard {
  protected readonly role: SessionRole = 'helper';
  protected readonly allowedStates = HELPER_STATES;

  protected storedHash(session: Session): string | null {
    return session.helperTokenHash;
  }
}
