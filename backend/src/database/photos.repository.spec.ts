import { randomUUID } from 'node:crypto';
import { PhotosRepository, type Reservation } from './photos.repository';
import { buildKey } from './r2-key';
import { SessionsRepository } from './sessions.repository';
import { openTestDb, type TestDb } from './testing/test-db';

describe('PhotosRepository', () => {
  let db: TestDb;
  let sessions: SessionsRepository;
  let photos: PhotosRepository;

  beforeAll(async () => {
    db = await openTestDb();
    sessions = new SessionsRepository(db.database);
    photos = new PhotosRepository(db.database);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  async function claimedSession(): Promise<string> {
    const s = await sessions.create({ secretHash: randomUUID(), requesterTokenHash: randomUUID() });
    await sessions.claimIfPending(s.id, randomUUID());
    return s.id;
  }

  function reservation(sessionId: string): Reservation {
    const photoId = randomUUID();
    return {
      photoId,
      sessionId,
      r2Key: buildKey(sessionId, photoId),
      contentType: 'image/jpeg',
      ttlSeconds: 600,
    };
  }

  const inFlight = async (id: string) => (await sessions.findById(id))?.photosInFlight;

  it('refuses the sixth concurrent reservation', async () => {
    const id = await claimedSession();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => photos.reserveIfUnderLimit(reservation(id), 5)),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(5);
    expect(await inFlight(id)).toBe(5);
    const { rows } = await db.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM photos WHERE session_id = $1 AND status = 'pending'",
      [id],
    );
    expect(rows[0]?.n).toBe(5);
  });

  it('frees a slot on upload and on discard, once each', async () => {
    const id = await claimedSession();
    const a = await photos.reserveIfUnderLimit(reservation(id), 5);
    const b = await photos.reserveIfUnderLimit(reservation(id), 5);
    expect(await inFlight(id)).toBe(2);

    expect(await photos.markUploaded(a?.id ?? '', 1000, ['claimed'])).toMatchObject({
      status: 'uploaded',
      sizeBytes: 1000,
    });
    expect(await photos.markUploaded(a?.id ?? '', 1000, ['claimed'])).toBeNull();
    expect(await inFlight(id)).toBe(1);

    expect(await photos.discardPending(b?.id ?? '')).not.toBeNull();
    expect(await photos.discardPending(b?.id ?? '')).toBeNull();
    expect(await photos.discardPending(a?.id ?? '')).toBeNull(); // uploaded, not pending
    expect(await inFlight(id)).toBe(0);
  });

  it('refuses a reservation unless the session is claimed', async () => {
    const pending = await sessions.create({ secretHash: 'x', requesterTokenHash: 'y' });
    expect(await photos.reserveIfUnderLimit(reservation(pending.id), 5)).toBeNull();

    const id = await claimedSession();
    await sessions.transition(id, 'claimed', 'finished');
    expect(await photos.reserveIfUnderLimit(reservation(id), 5)).toBeNull();
    expect(await inFlight(id)).toBe(0);
  });

  it('does not mark uploaded when the session state does not match', async () => {
    const id = await claimedSession();
    const p = await photos.reserveIfUnderLimit(reservation(id), 5);
    await sessions.transition(id, 'claimed', 'revoked');
    expect(await photos.markUploaded(p?.id ?? '', 1000, ['claimed', 'finished'])).toBeNull();
    expect(await inFlight(id)).toBe(1);
  });
});
