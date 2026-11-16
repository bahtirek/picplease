import { Inject, Injectable } from '@nestjs/common';
import { TokenService } from '../auth/token.service';
import { APP_CONFIG, type AppConfig } from '../common/config/config';
import { AppError } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import {
  type Session,
  SessionsRepository,
  type TransitionTarget,
} from '../database/sessions.repository';
import { EVENT_BUS, type EventBus, type EventName } from '../eventbus';
import { QrService } from './qr.service';
import { assertTransition, isTerminal, sourcesOf, stateErrorCode } from './session-state';
import { finishRequestedEvent, sessionEvent } from './session.events';
import {
  buildSessionLink,
  MAX_GRACE_SECONDS,
  SESSION_LIMITS,
  type SessionLimits,
  SESSION_TTL_SECONDS,
} from './sessions.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreatedSession {
  sessionId: string;
  link: string;
  qrPngBase64: string;
  requesterToken: string;
  expiresAt: string;
  limits: SessionLimits;
}

export interface ClaimedSession {
  sessionId: string;
  helperToken: string;
  limits: SessionLimits;
}

export interface SessionStatus {
  sessionId: string;
  state: Session['state'];
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  closedAt: string | null;
  revokedAt: string | null;
}

/** Which event each state move publishes. */
const MOVE_EVENT: Record<TransitionTarget, EventName> = {
  finished: 'session.finished',
  closed: 'session.closed',
  revoked: 'session.revoked',
  expired: 'session.expired',
};

