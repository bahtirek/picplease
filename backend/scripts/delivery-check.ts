import { WebSocket } from 'ws';
import { createApp } from '../src/app.factory';
import { loadConfig, PRODUCTION_BUCKET } from '../src/common/config/config';
import { S3R2Client } from '../src/database/r2.client';
import { buildKey } from '../src/database/r2-key';
import { EVENT_BUS, type PostgresEventBus } from '../src/eventbus';

// Scripted client: moves one photo end to end through the API and the DEV bucket.
// Run with `npm run delivery:check` (needs DATABASE_URL to a migrated *_dev database and
// the dev R2 settings). Prints only pass/fail lines: never URLs, keys or tokens.

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

function refuseProduction(): void {
  const env = process.env;
  const dbName = new URL(env.DATABASE_URL ?? 'postgres://x/none').pathname.slice(1);
  if (
    env.NODE_ENV === 'production' ||
    env.R2_BUCKET === PRODUCTION_BUCKET ||
    !/_(dev|test)$/.test(dbName)
  ) {
    console.error('Refusing to run: needs a *_dev or *_test database and the dev bucket');
    process.exit(1);
  }
}

/** A tiny JPEG-shaped body (SOI ... EOI). R2 does not inspect it. */
function sampleJpeg(): Buffer {
  const body = Buffer.alloc(2048);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31) % 256;
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), body, Buffer.from([0xff, 0xd9])]);
}

interface Message {
  type: string;
  data: Record<string, unknown>;
}

async function main(): Promise<void> {
  refuseProduction();
  // PORT is required by config but unused: the check listens on a free port.
  const config = loadConfig({ ...process.env, NODE_ENV: 'development', PORT: '1' });
  const app = await createApp(config, { silent: true });
  await app.listen(0, '127.0.0.1');
  await app.get<PostgresEventBus>(EVENT_BUS).whenListening();
  const address = app.getHttpServer().address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${String(address.port)}`;
  const r2 = new S3R2Client(config.r2);

  // T names the expected response body at each call; it is not checked at runtime.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async function api<T>(method: string, path: string, token?: string, body?: object) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  try {
    // Session and claim.
    const created = await api<{ sessionId: string; link: string; requesterToken: string }>(
      'POST',
      '/sessions',
    );
    const { sessionId, requesterToken } = created.body;
    const secret = new URL(created.body.link).searchParams.get('t') ?? '';
    check('create session', created.status === 201 || created.status === 200);

    // Requester listens on the WebSocket.
    const messages: Message[] = [];
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    ws.on('message', (data) => {
      messages.push(JSON.parse((data as Buffer).toString('utf8')) as Message);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        resolve();
      });
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({ type: 'auth', token: requesterToken }));
    const waitFor = async (type: string) => {
      for (let i = 0; i < 100; i++) {
        const found = messages.find((m) => m.type === type);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 100));
      }
      return undefined;
    };
    check('requester snapshot', (await waitFor('snapshot')) !== undefined);

    const claim = await api<{ helperToken: string }>('POST', `/sessions/${sessionId}/claim`, '', {
      secret,
    });
    const { helperToken } = claim.body;
    check('claim', claim.status === 200);

    // Helper uploads straight to R2.
    const issued = await api<{ photoId: string; url: string; headers: Record<string, string> }>(
      'POST',
      `/sessions/${sessionId}/photos`,
      helperToken,
      { contentType: 'image/jpeg' },
    );
    const { photoId } = issued.body;
    check(
      'issue upload URL',
      issued.status === 200,
      `status ${String(issued.status)} ${(issued.body as { code?: string }).code ?? ''}`,
    );
    if (issued.status !== 200) throw new Error('cannot continue without an upload URL');
    const jpeg = sampleJpeg();
    const put = await fetch(issued.body.url, {
      method: 'PUT',
      body: jpeg,
      headers: issued.body.headers,
    });
    await put.arrayBuffer();
    check('PUT to R2', put.status === 200, `status ${String(put.status)}`);
    const confirm = await api('POST', `/photos/${photoId}/confirm`, helperToken);
    check('confirm', confirm.status === 200, `status ${String(confirm.status)}`);
    const ready = await waitFor('photo.ready');
    check('requester got photo.ready', ready?.data.photoId === photoId);

    // Requester downloads straight from R2.
    const list = await api<{ photos: { photoId: string }[] }>(
      'GET',
      `/sessions/${sessionId}/photos`,
      requesterToken,
    );
    check(
      'pending list has the photo',
      list.body.photos.some((p) => p.photoId === photoId),
    );
    const download = await api<{ url: string }>(
      'GET',
      `/photos/${photoId}/download`,
      requesterToken,
    );
    check('download URL', download.status === 200);
    const got = Buffer.from(await (await fetch(download.body.url)).arrayBuffer());
    check('downloaded bytes match', got.equals(jpeg));

    const ack = await api('POST', `/photos/${photoId}/ack`, requesterToken);
    check('ack', ack.status === 200);
    check('object deleted from R2', (await r2.head(buildKey(sessionId, photoId))) === null);

    // Helper finishes: nothing in flight, everything downloaded, so the window closes.
    const finish = await api('POST', `/sessions/${sessionId}/finish`, helperToken, {});
    check('finish', finish.status === 200, `status ${String(finish.status)}`);
    const closed = await waitFor('window.closed');
    check('requester got window.closed (delivered 1)', closed?.data.delivered === 1);
    const status = await api<{ state: string }>('GET', `/sessions/${sessionId}`, requesterToken);
    check('session closed', status.body.state === 'closed', status.body.state);
    ws.close();
  } finally {
    await app.close();
  }
  console.log(failures === 0 ? 'All checks passed' : `${String(failures)} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`delivery check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
