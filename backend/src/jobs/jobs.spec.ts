import { randomBytes } from 'node:crypto';
import { TokenService } from '../auth/token.service';
import type { AppConfig } from '../common/config/config';
import { PhotosRepository } from '../database/photos.repository';
import { buildKey, type R2Key } from '../database/r2-key';
import { SessionsRepository } from '../database/sessions.repository';
import { InMemoryR2Client } from '../database/testing/in-memory-r2';
import { openTestDb, type TestDb } from '../database/testing/test-db';
import { PhotoCleanup } from '../delivery/photo-cleanup';
import { PostgresEventBus } from '../eventbus';
import type { QrService } from '../sessions/qr.service';
import { SessionsService } from '../sessions/sessions.service';
import { NoopModeration } from '../uploads/moderation.hook';
import { UploadsService } from '../uploads/uploads.service';
import { ExpirePairingJob } from './expire-pairing.job';
import { HardDeleteJob } from './hard-delete.job';
import { InactivityJob } from './inactivity.job';
import { QUEUES } from './jobs.constants';
import { SchedulerService } from './scheduler.service';
import { StaleUploadsJob } from './stale-uploads.job';

const fakeQr = { renderPng: () => Promise.resolve(Buffer.from('png')) } as unknown as QrService;

describe('Jobs', () => {
  let db: TestDb;
  let bossSchema: string;
  let sessionsRepo: SessionsRepository;
  let photos: PhotosRepository;
  let bus: PostgresEventBus;
  let r2: InMemoryR2Client;
  let sessions: SessionsService;
  let uploads: UploadsService;
  let expirePairing: ExpirePairingJob;
  let inactivity: InactivityJob;
  let staleUploads: StaleUploadsJob;
  let hardDelete: HardDeleteJob;
  let scheduler: SchedulerService;

  beforeAll(async () => {
    db = await openTestDb();
    sessionsRepo = new SessionsRepository(db.database);
    photos = new PhotosRepository(db.database);
    bossSchema = `pgboss_${randomBytes(6).toString('hex')}`;
  });

  afterAll(async () => {
    await db.pool.query(`DROP SCHEMA IF EXISTS ${bossSchema} CASCADE`);
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    // The Postgres bus delivers after commit, so the scheduler can read the new session.
    bus = new PostgresEventBus(db.database, { channel: `test_${randomBytes(6).toString('hex')}` });
    bus.start();
    await bus.whenListening();
    r2 = new InMemoryR2Client();
    sessions = new SessionsService(sessionsRepo, db.database, new TokenService(), fakeQr, bus, {
      linkBaseUrl: 'https://picplease.app',
    } as AppConfig);
    uploads = new UploadsService(photos, sessions, db.database, r2, bus, new NoopModeration());
    expirePairing = new ExpirePairingJob(sessions);
    inactivity = new InactivityJob(sessions, sessionsRepo);
    staleUploads = new StaleUploadsJob(photos, uploads);
    hardDelete = new HardDeleteJob(photos, sessionsRepo, new PhotoCleanup(photos, r2));
    scheduler = new SchedulerService(
      { databaseUrl: db.databaseUrl } as AppConfig,
      { schema: bossSchema, pollingIntervalSeconds: 0.5 },
      bus,
      sessionsRepo,
      expirePairing,
      inactivity,
      staleUploads,
      hardDelete,
    );
    await scheduler.onApplicationBootstrap();
  });

  afterEach(async () => {
    await scheduler.onApplicationShutdown();
    await bus.stop();
  });

  async function until(check: () => boolean | Promise<boolean>, ms = 3000): Promise<boolean> {
    for (const end = Date.now() + ms; Date.now() < end;) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return check();
  }

  const settle = () => new Promise((r) => setTimeout(r, 200));
  const state = async (id: string) => (await sessions.getStatus(id)).state;
  const timers = async (
    queue: typeof QUEUES.expirePairing | typeof QUEUES.graceFinish,
    id: string,
  ) => (await scheduler.queuedTimers(queue, id)).length;

  async function claimed(): Promise<string> {
    const s = await sessions.createSession();
    await sessions.claimSession(s.sessionId, new URL(s.link).searchParams.get('t') ?? '');
    return s.sessionId;
  }

  async function uploaded(sessionId: string): Promise<{ photoId: string; key: R2Key }> {
    const { photoId } = await uploads.issueUploadUrl(sessionId, 'image/jpeg');
    const key = buildKey(sessionId, photoId);
    r2.put(key, 1000);
    await uploads.confirmUpload(sessionId, photoId);
    return { photoId, key };
  }

  /** Moves a session and its photos back in time. */
  async function age(sessionId: string, hours: number): Promise<void> {
    const interval = `${String(hours)} hours`;
    await db.pool.query(
      'UPDATE sessions SET created_at = created_at - $2::interval WHERE id = $1',
      [sessionId, interval],
    );
    await db.pool.query(
      'UPDATE photos SET created_at = created_at - $2::interval WHERE session_id = $1',
      [sessionId, interval],
    );
  }

  it('session.created schedules the pairing timer at expires_at', async () => {
    const s = await sessions.createSession();
    expect(await until(async () => (await timers(QUEUES.expirePairing, s.sessionId)) === 1)).toBe(
      true,
    );
    const [job] = await scheduler.queuedTimers(QUEUES.expirePairing, s.sessionId);
    const session = await sessionsRepo.findById(s.sessionId);
    expect(job?.startAfter.getTime()).toBe(session?.expiresAt.getTime());
  });

  it('session.claimed cancels the pairing timer', async () => {
    const s = await sessions.createSession();
    await until(async () => (await timers(QUEUES.expirePairing, s.sessionId)) === 1);
    await sessions.claimSession(s.sessionId, new URL(s.link).searchParams.get('t') ?? '');
    expect(await until(async () => (await timers(QUEUES.expirePairing, s.sessionId)) === 0)).toBe(
      true,
    );
  });

  it('pairing expiry on a claimed session does nothing', async () => {
    const id = await claimed();
    expect(await expirePairing.run(id)).toBe(false);
    expect(await state(id)).toBe('claimed');
  });

  it('idle claimed session is finished by the sweep', async () => {
    const id = await claimed();
    await db.pool.query(
      "UPDATE sessions SET last_activity_at = now() - interval '121 seconds' WHERE id = $1",
      [id],
    );
    expect(await inactivity.finishIdle()).toBe(1);
    expect(await state(id)).toBe('finished');
  });

  it('active claimed session is not finished', async () => {
    const id = await claimed();
    await db.pool.query(
      "UPDATE sessions SET last_activity_at = now() - interval '100 seconds' WHERE id = $1",
      [id],
    );
    expect(await inactivity.finishIdle()).toBe(0);
    expect(await state(id)).toBe('claimed');
  });

  it('stale pending photo is reconciled after the margin', async () => {
    const id = await claimed();
    const stale = await uploads.issueUploadUrl(id, 'image/jpeg');
    const recent = await uploads.issueUploadUrl(id, 'image/jpeg');
    r2.put(buildKey(id, stale.photoId), 1000);
    r2.put(buildKey(id, recent.photoId), 1000);
    await db.pool.query(
      "UPDATE photos SET url_expires_at = now() - interval '61 seconds' WHERE id = $1",
      [stale.photoId],
    );
    await db.pool.query(
      "UPDATE photos SET url_expires_at = now() - interval '30 seconds' WHERE id = $1",
      [recent.photoId],
    );

    expect(await staleUploads.run()).toEqual(['promoted']);
    expect((await photos.findById(stale.photoId))?.status).toBe('uploaded');
    expect((await photos.findById(recent.photoId))?.status).toBe('pending');
  });

  it('hard delete removes photos over 48 hours and their session', async () => {
    const id = await claimed();
    const photo = await uploaded(id);
    await sessions.finish(id);
    await age(id, 49);

    const result = await hardDelete.run();
    expect(result).toEqual({ objectsDeleted: 1, objectsFailed: 0, sessionsPurged: 1 });
    expect(r2.objects.has(photo.key)).toBe(false);
    expect(await sessionsRepo.findById(id)).toBeNull();
    expect(await photos.findById(photo.photoId)).toBeNull();
  });

  it('hard delete leaves fresh photos and sessions', async () => {
    const id = await claimed();
    const photo = await uploaded(id);
    await age(id, 47);

    expect(await hardDelete.run()).toEqual({
      objectsDeleted: 0,
      objectsFailed: 0,
      sessionsPurged: 0,
    });
    expect(r2.objects.has(photo.key)).toBe(true);
    expect((await photos.findById(photo.photoId))?.objectDeletedAt).toBeNull();
    expect(await sessionsRepo.findById(id)).not.toBeNull();
  });

  it('hard delete retries a downloaded photo whose delete failed', async () => {
    const id = await claimed();
    const photo = await uploaded(id);
    await photos.markDownloaded(photo.photoId, id, ['claimed']);

    expect((await hardDelete.run()).objectsDeleted).toBe(1);
    expect(r2.objects.has(photo.key)).toBe(false);
    expect((await photos.findById(photo.photoId))?.objectDeletedAt).not.toBeNull();
    expect(await sessionsRepo.findById(id)).not.toBeNull();
  });

  it('hard delete keeps the session row while R2 refuses an object', async () => {
    const id = await claimed();
    const photo = await uploaded(id);
    await age(id, 49);
    jest.spyOn(r2, 'deleteMany').mockResolvedValueOnce({ failed: [photo.key] });

    expect(await hardDelete.run()).toEqual({
      objectsDeleted: 0,
      objectsFailed: 1,
      sessionsPurged: 0,
    });
    expect(await sessionsRepo.findById(id)).not.toBeNull();

    expect(await hardDelete.run()).toEqual({
      objectsDeleted: 1,
      objectsFailed: 0,
      sessionsPurged: 1,
    });
  });

  it('grace timer finishes the session when it fires', async () => {
    const id = await claimed();
    await sessions.finish(id, 1);
    expect(await state(id)).toBe('claimed');
    expect(await until(async () => (await state(id)) === 'finished', 6000)).toBe(true);
  }, 10_000);

  it('session.resumed cancels the grace timer', async () => {
    const id = await claimed();
    await sessions.finish(id, 30);
    await until(async () => (await timers(QUEUES.graceFinish, id)) === 1);
    await sessions.resume(id);
    expect(await until(async () => (await timers(QUEUES.graceFinish, id)) === 0)).toBe(true);
    await settle();
    expect(await state(id)).toBe('claimed');
  });
});
