import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from './migrate';
import { openTestDb, type TestDb } from './testing/test-db';

describe('DatabaseService and migrations (real Postgres)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await openTestDb();
  });
  beforeEach(() => db.truncateAll());
  afterAll(() => db.close());

  const sessionCount = async () =>
    (await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions')).rows[0]?.n;
  const insertSession =
    "INSERT INTO sessions (secret_hash, requester_token_hash, expires_at) VALUES ('s', 'r', now())";

  it('commits a transaction', async () => {
    const result = await db.database.transaction(async (tx) => {
      await tx.query(insertSession);
      return 'done';
    });
    expect(result).toBe('done');
    expect(await sessionCount()).toBe(1);
  });

  it('rolls back when the callback throws and releases the client', async () => {
    await expect(
      db.database.transaction(async (tx) => {
        await tx.query(insertSession);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await sessionCount()).toBe(0);
    expect(db.pool.totalCount - db.pool.idleCount).toBe(0);
  });

  it('reports health', async () => {
    expect(await db.database.healthCheck()).toBe(true);
  });

  it('opens a dedicated listen connection outside the pool', async () => {
    const client = await db.database.listenConnection();
    try {
      const { rows } = await client.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('has applied all migrations, and a second run applies nothing', async () => {
    const client = await db.pool.connect();
    try {
      expect(await runMigrations(client)).toEqual([]);
      const { rows } = await client.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      expect(rows.map((r) => r.name)).toEqual([
        '001_sessions.sql',
        '002_photos.sql',
        '003_devices.sql',
        '004_indexes.sql',
        '005_photos_in_flight.sql',
      ]);
    } finally {
      client.release();
    }
  });

  it('rolls back a failing migration and records nothing for it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
    writeFileSync(join(dir, '999_broken.sql'), 'CREATE TABLE broken_x (id int); SELECT nope;');
    const client = await db.pool.connect();
    try {
      await expect(runMigrations(client, dir)).rejects.toThrow('Migration 999_broken.sql failed');
      const { rows } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = '999_broken.sql' UNION ALL SELECT 1 FROM pg_tables WHERE tablename = 'broken_x'",
      );
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });
});