/**
 * The session lifecycle. Every move is one conditional UPDATE; its event is published in
 * the same transaction, so it is delivered only if the move commits. Sessions never calls
 * Jobs, it only publishes events.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly database: DatabaseService,
    private readonly tokens: TokenService,
    private readonly qr: QrService,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async createSession(): Promise<CreatedSession> {
    const secret = this.tokens.generateSecret();
    const requester = this.tokens.generateToken();
    const session = await this.database.transaction(async (tx) => {
      const row = await this.sessions.create(
        {
          secretHash: this.tokens.hash(secret),
          requesterTokenHash: requester.hash,
          ttlSeconds: SESSION_TTL_SECONDS,
        },
        tx,
      );
      await this.bus.publish('session.created', sessionEvent(row.id), tx);
      return row;
    });
    // Rendered after commit so no transaction stays open during CPU work. If it fails,
    // the unused session simply expires.
    const link = buildSessionLink(this.config.linkBaseUrl, session.id, secret);
    const png = await this.qr.renderPng(link);
    return {
      sessionId: session.id,
      link,
      qrPngBase64: png.toString('base64'),
      requesterToken: this.tokens.format(session.id, requester.random),
      expiresAt: session.expiresAt.toISOString(),
      limits: SESSION_LIMITS,
    };
  }

  /**
   * One conditional UPDATE (pending, not expired, secret matches), so exactly one claim
   * wins. On failure: wrong secret or unknown id is NOT_FOUND (identical on purpose);
   * claimed or finished is ALREADY_CLAIMED; expired, revoked or closed is SESSION_GONE.
   */
  async claimSession(id: string, secret: string): Promise<ClaimedSession> {
    if (!UUID.test(id)) throw new AppError('NOT_FOUND');
    const sessionId = id.toLowerCase();
    const helper = this.tokens.generateToken();

    const claimed = await this.database.transaction(async (tx) => {
      const row = await this.sessions.claimIfPending(
        sessionId,
        helper.hash,
        tx,
        this.tokens.hash(secret),
      );
      if (row) await this.bus.publish('session.claimed', sessionEvent(row.id), tx);
      return row;
    });
    if (claimed) {
      return {
        sessionId: claimed.id,
        helperToken: this.tokens.format(claimed.id, helper.random),
        limits: SESSION_LIMITS,
      };
    }

    const session = await this.sessions.findById(sessionId);
    const secretOk = this.tokens.verify(secret, session?.secretHash);
    if (!session || !secretOk) throw new AppError('NOT_FOUND');
    if (session.state === 'claimed' || session.state === 'finished') {
      throw new AppError('ALREADY_CLAIMED');
    }
    // Pending past its expiry time, or expired, revoked, closed.
    throw new AppError('SESSION_GONE');
  }

  async getStatus(id: string): Promise<SessionStatus> {
    const session = await this.sessions.findById(id);
    if (!session) throw new AppError('NOT_FOUND');
    return toStatus(session);
  }

  /** Requester stop: pending, claimed or finished to revoked. */
  async revokeSession(id: string): Promise<SessionStatus> {
    return toStatus(await this.moveOrThrow(id, 'revoked'));
  }

  /** Helper finish. No grace (or 0) finishes now; otherwise asks Jobs to finish later. */
  async finish(id: string, graceSeconds?: number): Promise<SessionStatus> {
    const grace = Math.min(Math.max(0, Math.floor(graceSeconds ?? 0)), MAX_GRACE_SECONDS);
    if (grace === 0) return toStatus(await this.moveOrThrow(id, 'finished'));
    return this.requestFinish(id, grace);
  }

  /** Publishes session.finish-requested; the state stays claimed until Jobs finishes it. */
  async requestFinish(id: string, graceSeconds: number): Promise<SessionStatus> {
    const session = await this.loadOrThrow(id);
    assertTransition(session.state, 'finished');
    const grace = Math.min(Math.max(1, Math.floor(graceSeconds)), MAX_GRACE_SECONDS);
    await this.bus.publish('session.finish-requested', finishRequestedEvent(session.id, grace));
    return toStatus(session);
  }

  /** Cancels a pending grace finish. Only while claimed. */
  async resume(id: string): Promise<SessionStatus> {
    const session = await this.loadOrThrow(id);
    if (session.state !== 'claimed') throw new AppError(stateErrorCode(session.state));
    await this.bus.publish('session.resumed', sessionEvent(session.id));
    return toStatus(session);
  }

  // Internal moves for other modules. They return whether the move happened, never throw
  // for a state mismatch: the caller (a timer or sweep) simply lost a race.

  /** claimed -> finished. Called by the grace timer and the idle sweep. */
  async markFinished(id: string): Promise<boolean> {
    return (await this.move(id, 'finished')) !== null;
  }

  /** pending -> expired. Called by Jobs; a claimed session is left alone. */
  async expirePending(id: string): Promise<boolean> {
    return (await this.move(id, 'expired')) !== null;
  }

  /** finished -> closed. Called by Delivery when the window closes. */
  async markClosed(id: string): Promise<boolean> {
    return (await this.move(id, 'closed')) !== null;
  }

  /** Called by Uploads. Returns false if the session does not exist. */
  touchActivity(id: string): Promise<boolean> {
    return this.sessions.touchActivity(id);
  }

  private move(id: string, to: TransitionTarget): Promise<Session | null> {
    return this.database.transaction(async (tx) => {
      const moved = await this.sessions.transition(id, sourcesOf(to), to, tx);
      if (moved) await this.bus.publish(MOVE_EVENT[to], sessionEvent(moved.id), tx);
      return moved;
    });
  }

  /** move(), but a refused move throws the error for the session's current state. */
  private async moveOrThrow(id: string, to: TransitionTarget): Promise<Session> {
    const moved = await this.move(id, to);
    if (moved) return moved;
    const current = await this.loadOrThrow(id);
    assertTransition(current.state, to);
    // The state changed back between the two reads; cannot happen with these moves.
    throw new AppError(isTerminal(current.state) ? 'SESSION_GONE' : 'INVALID_REQUEST');
  }

  private async loadOrThrow(id: string): Promise<Session> {
    const session = await this.sessions.findById(id);
    if (!session) throw new AppError('NOT_FOUND');
    return session;
  }
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function toStatus(s: Session): SessionStatus {
  return {
    sessionId: s.id,
    state: s.state,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    claimedAt: iso(s.claimedAt),
    finishedAt: iso(s.finishedAt),
    closedAt: iso(s.closedAt),
    revokedAt: iso(s.revokedAt),
  };
}
