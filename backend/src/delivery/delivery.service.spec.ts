import { randomBytes } from 'node:crypto';
import { TokenService } from '../auth/token.service';
import type { AppConfig } from '../common/config/config';
import { AppError } from '../common/errors';
import { PhotosRepository } from '../database/photos.repository';
import { buildKey, type R2Key } from '../database/r2-key';
import { SessionsRepository } from '../database/sessions.repository';
import { InMemoryR2Client } from '../database/testing/in-memory-r2';
import { openTestDb, type TestDb } from '../database/testing/test-db';
import { type EventName, type EventPayload, PostgresEventBus } from '../eventbus';
import type { QrService } from '../sessions/qr.service';
import { SessionsService } from '../sessions/sessions.service';
import { NoopModeration } from '../uploads/moderation.hook';
import { UploadsService } from '../uploads/uploads.service';
import { DeliveryListener } from './delivery.listener';
import { DeliveryService } from './delivery.service';
import { PhotoCleanup } from './photo-cleanup';

const config = { linkBaseUrl: 'https://picplease.app' } as AppConfig;
const fakeQr = { renderPng: () => Promise.resolve(Buffer.from('png')) } as unknown as QrService;
const MB = 1024 * 1024;

describe('DeliveryService', () => {
  let db: TestDb;
  let sessionsRepo: SessionsRepository;
  let photos: PhotosRepository;
  let sessions: SessionsService;
  let r2: InMemoryR2Client;
  let uploads: UploadsService;
  let delivery: DeliveryService;
  let listener: DeliveryListener;
  let bus: PostgresEventBus;
  let events: { name: EventName; payload: EventPayload }[];

  beforeAll(async () => {
    db = await openTestDb();
    sessionsRepo = new SessionsRepository(db.database);
    photos = new PhotosRepository(db.database);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    // The Postgres bus delivers only after commit, which the window check relies on (the
    // in-memory bus would run the listener before the ack's transaction commits).
    bus = new PostgresEventBus(db.database, { channel: `test_${randomBytes(6).toString('hex')}` });
    bus.start();
    await bus.whenListening();
    events = [];
    for (const name of [
      'photo.acknowledged',
      'photo.discarded',
      'session.closed',
      'delivery.window-closed',
    ] as const) {
      bus.subscribe(name, (payload) => {
        events.push({ name, payload });
      });
    }
    r2 = new InMemoryR2Client();
    sessions = new SessionsService(
      sessionsRepo,
      db.database,
      new TokenService(),
      fakeQr,
      bus,
      config,
    );
    uploads = new UploadsService(photos, sessions, db.database, r2, bus, new NoopModeration());
    delivery = new DeliveryService(
      photos,
      sessions,
      db.database,
      new PhotoCleanup(photos, r2),
      r2,
      bus,
    );
    listener = new DeliveryListener(bus, delivery);
    listener.onModuleInit();
  });

  afterEach(async () => {
    listener.onModuleDestroy();
    await bus.stop();
  });

  /** Waits for listener work (async handlers that hit the database). */
  async function until(check: () => boolean | Promise<boolean>): Promise<boolean> {
    for (let i = 0; i < 100; i++) {
      if (await check()) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return check();
  }

  /** Lets queued handlers run to completion when nothing is expected to change. */
  const settle = () => new Promise((r) => setTimeout(r, 100));

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    const err: unknown = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }

  async function claimed(): Promise<string> {
    const s = await sessions.createSession();
    await sessions.claimSession(s.sessionId, new URL(s.link).hash.slice(1));
    return s.sessionId;
  }

  /** Issues an upload URL without uploading: the photo stays pending (in flight). */
  async function inFlight(sessionId: string): Promise<{ photoId: string; key: R2Key }> {
    const { photoId } = await uploads.issueUploadUrl(sessionId, 'image/jpeg');
    return { photoId, key: buildKey(sessionId, photoId) };
  }

  /** Issues, simulates the PUT, confirms. */
  async function uploaded(sessionId: string, size = 2 * MB) {
    const photo = await inFlight(sessionId);
    r2.put(photo.key, size);
    await uploads.confirmUpload(sessionId, photo.photoId);
    return photo;
  }

  const state = async (id: string) => (await sessions.getStatus(id)).state;
  const named = (name: EventName) => events.filter((e) => e.name === name);

  it('pending lists only uploaded, unsaved photos, oldest first', async () => {
    const id = await claimed();
    const first = await uploaded(id, 1000);
    const saved = await uploaded(id);
    const third = await uploaded(id, 3000);
    await inFlight(id);
    await delivery.acknowledge(id, saved.photoId);

    const list = await delivery.listPending(id);
    expect(list.state).toBe('claimed');
    expect(list.photos.map((p) => p.photoId)).toEqual([first.photoId, third.photoId]);
    expect(list.photos[0]).toMatchObject({ sizeBytes: 1000 });
    expect(Number.isNaN(Date.parse(list.photos[0]?.uploadedAt ?? ''))).toBe(false);
  });

  it('refuses after revoke', async () => {
    const id = await claimed();
    const photo = await uploaded(id);
    await sessions.revokeSession(id);
    await expectCode(delivery.listPending(id), 'SESSION_GONE');
    await expectCode(delivery.getDownloadUrl(id, photo.photoId), 'SESSION_GONE');
    await expectCode(delivery.acknowledge(id, photo.photoId), 'SESSION_GONE');
  });

  it("refuses another session's photo", async () => {
    const mine = await claimed();
    const other = await claimed();
    const photo = await uploaded(other);
    await expectCode(delivery.getDownloadUrl(mine, photo.photoId), 'NOT_FOUND');
    await expectCode(delivery.acknowledge(mine, photo.photoId), 'NOT_FOUND');
    expect((await photos.findById(photo.photoId))?.downloadedAt).toBeNull();
  });

  it('refuses a photo that is not uploaded yet', async () => {
    const id = await claimed();
    const photo = await inFlight(id);
    await expectCode(delivery.getDownloadUrl(id, photo.photoId), 'INVALID_REQUEST');
    await expectCode(delivery.acknowledge(id, photo.photoId), 'INVALID_REQUEST');

    const ready = await uploaded(id);
    const url = await delivery.getDownloadUrl(id, ready.photoId);
    expect(url.url).toContain(ready.key);
    // Getting a URL marks nothing.
    expect((await photos.findById(ready.photoId))?.downloadedAt).toBeNull();
  });

  it('acknowledge twice is harmless, even after the window closed', async () => {
    const id = await claimed();
    const photo = await uploaded(id);
    await sessions.finish(id);
    const [a, b] = await Promise.all([
      delivery.acknowledge(id, photo.photoId),
      delivery.acknowledge(id, photo.photoId),
    ]);
    expect(a).toEqual({ photoId: photo.photoId, status: 'downloaded' });
    expect(b).toEqual(a);
    expect(await until(async () => (await state(id)) === 'closed')).toBe(true);

    await expect(delivery.acknowledge(id, photo.photoId)).resolves.toEqual(a);
    await settle();
    expect(named('photo.acknowledged')).toHaveLength(1);
    expect(named('delivery.window-closed')).toHaveLength(1);
  });

  it('acknowledge deletes the object', async () => {
    const id = await claimed();
    const photo = await uploaded(id);
    await delivery.acknowledge(id, photo.photoId);
    expect(r2.objects.has(photo.key)).toBe(false);
    const row = await photos.findById(photo.photoId);
    expect(row?.downloadedAt).toBeInstanceOf(Date);
    expect(row?.objectDeletedAt).toBeInstanceOf(Date);
    await expectCode(delivery.getDownloadUrl(id, photo.photoId), 'NOT_FOUND');
  });

  it('window closes only when finished, nothing in flight, everything downloaded', async () => {
    const id = await claimed();
    const a = await uploaded(id);
    const b = await uploaded(id);

    // Everything downloaded but not finished: stays claimed.
    await delivery.acknowledge(id, a.photoId);
    await settle();
    expect(await state(id)).toBe('claimed');

    // Finished with one photo left: stays finished.
    await sessions.finish(id);
    await settle();
    expect(await state(id)).toBe('finished');

    await delivery.acknowledge(id, b.photoId);
    expect(await until(async () => (await state(id)) === 'closed')).toBe(true);
    expect(named('delivery.window-closed')).toEqual([
      { name: 'delivery.window-closed', payload: { sessionId: id, delivered: 2 } },
    ]);
  });

  it('window stays open with one in flight', async () => {
    const id = await claimed();
    const done = await uploaded(id);
    await inFlight(id);
    await delivery.acknowledge(id, done.photoId);
    await sessions.finish(id);
    await settle();
    expect(await state(id)).toBe('finished');
    expect(await delivery.evaluateWindow(id)).toBe(false);
    expect(named('delivery.window-closed')).toHaveLength(0);
  });

  it('is re-checked when a stale photo is discarded', async () => {
    const id = await claimed();
    const done = await uploaded(id);
    const stale = await inFlight(id); // never uploaded
    await delivery.acknowledge(id, done.photoId);
    await sessions.finish(id);
    await settle();
    expect(await state(id)).toBe('finished');

    expect(await uploads.reconcileStale(stale.photoId)).toBe('discarded');
    expect(await until(async () => (await state(id)) === 'closed')).toBe(true);
    expect(named('delivery.window-closed')[0]?.payload).toEqual({ sessionId: id, delivered: 1 });
  });

  it('zero photos closes immediately', async () => {
    const id = await claimed();
    await sessions.finish(id);
    expect(await until(async () => (await state(id)) === 'closed')).toBe(true);
    expect(named('delivery.window-closed')[0]?.payload).toEqual({ sessionId: id, delivered: 0 });
  });

  it('revoke deletes undelivered objects', async () => {
    const id = await claimed();
    const a = await uploaded(id);
    const b = await uploaded(id);
    await sessions.revokeSession(id);
    expect(await until(() => !r2.objects.has(a.key) && !r2.objects.has(b.key))).toBe(true);
    expect(
      await until(async () => (await photos.findById(b.photoId))?.objectDeletedAt instanceof Date),
    ).toBe(true);
    expect((await photos.findById(a.photoId))?.downloadedAt).toBeNull();
  });

  it('revoke leaves downloaded photos alone', async () => {
    const id = await claimed();
    const saved = await uploaded(id);
    const unsaved = await uploaded(id);
    // The delete after ack fails, so the saved photo's object is still there at revoke.
    jest.spyOn(r2, 'delete').mockRejectedValueOnce(new Error('R2 unavailable'));
    await delivery.acknowledge(id, saved.photoId);
    expect(r2.objects.has(saved.key)).toBe(true);

    await sessions.revokeSession(id);
    expect(await until(() => !r2.objects.has(unsaved.key))).toBe(true);
    await settle();
    expect(r2.objects.has(saved.key)).toBe(true);
    expect(r2.deleted).not.toContain(saved.key);
    const row = await photos.findById(saved.photoId);
    expect(row?.downloadedAt).toBeInstanceOf(Date);
    expect(row?.objectDeletedAt).toBeNull(); // left for the sweep
  });
});
