import { Injectable } from '@nestjs/common';
import type { SessionRole } from '../auth';

/**
 * Who is connected, in memory (one instance). Counts connections, so a requester with two
 * sockets stays online until both are gone.
 */
@Injectable()
export class PresenceService {
  private readonly requesters = new Map<string, number>();

  markConnected(sessionId: string, role: SessionRole): void {
    if (role !== 'requester') return;
    this.requesters.set(sessionId, (this.requesters.get(sessionId) ?? 0) + 1);
  }

  markDisconnected(sessionId: string, role: SessionRole): void {
    if (role !== 'requester') return;
    const count = (this.requesters.get(sessionId) ?? 0) - 1;
    if (count > 0) this.requesters.set(sessionId, count);
    else this.requesters.delete(sessionId);
  }

  isRequesterOnline(sessionId: string): boolean {
    return this.requesters.has(sessionId);
  }
}
