import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.factory';
import { openTestDb, type TestDb } from '../src/database/testing/test-db';
import { EVENT_BUS, type PostgresEventBus } from '../src/eventbus';
import { PresenceService } from '../src/realtime/presence.service';

interface Message {
  type: string;
  data: Record<string, unknown>;
}

const WEB_ORIGIN = 'https://picplease.app';

describe('realtime (e2e)', () => {
  let db: TestDb;
  let app: NestFastifyApplication;
  let url: string;
  let presence: PresenceService;
  const open: WebSocket[] = [];

  beforeAll(async () => {
    db = await openTestDb();
    app = await createApp(
      {
        nodeEnv: 'test',
        port: 0,
        webOrigin: WEB_ORIGIN,
        databaseUrl: db.databaseUrl,
        linkBaseUrl: WEB_ORIGIN,
        rateLimit: { max: 100, windowMs: 60_000 },
      },
      { silent: true },
    );
    await app.listen(0, '127.0.0.1');
    await app.get<PostgresEventBus>(EVENT_BUS).whenListening();
    const address = app.getHttpServer().address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `ws://127.0.0.1:${String(address.port)}/ws`;
    presence = app.get(PresenceService);
  });

  afterEach(() => {
    for (const ws of open.splice(0)) ws.terminate();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  function call(method: 'POST', path: string, token?: string, payload?: object) {
    return app.inject({
      method,
      url: path,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function create() {
    const body = (await call('POST', '/sessions')).json<{
      sessionId: string;
      link: string;
      requesterToken: string;
    }>();
    return { ...body, secret: new URL(body.link).searchParams.get('t') ?? '' };
  }

  async function claim(id: string, secret: string): Promise<string> {
    const res = await call('POST', `/sessions/${id}/claim`, undefined, { secret });
    expect(res.statusCode).toBe(200);
    return res.json<{ helperToken: string }>().helperToken;
  }

  /** A connected socket that records every message and its close code. */
  async function connect(headers: Record<string, string> = {}) {
    const ws = new WebSocket(url, { headers });
    open.push(ws);
    const messages: Message[] = [];
    const waiters: (() => void)[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse((data as Buffer).toString('utf8')) as Message);
      for (const wake of waiters.splice(0)) wake();
    });
    const closed = new Promise<number>((resolve) => {
      ws.on('close', (code) => {
        resolve(code);
      });
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        resolve();
      });
      ws.once('error', reject);
    });
    /** Waits until `count` messages have arrived. */
    const nth = async (count: number): Promise<Message> => {
      while (messages.length < count)
        await new Promise<void>((wake) => {
          waiters.push(wake);
        });
      const message = messages[count - 1];
      if (!message) throw new Error('missing message');
      return message;
    };
    return { ws, messages, closed, nth };
  }

  async function join(token: string) {
    const client = await connect();
    client.ws.send(JSON.stringify({ type: 'auth', token }));
    const snapshot = await client.nth(1);
    expect(snapshot.type).toBe('snapshot');
    return { ...client, snapshot };
  }

  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
    return check();
  };

  it('valid requester token joins and gets a snapshot', async () => {
    const s = await create();
    const { snapshot } = await join(s.requesterToken);
    expect(snapshot.data).toMatchObject({
      role: 'requester',
      session: { sessionId: s.sessionId, state: 'pending' },
      pendingPhotos: [],
    });
  });

  it('helper snapshot carries no photos', async () => {
    const s = await create();
    const helper = await claim(s.sessionId, s.secret);
    const { snapshot } = await join(helper);
    expect(snapshot.data).toMatchObject({ role: 'helper', session: { state: 'claimed' } });
    expect(snapshot.data).not.toHaveProperty('pendingPhotos');
  });

  it('bad token rejected with 4401', async () => {
    const s = await create();
    const wrong = `${s.sessionId}.${'A'.repeat(43)}`;
    for (const message of [
      { type: 'auth', token: wrong },
      { type: 'auth', token: 'garbage' },
      { type: 'hello', token: s.requesterToken },
    ]) {
      const client = await connect();
      client.ws.send(JSON.stringify(message));
      expect(await client.closed).toBe(4401);
      expect(client.messages).toEqual([]);
    }
    const client = await connect();
    client.ws.send('not json');
    expect(await client.closed).toBe(4401);
  });

  it('a gone session closes with 4410', async () => {
    const s = await create();
    expect(
      (await call('POST', `/sessions/${s.sessionId}/revoke`, s.requesterToken)).statusCode,
    ).toBe(200);
    const client = await connect();
    client.ws.send(JSON.stringify({ type: 'auth', token: s.requesterToken }));
    expect(await client.closed).toBe(4410);
  });

  it('browser from another origin refused; WEB_ORIGIN and native allowed', async () => {
    await expect(connect({ origin: 'https://evil.example' })).rejects.toThrow(/403/);
    await expect(connect({ origin: WEB_ORIGIN })).resolves.toBeDefined();
    await expect(connect()).resolves.toBeDefined();
  });

  it('session events reach the right role only', async () => {
    const s = await create();
    const requester = await join(s.requesterToken);
    const helperToken = await claim(s.sessionId, s.secret);
    expect(await requester.nth(2)).toEqual({
      type: 'session.claimed',
      data: { sessionId: s.sessionId },
    });

    const helper = await join(helperToken);
    await call('POST', `/sessions/${s.sessionId}/revoke`, s.requesterToken);
    expect(await helper.nth(2)).toEqual({
      type: 'session.ended',
      data: { sessionId: s.sessionId },
    });
    expect(requester.messages.map((m) => m.type)).toEqual(['snapshot', 'session.claimed']);
  });

  it('isRequesterOnline only while connected; disconnect clears presence', async () => {
    const s = await create();
    expect(presence.isRequesterOnline(s.sessionId)).toBe(false);

    const first = await join(s.requesterToken);
    expect(presence.isRequesterOnline(s.sessionId)).toBe(true);
    const second = await join(s.requesterToken);

    first.ws.close();
    await first.closed;
    expect(await until(() => presence.isRequesterOnline(s.sessionId))).toBe(true);

    second.ws.close();
    await second.closed;
    expect(await until(() => !presence.isRequesterOnline(s.sessionId))).toBe(true);

    const helper = await join(await claim(s.sessionId, s.secret));
    expect(presence.isRequesterOnline(s.sessionId)).toBe(false);
    helper.ws.close();
  });
});
