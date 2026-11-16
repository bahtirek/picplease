import { randomUUID } from 'node:crypto';
import { Controller, Get, Module, Param, Post, UseGuards } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.factory';
import {
  Auth,
  type AuthContext,
  AuthModule,
  HelperGuard,
  RateLimited,
  RequesterGuard,
  TokenService,
} from '../src/auth';
import { SessionsRepository } from '../src/database/sessions.repository';
import { openTestDb, type TestDb } from '../src/database/testing/test-db';

@Controller('auth-test/:id')
class ProbeController {
  @Get('requester')
  @UseGuards(RequesterGuard)
  requester(@Auth() auth: AuthContext): AuthContext {
    return auth;
  }

  @Get('helper')
  @UseGuards(HelperGuard)
  helper(@Auth() auth: AuthContext): AuthContext {
    return auth;
  }

  @Post('beacon')
  @UseGuards(HelperGuard)
  beacon(@Auth() auth: AuthContext): AuthContext {
    return auth;
  }

  @Post('limited')
  @RateLimited()
  limited(@Param('id') id: string): { id: string } {
    return { id };
  }
}

@Module({ imports: [AuthModule], controllers: [ProbeController] })
class ProbeModule {}

describe('auth (e2e)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  const tokens = new TokenService();
  let sessions: SessionsRepository;

  beforeAll(async () => {
    db = await openTestDb();
    app = await createApp(
      {
        nodeEnv: 'test',
        port: 0,
        webOrigin: 'https://picplease.app',
        databaseUrl: db.databaseUrl,
        linkBaseUrl: 'https://picplease.app',
        rateLimit: { max: 3, windowMs: 60_000 },
      },
      { silent: true, imports: [ProbeModule] },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(SessionsRepository);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  /** A pending session with a requester token; claim() adds a helper token. */
  async function newSession(): Promise<{ id: string; requester: string }> {
    const req = tokens.generateToken();
    const session = await sessions.create({
      secretHash: tokens.hash(tokens.generateSecret()),
      requesterTokenHash: req.hash,
    });
    return { id: session.id, requester: tokens.format(session.id, req.random) };
  }

  async function claim(id: string): Promise<string> {
    const helper = tokens.generateToken();
    const claimed = await sessions.claimIfPending(id, helper.hash);
    if (!claimed) throw new Error('claim failed');
    return tokens.format(id, helper.random);
  }

  function get(url: string, token?: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  }

  const UNAUTHORIZED = { code: 'UNAUTHORIZED', message: 'Missing or invalid token.' };

  it('returns UNAUTHORIZED for a missing token', async () => {
    const { id } = await newSession();
    for (const path of ['requester', 'helper']) {
      const res = await get(`/auth-test/${id}/${path}`);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual(UNAUTHORIZED);
    }
    const notBearer = await app.inject({
      method: 'GET',
      url: `/auth-test/${id}/requester`,
      headers: { authorization: 'Basic abc' },
    });
    expect(notBearer.statusCode).toBe(401);
  });

  it('refuses a helper token on requester routes and the reverse', async () => {
    const { id, requester } = await newSession();
    const helper = await claim(id);

    const helperOnRequester = await get(`/auth-test/${id}/requester`, helper);
    expect(helperOnRequester.statusCode).toBe(401);
    expect(helperOnRequester.json()).toEqual(UNAUTHORIZED);

    const requesterOnHelper = await get(`/auth-test/${id}/helper`, requester);
    expect(requesterOnHelper.statusCode).toBe(401);
    expect(requesterOnHelper.json()).toEqual(UNAUTHORIZED);
  });

  it('attaches {sessionId, role} for a valid token', async () => {
    const { id, requester } = await newSession();
    const r = await get(`/auth-test/${id}/requester`, requester);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ sessionId: id, role: 'requester' });

    const helper = await claim(id);
    const h = await get(`/auth-test/${id}/helper`, helper);
    expect(h.statusCode).toBe(200);
    expect(h.json()).toEqual({ sessionId: id, role: 'helper' });
  });

  it('answers a wrong token, an unknown session and a malformed token identically', async () => {
    const { id } = await newSession();
    const wrong = await get(
      `/auth-test/${id}/requester`,
      tokens.format(id, tokens.generateToken().random),
    );
    const unknownId = randomUUID();
    const unknown = await get(
      `/auth-test/${unknownId}/requester`,
      tokens.format(unknownId, tokens.generateToken().random),
    );
    const malformed = await get(`/auth-test/${id}/requester`, 'garbage');
    for (const res of [wrong, unknown, malformed]) {
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe(wrong.body);
    }
  });

  it("refuses a valid token on another session's route", async () => {
    const a = await newSession();
    const b = await newSession();
    const res = await get(`/auth-test/${b.id}/requester`, a.requester);
    expect(res.statusCode).toBe(401);
  });

  it('accepts the helper token only while claimed or finished; the requester always', async () => {
    const { id, requester } = await newSession();
    const helper = await claim(id);
    expect((await get(`/auth-test/${id}/helper`, helper)).statusCode).toBe(200);

    await sessions.transition(id, 'claimed', 'finished');
    expect((await get(`/auth-test/${id}/helper`, helper)).statusCode).toBe(200);

    await sessions.transition(id, 'finished', 'revoked');
    expect((await get(`/auth-test/${id}/helper`, helper)).statusCode).toBe(401);
    expect((await get(`/auth-test/${id}/requester`, requester)).statusCode).toBe(200);
  });

  it('reads the token from the body when there is no Authorization header (web beacon)', async () => {
    const { id } = await newSession();
    const helper = await claim(id);
    const res = await app.inject({
      method: 'POST',
      url: `/auth-test/${id}/beacon`,
      payload: { token: helper },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ sessionId: id, role: 'helper' });
  });

  it('rate limits marked routes per IP with RATE_LIMITED', async () => {
    const id = randomUUID();
    const post = (ip: string) =>
      app.inject({
        method: 'POST',
        url: `/auth-test/${id}/limited`,
        payload: {},
        remoteAddress: ip,
      });
    for (let i = 0; i < 3; i++) expect((await post('10.0.0.1')).statusCode).toBe(201);
    const limited = await post('10.0.0.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests.' });
    expect((await post('10.0.0.2')).statusCode).toBe(201);
    // Unmarked routes are not limited.
    const { id: sid, requester } = await newSession();
    for (let i = 0; i < 5; i++) {
      expect((await get(`/auth-test/${sid}/requester`, requester)).statusCode).toBe(200);
    }
  });
});
