import { Injectable } from '@nestjs/common';
import { DatabaseService, type Queryable } from './database.service';
import type { SessionState } from './sessions.repository';

export type DevicePlatform = 'ios' | 'android';

export interface Device {
  id: string;
  sessionId: string;
  platform: DevicePlatform;
  pushToken: string;
  createdAt: Date;
}

interface DeviceRow {
  id: string;
  session_id: string;
  platform: DevicePlatform;
  push_token: string;
  created_at: Date;
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    sessionId: row.session_id,
    platform: row.platform,
    pushToken: row.push_token,
    createdAt: row.created_at,
  };
}

/** Plain SQL access to devices (the requester's push tokens). Push tokens are never logged. */
@Injectable()
export class DevicesRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Inserts the device, or updates the platform if this session already has the token.
   * One statement; inserts only while the session is in one of `sessionStates`. Returns
   * null when the session is missing or in another state.
   */
  async upsert(
    sessionId: string,
    platform: DevicePlatform,
    pushToken: string,
    sessionStates: readonly SessionState[],
    db: Queryable = this.database.pool,
  ): Promise<Device | null> {
    const { rows } = await db.query<DeviceRow>(
      `INSERT INTO devices (session_id, platform, push_token)
       SELECT id, $2, $3 FROM sessions WHERE id = $1 AND state = ANY($4::text[])
       ON CONFLICT (session_id, push_token) DO UPDATE SET platform = EXCLUDED.platform
       RETURNING *`,
      [sessionId, platform, pushToken, [...sessionStates]],
    );
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async listForSession(sessionId: string, db: Queryable = this.database.pool): Promise<Device[]> {
    const { rows } = await db.query<DeviceRow>(
      'SELECT * FROM devices WHERE session_id = $1 ORDER BY created_at, id',
      [sessionId],
    );
    return rows.map(toDevice);
  }

  /**
   * Takes the session's push slot and returns its devices, in one statement. Succeeds only
   * when the session is in one of `sessionStates`, has at least one device and has not had
   * a push in the last `cooldownSeconds`; it then stamps `last_push_at`. Otherwise returns
   * an empty list and stamps nothing.
   */
  async claimPushSlot(
    sessionId: string,
    cooldownSeconds: number,
    sessionStates: readonly SessionState[],
    db: Queryable = this.database.pool,
  ): Promise<Device[]> {
    const { rows } = await db.query<DeviceRow>(
      `WITH s AS (
         UPDATE sessions SET last_push_at = now()
          WHERE id = $1 AND state = ANY($3::text[])
            AND (last_push_at IS NULL OR last_push_at <= now() - make_interval(secs => $2))
            AND EXISTS (SELECT 1 FROM devices d WHERE d.session_id = sessions.id)
          RETURNING id
       )
       SELECT d.* FROM devices d JOIN s ON d.session_id = s.id ORDER BY d.created_at, d.id`,
      [sessionId, cooldownSeconds, [...sessionStates]],
    );
    return rows.map(toDevice);
  }

  /** A provider said the token is gone: removes it from every session. Returns rows removed. */
  async removeToken(
    platform: DevicePlatform,
    pushToken: string,
    db: Queryable = this.database.pool,
  ): Promise<number> {
    const { rowCount } = await db.query(
      'DELETE FROM devices WHERE platform = $1 AND push_token = $2',
      [platform, pushToken],
    );
    return rowCount ?? 0;
  }
}
