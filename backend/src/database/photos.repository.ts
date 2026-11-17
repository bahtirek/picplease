import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from './database.service';
import { assertR2Key, type R2Key } from './r2-key';
import type { SessionState } from './sessions.repository';

export type PhotoStatus = 'pending' | 'uploaded';

export interface Photo {
  id: string;
  sessionId: string;
  r2Key: R2Key;
  status: PhotoStatus;
  contentType: string;
  sizeBytes: number | null;
  urlExpiresAt: Date;
  createdAt: Date;
  uploadedAt: Date | null;
  downloadedAt: Date | null;
  objectDeletedAt: Date | null;
}

interface PhotoRow {
  id: string;
  session_id: string;
  r2_key: string;
  status: PhotoStatus;
  content_type: string;
  size_bytes: string | null; // bigint comes back as a string
  url_expires_at: Date;
  created_at: Date;
  uploaded_at: Date | null;
  downloaded_at: Date | null;
  object_deleted_at: Date | null;
}

function toPhoto(row: PhotoRow): Photo {
  assertR2Key(row.r2_key);
  return {
    id: row.id,
    sessionId: row.session_id,
    r2Key: row.r2_key,
    status: row.status,
    contentType: row.content_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    urlExpiresAt: row.url_expires_at,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    downloadedAt: row.downloaded_at,
    objectDeletedAt: row.object_deleted_at,
  };
}

export interface WindowCounts {
  state: SessionState;
  inFlight: number;
  left: number;
  delivered: number;
}

export interface Reservation {
  photoId: string;
  sessionId: string;
  r2Key: R2Key;
  contentType: string;
  ttlSeconds: number;
}

/**
 * Plain SQL access to photos. `sessions.photos_in_flight` counts pending photos; every
 * method that adds or removes a pending photo changes the counter in the same statement.
 */
