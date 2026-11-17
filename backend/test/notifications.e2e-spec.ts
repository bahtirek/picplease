import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import { TEST_R2_SETTINGS } from '../src/database/testing/in-memory-r2';
import { openTestDb, type TestDb } from '../src/database/testing/test-db';

// Route, guard and validation only. Push rules are in notifications.service.spec.ts.
describe('device registration API (e2e)', () => {
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

  function call(url: string, token?: string, payload?: object) {
    return app.inject({
      method: 'POST',
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function claimedSession() {
    const created = (await call('/sessions')).json<{
      sessionId: string;
      link: string;
      requesterToken: string;
    }>();
    const secret = new URL(created.link).searchParams.get('t') ?? '';
    const claim = await call(`/sessions/${created.sessionId}/claim`, undefined, { secret });
    return { ...created, helperToken: claim.json<{ helperToken: string }>().helperToken };
  }

  it('registers a device with the requester token only', async () => {
    const s = await claimedSession();
    const url = `/sessions/${s.sessionId}/device`;
    const body = { platform: 'ios', pushToken: 'ab'.repeat(32) };

    const ok = await call(url, s.requesterToken, body);
    expect(ok.statusCode).toBe(204);
    expect((await call(url, s.requesterToken, body)).statusCode).toBe(204);

    expect((await call(url, s.helperToken, body)).statusCode).toBe(401);
    expect((await call(url, undefined, body)).statusCode).toBe(401);
  });

  it('refuses a bad body and a revoked session', async () => {
    const s = await claimedSession();
    const url = `/sessions/${s.sessionId}/device`;
    for (const bad of [
      { platform: 'windows', pushToken: 'abc' },
      { platform: 'ios', pushToken: '' },
      { platform: 'ios', pushToken: 'has space' },
      { platform: 'ios', pushToken: '../x' },
      { platform: 'ios' },
    ]) {
      const res = await call(url, s.requesterToken, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ code: string }>().code).toBe('INVALID_REQUEST');
    }

    await call(`/sessions/${s.sessionId}/revoke`, s.requesterToken);
    const gone = await call(url, s.requesterToken, { platform: 'android', pushToken: 'abc' });
    expect(gone.statusCode).toBe(410);
    expect(gone.json<{ code: string }>().code).toBe('SESSION_GONE');
  });
});
