import { TokenService } from '../auth/token.service';
import type { AppConfig } from '../common/config/config';
import { AppError } from '../common/errors';
import { DevicesRepository } from '../database/devices.repository';
import { SessionsRepository } from '../database/sessions.repository';
import { openTestDb, type TestDb } from '../database/testing/test-db';
import { InMemoryEventBus } from '../eventbus';
import { PresenceService } from '../realtime/presence.service';
import type { QrService } from '../sessions/qr.service';
import { SessionsService } from '../sessions/sessions.service';
import { NotificationsService } from './notifications.service';
import { PhotoListener } from './photo.listener';
import { RecordingPushProvider } from './testing/recording-push-provider';

const config = { linkBaseUrl: 'https://picplease.app' } as AppConfig;
const fakeQr = { renderPng: () => Promise.resolve(Buffer.from('png')) } as unknown as QrService;
const IOS_TOKEN = 'a'.repeat(64);
const ANDROID_TOKEN = 'fcm-token:APA91b_example-token';

describe('Notifications', () => {
  let db: TestDb;
  let devices: DevicesRepository;
  let sessions: SessionsService;
  let bus: InMemoryEventBus;
  let presence: PresenceService;
  let push: RecordingPushProvider;
  let notifications: NotificationsService;
  let listener: PhotoListener;

  beforeAll(async () => {
    db = await openTestDb();
    devices = new DevicesRepository(db.database);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    bus = new InMemoryEventBus();
    sessions = new SessionsService(
      new SessionsRepository(db.database),
      db.database,
      new TokenService(),
      fakeQr,
      bus,
      config,
    );
    presence = new PresenceService();
    push = new RecordingPushProvider();
    notifications = new NotificationsService(devices, push);
    listener = new PhotoListener(bus, presence, notifications);
    listener.onModuleInit();
  });

  afterEach(() => {
    listener.onModuleDestroy();
  });

  async function claimed(): Promise<string> {
    const s = await sessions.createSession();
    await sessions.claimSession(s.sessionId, new URL(s.link).searchParams.get('t') ?? '');
    return s.sessionId;
  }

  /** Publishes photo.uploaded and lets the listener's database work finish. */
  async function photoUploaded(sessionId: string, photoId = crypto.randomUUID()): Promise<void> {
    await bus.publish('photo.uploaded', { sessionId, photoId });
    await new Promise((r) => setTimeout(r, 50));
  }

  it('pushes when the requester is offline', async () => {
    const id = await claimed();
    await notifications.registerDevice(id, 'ios', IOS_TOKEN);
    await photoUploaded(id);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.target).toEqual({ platform: 'ios', token: IOS_TOKEN });
  });

  it('does not push when the requester is online', async () => {
    const id = await claimed();
    await notifications.registerDevice(id, 'ios', IOS_TOKEN);
    presence.markConnected(id, 'requester');
    await photoUploaded(id);
    expect(push.sent).toHaveLength(0);

    // Going offline later does not use up the cooldown: the next photo still pushes.
    presence.markDisconnected(id, 'requester');
    await photoUploaded(id);
    expect(push.sent).toHaveLength(1);
  });

  it('sends one push per burst, with one collapse key', async () => {
    const id = await claimed();
    await notifications.registerDevice(id, 'android', ANDROID_TOKEN);
    await Promise.all([photoUploaded(id), photoUploaded(id), photoUploaded(id)]);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.message.collapseKey).toBe(`photos-${id}`);

    // Once the 60 s cooldown has passed, the next photo pushes again.
    await db.pool.query(
      "UPDATE sessions SET last_push_at = now() - interval '61 seconds' WHERE id = $1",
      [id],
    );
    await photoUploaded(id);
    expect(push.sent).toHaveLength(2);
    expect(push.sent[1]?.message.collapseKey).toBe(`photos-${id}`);
  });

  it('removes a token the provider says is gone', async () => {
    const id = await claimed();
    await notifications.registerDevice(id, 'ios', IOS_TOKEN);
    await notifications.registerDevice(id, 'android', ANDROID_TOKEN);
    push.outcomes.set(IOS_TOKEN, 'invalid-token');
    push.outcomes.set(ANDROID_TOKEN, 'failed');

    expect(await notifications.notifyPhotoReady(id)).toBe(0);
    const left = await devices.listForSession(id);
    expect(left.map((d) => d.pushToken)).toEqual([ANDROID_TOKEN]);
  });

  it('registering twice updates instead of adding a row', async () => {
    const id = await claimed();
    await notifications.registerDevice(id, 'ios', IOS_TOKEN);
    await notifications.registerDevice(id, 'android', IOS_TOKEN);
    let rows = await devices.listForSession(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform).toBe('android');

    await notifications.registerDevice(id, 'android', ANDROID_TOKEN);
    rows = await devices.listForSession(id);
    expect(rows).toHaveLength(2);

    await sessions.revokeSession(id);
    const err: unknown = await notifications
      .registerDevice(id, 'ios', IOS_TOKEN)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('SESSION_GONE');
  });

  it('puts no photo content in the message', async () => {
    const id = await claimed();
    await notifications.registerDevice(id, 'ios', IOS_TOKEN);
    const photoId = crypto.randomUUID();
    await photoUploaded(id, photoId);
    expect(push.sent).toHaveLength(1);
    const message = push.sent[0]?.message;
    expect(message).toEqual({
      title: 'PicPlease',
      body: 'You have new photos to save.',
      collapseKey: `photos-${id}`,
      data: { type: 'photo.ready', sessionId: id },
    });
    const text = JSON.stringify(message);
    expect(text).not.toContain(photoId);
    expect(text).not.toMatch(/https?:|r2|\.jpe?g/i);
  });
});