@Injectable()
export class PhotosRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Reserves an upload slot and inserts the pending photo, in one statement. The counter
   * UPDATE takes the session row lock; a waiting caller re-checks `photos_in_flight < max`
   * against the committed row, so the count never goes above max. Returns null when the
   * session is not claimed or is full.
   */
  async reserveIfUnderLimit(
    input: Reservation,
    max: number,
    db: Queryable = this.database.pool,
  ): Promise<Photo | null> {
    const { rows } = await db.query<PhotoRow>(
      `WITH s AS (
         UPDATE sessions SET photos_in_flight = photos_in_flight + 1
          WHERE id = $1 AND state = 'claimed' AND photos_in_flight < $2
          RETURNING id
       )
       INSERT INTO photos (id, session_id, r2_key, content_type, url_expires_at)
       SELECT $3, s.id, $4, $5, now() + make_interval(secs => $6) FROM s
       RETURNING *`,
      [input.sessionId, max, input.photoId, input.r2Key, input.contentType, input.ttlSeconds],
    );
    return rows[0] ? toPhoto(rows[0]) : null;
  }

  async findById(id: string, db: Queryable = this.database.pool): Promise<Photo | null> {
    const { rows } = await db.query<PhotoRow>('SELECT * FROM photos WHERE id = $1', [id]);
    return rows[0] ? toPhoto(rows[0]) : null;
  }

  /**
   * pending -> uploaded, only while the session is in one of `sessionStates`. Frees the
   * slot in the same statement. Returns null if the photo was not pending (already
   * uploaded, discarded) or the session state does not match.
   */
  async markUploaded(
    id: string,
    sizeBytes: number,
    sessionStates: readonly SessionState[],
    db: Queryable = this.database.pool,
  ): Promise<Photo | null> {
    const { rows } = await db.query<PhotoRow>(
      `WITH p AS (
         UPDATE photos SET status = 'uploaded', uploaded_at = now(), size_bytes = $2
          WHERE id = $1 AND status = 'pending'
            AND EXISTS (SELECT 1 FROM sessions
                         WHERE sessions.id = photos.session_id AND state = ANY($3::text[]))
          RETURNING *
       ), s AS (
         UPDATE sessions SET photos_in_flight = photos_in_flight - 1
           FROM p WHERE sessions.id = p.session_id
       )
       SELECT * FROM p`,
      [id, sizeBytes, [...sessionStates]],
    );
    return rows[0] ? toPhoto(rows[0]) : null;
  }

  /**
   * Photos the requester has not saved yet: uploaded, not downloaded, object still in R2.
   * Oldest first. Also the set revoke deletes.
   */
  async listPending(sessionId: string, db: Queryable = this.database.pool): Promise<Photo[]> {
    const { rows } = await db.query<PhotoRow>(
      `SELECT * FROM photos
        WHERE session_id = $1 AND status = 'uploaded'
          AND downloaded_at IS NULL AND object_deleted_at IS NULL
        ORDER BY uploaded_at, id`,
      [sessionId],
    );
    return rows.map(toPhoto);
  }

  /**
   * uploaded -> downloaded, only for a photo of `sessionId` while the session is in one
   * of `sessionStates`. Returns null if it was already downloaded, not uploaded, belongs
   * to another session or the session state does not match.
   */
  async markDownloaded(
    id: string,
    sessionId: string,
    sessionStates: readonly SessionState[],
    db: Queryable = this.database.pool,
  ): Promise<Photo | null> {
    const { rows } = await db.query<PhotoRow>(
      `UPDATE photos SET downloaded_at = now()
        WHERE id = $1 AND session_id = $2 AND status = 'uploaded' AND downloaded_at IS NULL
          AND EXISTS (SELECT 1 FROM sessions
                       WHERE sessions.id = photos.session_id AND state = ANY($3::text[]))
        RETURNING *`,
      [id, sessionId, [...sessionStates]],
    );
    return rows[0] ? toPhoto(rows[0]) : null;
  }

  /** Records that the objects are gone from R2. Returns how many rows changed. */
  async markObjectsDeleted(
    ids: readonly string[],
    db: Queryable = this.database.pool,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const { rowCount } = await db.query(
      `UPDATE photos SET object_deleted_at = now()
        WHERE id = ANY($1::uuid[]) AND object_deleted_at IS NULL`,
      [[...ids]],
    );
    return rowCount ?? 0;
  }

  /**
   * The delivery window counts, in one statement: session state, photos in flight
   * (pending), left (uploaded, not downloaded, object not deleted) and delivered
   * (downloaded). Null for an unknown session.
   */
  async windowCounts(
    sessionId: string,
    db: Queryable = this.database.pool,
  ): Promise<WindowCounts | null> {
    const { rows } = await db.query<{
      state: SessionState;
      in_flight: number;
      remaining: number;
      delivered: number;
    }>(
      `SELECT s.state, s.photos_in_flight AS in_flight,
              (count(p.id) FILTER (WHERE p.status = 'uploaded' AND p.downloaded_at IS NULL
                                     AND p.object_deleted_at IS NULL))::int AS remaining,
              (count(p.id) FILTER (WHERE p.downloaded_at IS NOT NULL))::int AS delivered
         FROM sessions s LEFT JOIN photos p ON p.session_id = s.id
        WHERE s.id = $1
        GROUP BY s.id`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      state: row.state,
      inFlight: row.in_flight,
      left: row.remaining,
      delivered: row.delivered,
    };
  }

  /**
   * Pending photos whose upload URL expired more than marginSeconds ago, oldest first.
   * The margin lets an upload that started just before expiry finish first.
   */
  async findStalePending(
    marginSeconds: number,
    limit = 100,
    db: Queryable = this.database.pool,
  ): Promise<Photo[]> {
    const { rows } = await db.query<PhotoRow>(
      `SELECT * FROM photos
        WHERE status = 'pending' AND url_expires_at < now() - make_interval(secs => $1)
        ORDER BY url_expires_at, id
        LIMIT $2`,
      [marginSeconds, limit],
    );
    return rows.map(toPhoto);
  }

  /**
   * Photos whose R2 object should go: downloaded (a delete after ack that failed) or
   * created more than olderThanSeconds ago, object not yet marked deleted. Oldest first.
   */
  async findForObjectCleanup(
    olderThanSeconds: number,
    limit = 1000,
    db: Queryable = this.database.pool,
  ): Promise<Photo[]> {
    const { rows } = await db.query<PhotoRow>(
      `SELECT * FROM photos
        WHERE object_deleted_at IS NULL
          AND (downloaded_at IS NOT NULL
               OR created_at < now() - make_interval(secs => $1))
        ORDER BY created_at, id
        LIMIT $2`,
      [olderThanSeconds, limit],
    );
    return rows.map(toPhoto);
  }

  /** Deletes a pending photo and frees its slot. Returns null if it was not pending. */
  async discardPending(id: string, db: Queryable = this.database.pool): Promise<Photo | null> {
    const { rows } = await db.query<PhotoRow>(
      `WITH p AS (
         DELETE FROM photos WHERE id = $1 AND status = 'pending' RETURNING *
       ), s AS (
         UPDATE sessions SET photos_in_flight = photos_in_flight - 1
           FROM p WHERE sessions.id = p.session_id
       )
       SELECT * FROM p`,
      [id],
    );
    return rows[0] ? toPhoto(rows[0]) : null;
  }
}
