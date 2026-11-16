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
