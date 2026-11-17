import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import { TEST_R2_SETTINGS } from '../src/database/testing/in-memory-r2';
import { openTestDb, type TestDb } from '../src/database/testing/test-db';

// Routes and guards only. The delivery rules are covered by delivery.service.spec.ts with
// the in-memory R2.
describe('delivery API (e2e)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;

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
        push: { apns: null, fcm: null },
      },
      { silent: true },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
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

  async function claimedSession() {
    const created = (await call('POST', '/sessions')).json<{
      sessionId: string;
      link: string;
      requesterToken: string;
    }>();
    const secret = new URL(created.link).searchParams.get('t') ?? '';
    const claim = await call('POST', `/sessions/${created.sessionId}/claim`, undefined, { secret });
    return { ...created, helperToken: claim.json<{ helperToken: string }>().helperToken };
  }

  it('lists pending photos for the requester only', async () => {
    const s = await claimedSession();
    const res = await call('GET', `/sessions/${s.sessionId}/photos`, s.requesterToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'claimed', photos: [] });

    const asHelper = await call('GET', `/sessions/${s.sessionId}/photos`, s.helperToken);
    expect(asHelper.statusCode).toBe(401);

    const other = await claimedSession();
    const wrongSession = await call('GET', `/sessions/${other.sessionId}/photos`, s.requesterToken);
    expect(wrongSession.statusCode).toBe(401);
  });

  it('download and ack take the requester token and hide unknown photos', async () => {
    const s = await claimedSession();
    for (const [method, path] of [
      ['GET', `/photos/${randomUUID()}/download`],
      ['POST', `/photos/${randomUUID()}/ack`],
      ['POST', '/photos/not-a-uuid/ack'],
    ] as const) {
      const unknown = await call(method, path, s.requesterToken);
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json<{ code: string }>().code).toBe('NOT_FOUND');
      expect((await call(method, path, s.helperToken)).statusCode).toBe(401);
      expect((await call(method, path)).statusCode).toBe(401);
    }
  });

  it('list after revoke is SESSION_GONE', async () => {
    const s = await claimedSession();
    await call('POST', `/sessions/${s.sessionId}/revoke`, s.requesterToken);
    const res = await call('GET', `/sessions/${s.sessionId}/photos`, s.requesterToken);
    expect(res.statusCode).toBe(410);
    expect(res.json<{ code: string }>().code).toBe('SESSION_GONE');
  });
});
