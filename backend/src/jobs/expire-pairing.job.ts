import { Injectable } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';

/**
 * Fires when a pending session's pairing time ends. Does nothing if it was claimed. Only
 * tidies state: claimSession checks the expiry timestamp itself.
 */
@Injectable()
export class ExpirePairingJob {
  constructor(private readonly sessions: SessionsService) {}

  run(sessionId: string): Promise<boolean> {
    return this.sessions.expirePending(sessionId);
  }
}
