import { TokenService } from '../auth/token.service';
import type { AppConfig } from '../common/config/config';
import { AppError } from '../common/errors';
import { PhotosRepository } from '../database/photos.repository';
import { buildKey } from '../database/r2-key';
import { SessionsRepository } from '../database/sessions.repository';
import { InMemoryR2Client } from '../database/testing/in-memory-r2';
import { openTestDb, type TestDb } from '../database/testing/test-db';
import { type EventName, type EventPayload, InMemoryEventBus } from '../eventbus';
import type { QrService } from '../sessions/qr.service';
import { SessionsService } from '../sessions/sessions.service';
import { NoopModeration } from './moderation.hook';
import { UploadsService } from './uploads.service';

const config = { linkBaseUrl: 'https://picplease.app' } as AppConfig;
const fakeQr = { renderPng: () => Promise.resolve(Buffer.from('png')) } as unknown as QrService;
const MB = 1024 * 1024;

describe('UploadsService', () => {
  let db: TestDb;
  let sessionsRepo: SessionsRepository;
  let photos: PhotosRepository;
  let sessions: SessionsService;
  let r2: InMemoryR2Client;
  let uploads: UploadsService;
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
    const bus = new InMemoryEventBus();
    events = [];
    for (const name of ['photo.uploaded', 'photo.discarded'] as const) {
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
  });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    const err: unknown = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }

  async function created(): Promise<{ id: string; secret: string }> {
    const s = await sessions.createSession();
    return { id: s.sessionId, secret: new URL(s.link).hash.slice(1) };
  }

  async function claimed(): Promise<string> {
    const s = await created();
    await sessions.claimSession(s.id, s.secret);
    return s.id;
  }

  /** Issues a URL and simulates the phone's PUT. */
  async function uploaded(sessionId: string, size = 2 * MB, type = 'image/jpeg') {
    const issued = await uploads.issueUploadUrl(sessionId, 'image/jpeg');
    const key = buildKey(sessionId, issued.photoId);
    r2.put(key, size, type);
    return { photoId: issued.photoId, key };
  }

  const photoEvents = (name: EventName) => events.filter((e) => e.name === name);

  it('refuses to issue before claim', async () => {
    const s = await created();
    await expectCode(uploads.issueUploadUrl(s.id, 'image/jpeg'), 'INVALID_REQUEST');
  });

  it('refuses to issue after finish', async () => {
    const id = await claimed();
    await sessions.finish(id);
    await expectCode(uploads.issueUploadUrl(id, 'image/jpeg'), 'SESSION_FINISHED');
  });

  it('refuses the 6th simultaneous request', async () => {
    const id = await claimed();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => uploads.issueUploadUrl(id, 'image/jpeg')),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(5);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'UPLOAD_LIMIT_REACHED',
    });
    const first = (ok[0] as PromiseFulfilledResult<{ url: string; headers: object }>).value;
    expect(first.headers).toEqual({ 'content-type': 'image/jpeg' });
  });

  it('confirm twice succeeds with one event', async () => {
    const id = await claimed();
    const { photoId } = await uploaded(id);

    await expect(uploads.confirmUpload(id, photoId)).resolves.toEqual({
      photoId,
      status: 'uploaded',
    });
    await expect(uploads.confirmUpload(id, photoId)).resolves.toEqual({
      photoId,
      status: 'uploaded',
    });
    await flush();
    expect(photoEvents('photo.uploaded')).toEqual([
      { name: 'photo.uploaded', payload: { sessionId: id, photoId } },
    ]);
    expect((await sessionsRepo.findById(id))?.photosInFlight).toBe(0);
  });

  it('rejects confirm when the object is missing', async () => {
    const id = await claimed();
    const issued = await uploads.issueUploadUrl(id, 'image/jpeg');

    await expectCode(uploads.confirmUpload(id, issued.photoId), 'INVALID_REQUEST');
    // Still pending, so the helper can upload and confirm again.
    expect((await photos.findById(issued.photoId))?.status).toBe('pending');
    await flush();
    expect(events).toEqual([]);
  });

  it('rejects the wrong size and deletes the object', async () => {
    const id = await claimed();
    const { photoId, key } = await uploaded(id, 5 * MB + 1);

    await expectCode(uploads.confirmUpload(id, photoId), 'INVALID_REQUEST');
    expect(r2.objects.has(key)).toBe(false);
    expect(await photos.findById(photoId)).toBeNull();
    expect((await sessionsRepo.findById(id))?.photosInFlight).toBe(0);
    await flush();
    expect(photoEvents('photo.uploaded')).toEqual([]);
    expect(photoEvents('photo.discarded')).toHaveLength(1);
  });

  it('rejects confirm after revoke', async () => {
    const id = await claimed();
    const { photoId, key } = await uploaded(id);
    await sessions.revokeSession(id);

    await expectCode(uploads.confirmUpload(id, photoId), 'SESSION_GONE');
    expect(r2.objects.has(key)).toBe(false);
    await flush();
    expect(photoEvents('photo.uploaded')).toEqual([]);
  });

  it('accepts confirm after finish', async () => {
    const id = await claimed();
    const { photoId } = await uploaded(id);
    await sessions.finish(id);

    await expect(uploads.confirmUpload(id, photoId)).resolves.toMatchObject({
      status: 'uploaded',
    });
    await flush();
    expect(photoEvents('photo.uploaded')).toHaveLength(1);
  });

  it('deletes a late upload after revoke instead of promoting it', async () => {
    const id = await claimed();
    const { photoId, key } = await uploaded(id);
    await sessions.revokeSession(id);

    await expect(uploads.reconcileStale(photoId)).resolves.toBe('deleted');
    expect(r2.objects.has(key)).toBe(false);
    expect(await photos.findById(photoId)).toBeNull();
    await flush();
    expect(photoEvents('photo.uploaded')).toEqual([]);
  });

  it("refuses another session's photo", async () => {
    const a = await claimed();
    const b = await claimed();
    const { photoId } = await uploaded(a);
    await expectCode(uploads.confirmUpload(b, photoId), 'NOT_FOUND');
  });

  it('reconcileStale promotes an uploaded object and discards a missing one', async () => {
    const id = await claimed();
    const good = await uploaded(id);
    const missing = await uploads.issueUploadUrl(id, 'image/jpeg');

    await expect(uploads.reconcileStale(good.photoId)).resolves.toBe('promoted');
    await expect(uploads.reconcileStale(missing.photoId)).resolves.toBe('discarded');
    await expect(uploads.reconcileStale(good.photoId)).resolves.toBe('skipped');
    await flush();
    expect(photoEvents('photo.uploaded')).toHaveLength(1);
    expect(photoEvents('photo.discarded')).toEqual([
      { name: 'photo.discarded', payload: { sessionId: id, photoId: missing.photoId } },
    ]);
    expect((await sessionsRepo.findById(id))?.photosInFlight).toBe(0);
  });
});
