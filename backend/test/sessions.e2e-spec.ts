import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import { openTestDb, type TestDb } from '../src/database/testing/test-db';
import { EVENT_BUS, type EventPayload, type PostgresEventBus } from '../src/eventbus';
import { TEST_R2_SETTINGS } from '../src/database/testing/in-memory-r2';

describe('sessions API (e2e)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  const finishRequests: EventPayload[] = [];

  beforeAll(async () => {
    db = await openTestDb();
    app = await createApp(
      {
        nodeEnv: 'test',
        port: 0,
        webOrigin: 'https://picplease.app',
        databaseUrl: db.databaseUrl,
        linkBaseUrl: 'https://picplease.app',
        rateLimit: { max: 100, windowMs: 60_000 },
        r2: { ...TEST_R2_SETTINGS },
      },
      { silent: true },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const bus = app.get<PostgresEventBus>(EVENT_BUS);
    bus.subscribe('session.finish-requested', (p) => {
      finishRequests.push(p);
    });
    await bus.whenListening();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  function call(method: 'GET' | 'POST', url: string, token?: string, payload?: object) {
    return app.inject({
      method,
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function create() {
    const res = await call('POST', '/sessions');
    expect(res.statusCode).toBe(200);
    const body = res.json<{ sessionId: string; link: string; requesterToken: string }>();
    const secret = new URL(body.link).searchParams.get('t') ?? '';
    return { ...body, secret };
  }

  async function claim(id: string, secret: string) {
    const res = await call('POST', `/sessions/${id}/claim`, undefined, { secret });
    expect(res.statusCode).toBe(200);
    return res.json<{ helperToken: string }>().helperToken;
  }

  const state = async (id: string, token: string) =>
    (await call('GET', `/sessions/${id}`, token)).json<{ state: string }>().state;

  it('create, claim, status, finish with grace, resume, finish', async () => {
    const s = await create();
    expect(s.link).toMatch(/^https:\/\/picplease\.app\/s\/[0-9a-f-]{36}\?t=[\w-]{43}$/);
    expect(await state(s.sessionId, s.requesterToken)).toBe('pending');

    const helper = await claim(s.sessionId, s.secret);
    expect(await state(s.sessionId, helper)).toBe('claimed');

    const again = await call('POST', `/sessions/${s.sessionId}/claim`, undefined, {
      secret: s.secret,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'ALREADY_CLAIMED' });

    const grace = await call('POST', `/sessions/${s.sessionId}/finish`, helper, {
      graceSeconds: 120,
    });
    expect(grace.statusCode).toBe(200);
    expect(grace.json()).toMatchObject({ state: 'claimed' });
    await new Promise((r) => setTimeout(r, 200));
    expect(finishRequests).toContainEqual({ sessionId: s.sessionId, graceSeconds: 30 });

    expect((await call('POST', `/sessions/${s.sessionId}/resume`, helper)).statusCode).toBe(200);

    const now = await call('POST', `/sessions/${s.sessionId}/finish`, helper);
    expect(now.statusCode).toBe(200);
    expect(now.json()).toMatchObject({ state: 'finished' });
    expect(await state(s.sessionId, s.requesterToken)).toBe('finished');
  });

  it('a helper beacon can finish with the token in the body', async () => {
    const s = await create();
    const helper = await claim(s.sessionId, s.secret);
    const res = await call('POST', `/sessions/${s.sessionId}/finish`, undefined, {
      token: helper,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'finished' });
  });

  it('revoke stops the session and locks the helper out', async () => {
    const s = await create();
    const helper = await claim(s.sessionId, s.secret);

    expect((await call('POST', `/sessions/${s.sessionId}/revoke`, helper)).statusCode).toBe(401);
    const res = await call('POST', `/sessions/${s.sessionId}/revoke`, s.requesterToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: 'revoked' });

    const twice = await call('POST', `/sessions/${s.sessionId}/revoke`, s.requesterToken);
    expect(twice.statusCode).toBe(410);
    expect(twice.json()).toMatchObject({ code: 'SESSION_GONE' });
    expect((await call('GET', `/sessions/${s.sessionId}`, helper)).statusCode).toBe(401);
  });

  it('refuses bad input and wrong secrets without leaking', async () => {
    const s = await create();
    const wrong = await call('POST', `/sessions/${s.sessionId}/claim`, undefined, {
      secret: 'x'.repeat(43),
    });
    const unknown = await call('POST', '/sessions/not-a-uuid/claim', undefined, {
      secret: s.secret,
    });
    expect(wrong.statusCode).toBe(404);
    expect(unknown.json()).toEqual(wrong.json());

    const missing = await call('POST', `/sessions/${s.sessionId}/claim`, undefined, {});
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    expect((await call('GET', `/sessions/${s.sessionId}`)).statusCode).toBe(401);
  });
});
