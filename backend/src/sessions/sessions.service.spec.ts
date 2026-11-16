import { TokenService } from '../auth/token.service';
import type { AppConfig } from '../common/config/config';
import { AppError } from '../common/errors';
import { SessionsRepository } from '../database/sessions.repository';
import { openTestDb, type TestDb } from '../database/testing/test-db';
import { type EventName, type EventPayload, InMemoryEventBus } from '../eventbus';
import type { QrService } from './qr.service';
import { SessionsService } from './sessions.service';

const config = { linkBaseUrl: 'https://picplease.app' } as AppConfig;

// Real rendering is covered in qr.service.spec.ts; it is slow inside Jest's sandbox.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakeQr = { renderPng: () => Promise.resolve(PNG_SIGNATURE) } as unknown as QrService;

describe('SessionsService', () => {
  let db: TestDb;
  let repo: SessionsRepository;
  let bus: InMemoryEventBus;
  let service: SessionsService;
  let events: { name: EventName; payload: EventPayload }[];
  const tokens = new TokenService();

  beforeAll(async () => {
    db = await openTestDb();
    repo = new SessionsRepository(db.database);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    bus = new InMemoryEventBus();
    events = [];
    for (const name of [
      'session.created',
      'session.claimed',
      'session.finished',
      'session.revoked',
      'session.expired',
      'session.closed',
    ] as const) {
      bus.subscribe(name, (payload) => {
        events.push({ name, payload });
      });
    }
    service = new SessionsService(repo, db.database, tokens, fakeQr, bus, config);
  });

  /** InMemoryEventBus delivers on a later microtask. */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    const err: unknown = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }

  /** A created session plus the pairing secret taken from its link. */
  async function created() {
    const result = await service.createSession();
    const secret = new URL(result.link).searchParams.get('t') ?? '';
    return { ...result, secret };
  }

  async function claimed() {
    const s = await created();
    await service.claimSession(s.sessionId, s.secret);
    return s;
  }

  it('create stores only hashes and publishes created', async () => {
    const s = await created();
    const random = s.requesterToken.split('.')[1] ?? '';

    expect(s.link).toBe(`https://picplease.app/s/${s.sessionId}?t=${s.secret}`);
    expect(Buffer.from(s.qrPngBase64, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(s.limits).toEqual({ maxInFlight: 5, maxPhotoBytes: 5242880, uploadUrlTtlSeconds: 600 });

    const { rows } = await db.pool.query<Record<string, unknown>>(
      'SELECT * FROM sessions WHERE id = $1',
      [s.sessionId],
    );
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(s.secret);
    expect(stored).not.toContain(random);
    expect(rows[0]?.secret_hash).toBe(tokens.hash(s.secret));
    expect(rows[0]?.requester_token_hash).toBe(tokens.hash(random));

    await flush();
    expect(events).toEqual([{ name: 'session.created', payload: { sessionId: s.sessionId } }]);
  });

  it('a claim succeeds once and a second conflicts', async () => {
    const s = await created();
    const results = await Promise.allSettled([
      service.claimSession(s.sessionId, s.secret),
      service.claimSession(s.sessionId, s.secret),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect((lost[0]?.reason as AppError).code).toBe('ALREADY_CLAIMED');

    const helperToken = won[0]?.value.helperToken ?? '';
    const session = await repo.findById(s.sessionId);
    expect(session?.state).toBe('claimed');
    expect(session?.helperTokenHash).toBe(tokens.hash(tokens.parse(helperToken)?.random ?? ''));

    await expectCode(service.claimSession(s.sessionId, s.secret), 'ALREADY_CLAIMED');
    await flush();
    expect(events.filter((e) => e.name === 'session.claimed')).toHaveLength(1);
  });

  it('a claim after expiry fails', async () => {
    const s = await created();
    await db.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    await expectCode(service.claimSession(s.sessionId, s.secret), 'SESSION_GONE');
    expect((await repo.findById(s.sessionId))?.state).toBe('pending');
  });

  it('a wrong secret looks like an unknown session', async () => {
    const s = await created();
    const wrong = service.claimSession(s.sessionId, tokens.generateSecret());
    const unknown = service.claimSession('00000000-0000-4000-8000-000000000000', s.secret);
    const malformed = service.claimSession('not-a-uuid', s.secret);
    const errors = await Promise.all(
      [wrong, unknown, malformed].map((p) => p.catch((e: unknown) => e)),
    );
    for (const err of errors) {
      expect(err).toBeInstanceOf(AppError);
      expect({ code: (err as AppError).code, message: (err as AppError).message }).toEqual({
        code: 'NOT_FOUND',
        message: 'Not found.',
      });
    }
    // A wrong secret does not reveal that the session was already claimed either.
    await service.claimSession(s.sessionId, s.secret);
    await expectCode(service.claimSession(s.sessionId, tokens.generateSecret()), 'NOT_FOUND');
  });

  it('revoke works from pending, claimed and finished, refused from terminal', async () => {
    const pending = await created();
    const claimedS = await claimed();
    const finished = await claimed();
    await service.finish(finished.sessionId);

    for (const s of [pending, claimedS, finished]) {
      expect((await service.revokeSession(s.sessionId)).state).toBe('revoked');
    }
    await flush();
    expect(events.filter((e) => e.name === 'session.revoked')).toHaveLength(3);

    const expired = await created();
    await service.expirePending(expired.sessionId);
    const closed = await claimed();
    await service.finish(closed.sessionId);
    await service.markClosed(closed.sessionId);
    for (const s of [pending, expired, closed]) {
      await expectCode(service.revokeSession(s.sessionId), 'SESSION_GONE');
    }
  });

  it('finish only from claimed', async () => {
    const pending = await created();
    await expectCode(service.finish(pending.sessionId), 'INVALID_REQUEST');

    const s = await claimed();
    expect((await service.finish(s.sessionId)).state).toBe('finished');
    await expectCode(service.finish(s.sessionId), 'SESSION_FINISHED');
    await expectCode(service.finish(s.sessionId, 10), 'SESSION_FINISHED');
    await expectCode(service.resume(s.sessionId), 'SESSION_FINISHED');
    expect(await service.markFinished(s.sessionId)).toBe(false);

    await service.revokeSession(s.sessionId);
    await expectCode(service.finish(s.sessionId), 'SESSION_GONE');

    await flush();
    expect(events.filter((e) => e.name === 'session.finished')).toHaveLength(1);
  });

  it('expirePending leaves a claimed session alone', async () => {
    const s = await claimed();
    expect(await service.expirePending(s.sessionId)).toBe(false);
    expect((await repo.findById(s.sessionId))?.state).toBe('claimed');

    const p = await created();
    expect(await service.expirePending(p.sessionId)).toBe(true);
    expect((await repo.findById(p.sessionId))?.state).toBe('expired');
    await flush();
    expect(events.filter((e) => e.name === 'session.expired')).toEqual([
      { name: 'session.expired', payload: { sessionId: p.sessionId } },
    ]);
  });

  it('markClosed only from finished', async () => {
    const pending = await created();
    const s = await claimed();
    expect(await service.markClosed(pending.sessionId)).toBe(false);
    expect(await service.markClosed(s.sessionId)).toBe(false);

    await service.finish(s.sessionId);
    expect(await service.markClosed(s.sessionId)).toBe(true);
    expect(await service.markClosed(s.sessionId)).toBe(false);
    expect((await repo.findById(s.sessionId))?.state).toBe('closed');
    await flush();
    expect(events.filter((e) => e.name === 'session.closed')).toHaveLength(1);
  });
});
