import { SessionsRepository } from './sessions.repository';
import { openTestDb, type TestDb } from './testing/test-db';

describe('SessionsRepository (real Postgres)', () => {
  let db: TestDb;
  let repo: SessionsRepository;

  beforeAll(async () => {
    db = await openTestDb();
    repo = new SessionsRepository(db.database);
  });
  beforeEach(() => db.truncateAll());
  afterAll(() => db.close());

  const newSession = () => repo.create({ secretHash: 'secret-h', requesterTokenHash: 'req-h' });

  it('creates a pending session that expires 5 minutes after creation', async () => {
    const s = await newSession();
    expect(s.state).toBe('pending');
    expect(s.helperTokenHash).toBeNull();
    expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBe(5 * 60 * 1000);
    expect(await repo.findById(s.id)).toEqual(s);
  });

  it('lets exactly one of many concurrent claims win', async () => {
    const s = await newSession();
    const attempts = Array.from({ length: 10 }, (_, i) =>
      repo.claimIfPending(s.id, `helper-${String(i)}`),
    );
    const results = await Promise.all(attempts);

    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    const stored = await repo.findById(s.id);
    expect(stored?.state).toBe('claimed');
    expect(stored?.helperTokenHash).toBe(winners[0]?.helperTokenHash);
    expect(stored?.claimedAt).not.toBeNull();
  });

  it('refuses a claim after expiry', async () => {
    const s = await newSession();
    await db.pool.query(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1",
      [s.id],
    );
    expect(await repo.claimIfPending(s.id, 'helper')).toBeNull();
    expect((await repo.findById(s.id))?.state).toBe('pending');
  });

  it('returns nothing for a wrong-state transition and leaves the row unchanged', async () => {
    const s = await newSession();
    expect(await repo.transition(s.id, 'claimed', 'finished')).toBeNull();
    expect(await repo.findById(s.id)).toEqual(s);
  });

  it('applies a transition from any of the allowed states and sets its timestamp', async () => {
    const s = await newSession();
    await repo.claimIfPending(s.id, 'helper');
    const finished = await repo.transition(s.id, 'claimed', 'finished');
    expect(finished?.state).toBe('finished');
    expect(finished?.finishedAt).not.toBeNull();

    const revoked = await repo.transition(s.id, ['pending', 'claimed', 'finished'], 'revoked');
    expect(revoked?.state).toBe('revoked');
    expect(revoked?.revokedAt).not.toBeNull();
    expect(await repo.transition(s.id, 'finished', 'closed')).toBeNull();
  });

  it('takes a session out of the idle query when touchActivity runs', async () => {
    const s = await newSession();
    await repo.claimIfPending(s.id, 'helper');
    await db.pool.query(
      "UPDATE sessions SET last_activity_at = now() - interval '10 minutes' WHERE id = $1",
      [s.id],
    );
    expect(await repo.findIdle(300)).toEqual([s.id]);

    expect(await repo.touchActivity(s.id)).toBe(true);
    expect(await repo.findIdle(300)).toEqual([]);
  });

  it('purges old sessions with their photos and devices', async () => {
    const old = await newSession();
    const fresh = await newSession();
    await db.pool.query(
      "UPDATE sessions SET created_at = now() - interval '3 days' WHERE id = $1",
      [old.id],
    );
    for (const id of [old.id, fresh.id]) {
      await db.pool.query(
        `INSERT INTO photos (session_id, r2_key, content_type, url_expires_at, object_deleted_at)
         VALUES ($1::uuid, 'sessions/' || $1::text || '/p.jpg', 'image/jpeg', now(), now())`,
        [id],
      );
      await db.pool.query(
        "INSERT INTO devices (session_id, platform, push_token) VALUES ($1, 'ios', 'push')",
        [id],
      );
    }

    expect(await repo.purgeSettled(2 * 24 * 60 * 60)).toBe(1);

    const count = async (table: string, id: string) =>
      (
        await db.pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table} WHERE session_id = $1`,
          [id],
        )
      ).rows[0]?.n;
    expect(await repo.findById(old.id)).toBeNull();
    expect(await count('photos', old.id)).toBe(0);
    expect(await count('devices', old.id)).toBe(0);
    expect(await count('photos', fresh.id)).toBe(1);
    expect(await count('devices', fresh.id)).toBe(1);
  });
});
