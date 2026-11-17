import { Injectable } from '@nestjs/common';
import { SessionsRepository } from '../database/sessions.repository';
import { SessionsService } from '../sessions/sessions.service';
import { IDLE_FINISH_SECONDS, MAX_BATCHES, SWEEP_BATCH } from './jobs.constants';

/** Finishes claimed sessions: after a grace timer, or when idle for 2 minutes. */
@Injectable()
export class InactivityJob {
  constructor(
    private readonly sessions: SessionsService,
    private readonly sessionsRepo: SessionsRepository,
  ) {}

  /** The grace timer ended. Does nothing unless the session is still claimed. */
  finishAfterGrace(sessionId: string): Promise<boolean> {
    return this.sessions.markFinished(sessionId);
  }

  /** Runs every minute, so a finish lands 2 to 3 minutes after the last activity. */
  async finishIdle(): Promise<number> {
    let finished = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const ids = await this.sessionsRepo.findIdle(IDLE_FINISH_SECONDS, SWEEP_BATCH);
      for (const id of ids) {
        if (await this.sessions.markFinished(id)) finished++;
      }
      if (ids.length < SWEEP_BATCH) break;
    }
    return finished;
  }
}
