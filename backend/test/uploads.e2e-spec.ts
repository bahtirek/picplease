import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import { TEST_R2_SETTINGS } from '../src/database/testing/in-memory-r2';
import { openTestDb, type TestDb } from '../src/database/testing/test-db';

// Signing is local, so issuing works with the test R2 settings. Paths that call `head`
// are covered by uploads.service.spec.ts with the in-memory R2.
describe('uploads API (e2e)', () => {
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

  function call(method: 'POST', url: string, token?: string, payload?: object) {
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

  it('issues a signed upload URL for JPEG and refuses other types', async () => {
    const s = await claimedSession();
    const res = await call('POST', `/sessions/${s.sessionId}/photos`, s.helperToken, {
      contentType: 'image/jpeg',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ photoId: string; url: string; headers: object; expiresAt: string }>();
    expect(body.url).toContain(`sessions/${s.sessionId}/${body.photoId}.jpg`);
    expect(body.headers).toEqual({ 'content-type': 'image/jpeg' });

    const png = await call('POST', `/sessions/${s.sessionId}/photos`, s.helperToken, {
      contentType: 'image/png',
    });
    expect(png.statusCode).toBe(400);
    expect(png.json<{ code: string }>().code).toBe('INVALID_REQUEST');
  });

  it('confirm route takes the helper token and hides unknown photos', async () => {
    const s = await claimedSession();
    const unknown = await call('POST', `/photos/${randomUUID()}/confirm`, s.helperToken);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json<{ code: string }>().code).toBe('NOT_FOUND');

    const asRequester = await call('POST', `/photos/${randomUUID()}/confirm`, s.requesterToken);
    expect(asRequester.statusCode).toBe(401);
  });
});
