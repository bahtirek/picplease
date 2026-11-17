import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from './database.service';

export type SessionState = 'pending' | 'claimed' | 'finished' | 'revoked' | 'expired' | 'closed';

/** States reachable through transition(). Claiming has its own method because it sets the helper token. */
export type TransitionTarget = 'finished' | 'closed' | 'revoked' | 'expired';

export interface Session {
  id: string;
  state: SessionState;
  secretHash: string;
  helperTokenHash: string | null;
  requesterTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  finishedAt: Date | null;
  closedAt: Date | null;
  revokedAt: Date | null;
  lastActivityAt: Date;
  /** Pending photos (reserved, not yet confirmed or discarded). Kept by PhotosRepository. */
  photosInFlight: number;
}

interface SessionRow {
  id: string;
  state: SessionState;
  secret_hash: string;
  helper_token_hash: string | null;
  requester_token_hash: string;
  created_at: Date;
  expires_at: Date;
  claimed_at: Date | null;
  finished_at: Date | null;
  closed_at: Date | null;
  revoked_at: Date | null;
  last_activity_at: Date;
  photos_in_flight: number;
}

export const DEFAULT_SESSION_TTL_SECONDS = 5 * 60;

// The SET clause for each target is fixed here and never built from input.
const TRANSITION_SET: Record<TransitionTarget, string> = {
  finished: "state = 'finished', finished_at = now()",
  closed: "state = 'closed', closed_at = now()",
  revoked: "state = 'revoked', revoked_at = now()",
  expired: "state = 'expired'",
};

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    state: row.state,
    secretHash: row.secret_hash,
    helperTokenHash: row.helper_token_hash,
    requesterTokenHash: row.requester_token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
    closedAt: row.closed_at,
    revokedAt: row.revoked_at,
    lastActivityAt: row.last_activity_at,
    photosInFlight: row.photos_in_flight,
  };
}

/**
 * Plain SQL access to sessions. Every atomic step is a single conditional statement,
 * so concurrent callers race inside Postgres and at most one wins. Times come from the
 * database clock. Each method takes an optional db to run inside a caller's transaction.
 */
@Injectable()
export class SessionsRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(
    input: { secretHash: string; requesterTokenHash: string; ttlSeconds?: number },
    db: Queryable = this.database.pool,
  ): Promise<Session> {
    const { rows } = await db.query<SessionRow>(
      `INSERT INTO sessions (secret_hash, requester_token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(secs => $3))
       RETURNING *`,
      [input.secretHash, input.requesterTokenHash, input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS],
    );
    const row = rows[0];
    if (!row) throw new Error('Session insert returned no row');
    return toSession(row);
  }

  async findById(id: string, db: Queryable = this.database.pool): Promise<Session | null> {
    const { rows } = await db.query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
    return rows[0] ? toSession(rows[0]) : null;
  }

  /**
   * Claims a pending, unexpired session. With secretHash, the stored secret hash must match
   * too, in the same statement. Returns null if any condition fails (including someone else
   * getting there first).
   */
  async claimIfPending(
    id: string,
    helperTokenHash: string,
    db: Queryable = this.database.pool,
    secretHash?: string,
  ): Promise<Session | null> {
    const { rows } = await db.query<SessionRow>(
      `UPDATE sessions
          SET state = 'claimed', helper_token_hash = $2, claimed_at = now(), last_activity_at = now()
        WHERE id = $1 AND state = 'pending' AND expires_at > now()
          AND ($3::text IS NULL OR secret_hash = $3)
        RETURNING *`,
      [id, helperTokenHash, secretHash ?? null],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /**
   * Moves the session to `to` only if it is still in one of `from`. Returns null when the
   * state no longer matches. Which moves are legal is decided by the Sessions module.
   */
  async transition(
    id: string,
    from: SessionState | readonly SessionState[],
    to: TransitionTarget,
    db: Queryable = this.database.pool,
  ): Promise<Session | null> {
    const set = TRANSITION_SET[to];
    if (!set) throw new Error(`Unsupported transition target: ${to as string}`);
    const fromStates = typeof from === 'string' ? [from] : [...from];
    const { rows } = await db.query<SessionRow>(
      `UPDATE sessions SET ${set} WHERE id = $1 AND state = ANY($2::text[]) RETURNING *`,
      [id, fromStates],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /** Marks activity now. Returns false if the session does not exist. */
  async touchActivity(id: string, db: Queryable = this.database.pool): Promise<boolean> {
    const { rowCount } = await db.query(
      'UPDATE sessions SET last_activity_at = now() WHERE id = $1',
      [id],
    );
    return rowCount === 1;
  }

  /** Claimed sessions with no activity for idleSeconds, oldest first. */
  async findIdle(
    idleSeconds: number,
    limit = 100,
    db: Queryable = this.database.pool,
  ): Promise<string[]> {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM sessions
        WHERE state = 'claimed' AND last_activity_at < now() - make_interval(secs => $1)
        ORDER BY last_activity_at
        LIMIT $2`,
      [idleSeconds, limit],
    );
    return rows.map((r) => r.id);
  }

  /** Deletes sessions created before cutoff; photos and devices go with them. Returns the count. */
  async purgeCreatedBefore(cutoff: Date, db: Queryable = this.database.pool): Promise<number> {
    const { rowCount } = await db.query('DELETE FROM sessions WHERE created_at < $1', [cutoff]);
    return rowCount ?? 0;
  }

  /**
   * The 48 hour purge: deletes sessions created more than olderThanSeconds ago whose photos
   * all have their R2 object deleted, so no row holding a live key is lost. Photos and
   * devices go with them. Returns the count.
   */
  async purgeSettled(
    olderThanSeconds: number,
    db: Queryable = this.database.pool,
  ): Promise<number> {
    const { rowCount } = await db.query(
      `DELETE FROM sessions s
        WHERE s.created_at < now() - make_interval(secs => $1)
          AND NOT EXISTS (SELECT 1 FROM photos p
                           WHERE p.session_id = s.id AND p.object_deleted_at IS NULL)`,
      [olderThanSeconds],
    );
    return rowCount ?? 0;
  }
}
