import { Readable } from 'node:stream';
import { MAX_SIGNED_URL_TTL_SECONDS, type R2Client, S3R2Client } from './r2.client';
import { buildKey, InvalidR2KeyError, isR2Key, type R2Key } from './r2-key';
import { InMemoryR2Client } from './testing/in-memory-r2';

const SESSION = '0b6f3a8e-2f4c-4c55-9d7e-1a2b3c4d5e6f';
const PHOTO = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
const KEY = buildKey(SESSION, PHOTO);
const NOW = new Date('2026-11-15T10:00:00.000Z');
const SETTINGS = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'picplease-photos-test',
  accessKeyId: 'AKIDTEST',
  secretAccessKey: 'super-secret-value',
};

interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  body: string;
}
interface FakeResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

/** Replaces the SDK's HTTP layer: records each request and answers with `respond`. */
function fakeS3(respond: (req: FakeRequest) => FakeResponse) {
  const requests: FakeRequest[] = [];
  const requestHandler = {
    handle: (request: {
      method: string;
      path: string;
      query?: Record<string, unknown>;
      body?: unknown;
    }) => {
      const req: FakeRequest = {
        method: request.method,
        path: request.path,
        query: request.query ?? {},
        body: typeof request.body === 'string' ? request.body : '',
      };
      requests.push(req);
      const res = respond(req);
      return Promise.resolve({
        response: {
          statusCode: res.statusCode,
          headers: res.headers ?? {},
          body: Readable.from([Buffer.from(res.body ?? '')]),
        },
      });
    },
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
  };
  const client = new S3R2Client(SETTINGS, () => NOW, {
    requestHandler,
    maxAttempts: 1,
  });
  return { client, requests };
}

const deleteResult = (errors: { key: string; code: string }[] = []) =>
  `<?xml version="1.0" encoding="UTF-8"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${errors
    .map((e) => `<Error><Key>${e.key}</Key><Code>${e.code}</Code><Message>x</Message></Error>`)
    .join('')}</DeleteResult>`;

function keyFor(i: number): R2Key {
  const tail = i.toString(16).padStart(12, '0');
  return buildKey(SESSION, `00000000-0000-4000-8000-${tail}`);
}

describe('buildKey', () => {
  it('builds sessions/{sessionId}/{photoId}.jpg', () => {
    expect(KEY).toBe(`sessions/${SESSION}/${PHOTO}.jpg`);
    expect(isR2Key(KEY)).toBe(true);
  });

  it.each([
    ['not-a-uuid', PHOTO],
    [SESSION, '../../other'],
    [SESSION, `${PHOTO}/x`],
    [SESSION.toUpperCase(), PHOTO],
    ['', PHOTO],
  ])('refuses ids %s / %s', (sessionId, photoId) => {
    expect(() => buildKey(sessionId, photoId)).toThrow(InvalidR2KeyError);
  });
});

describe('S3R2Client', () => {
  it('head on a missing object returns null', async () => {
    const { client, requests } = fakeS3(() => ({ statusCode: 404 }));
    await expect(client.head(KEY)).resolves.toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'HEAD',
      path: `/${SETTINGS.bucket}/${KEY}`,
    });
  });

  it('head returns size, type and etag', async () => {
    const { client } = fakeS3(() => ({
      statusCode: 200,
      headers: { 'content-length': '12345', 'content-type': 'image/jpeg', etag: '"abc"' },
    }));
    await expect(client.head(KEY)).resolves.toEqual({
      size: 12345,
      contentType: 'image/jpeg',
      etag: '"abc"',
    });
  });

  it('head passes on other errors', async () => {
    const { client } = fakeS3(() => ({ statusCode: 403 }));
    await expect(client.head(KEY)).rejects.toBeDefined();
  });

  it('delete twice succeeds both times', async () => {
    let calls = 0;
    // R2 answers 204 for a missing key; a 404 is tolerated too.
    const { client, requests } = fakeS3(() => ({ statusCode: calls++ === 0 ? 204 : 404 }));
    await expect(client.delete(KEY)).resolves.toBeUndefined();
    await expect(client.delete(KEY)).resolves.toBeUndefined();
    expect(requests.map((r) => r.method)).toEqual(['DELETE', 'DELETE']);
  });

  it('signed URLs expire after the ttl', async () => {
    const { client, requests } = fakeS3(() => ({ statusCode: 500 }));
    const upload = await client.signUpload(KEY, 'image/jpeg', 600);
    const download = await client.signDownload(KEY, 120);

    const up = new URL(upload.url);
    expect(up.origin + up.pathname).toBe(`${SETTINGS.endpoint}/${SETTINGS.bucket}/${KEY}`);
    expect(up.searchParams.get('X-Amz-Date')).toBe('20261115T100000Z');
    expect(up.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(upload.expiresAt).toEqual(new Date('2026-11-15T10:10:00.000Z'));

    const down = new URL(download.url);
    expect(down.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(download.expiresAt).toEqual(new Date('2026-11-15T10:02:00.000Z'));

    // Signing is local: nothing went over the network.
    expect(requests).toHaveLength(0);
  });

  it('refuses a ttl outside 1 s to 7 days', async () => {
    const { client } = fakeS3(() => ({ statusCode: 500 }));
    for (const ttl of [0, -1, 1.5, MAX_SIGNED_URL_TTL_SECONDS + 1]) {
      await expect(client.signUpload(KEY, 'image/jpeg', ttl)).rejects.toThrow(RangeError);
      await expect(client.signDownload(KEY, ttl)).rejects.toThrow(RangeError);
    }
  });

  it('signs the content type and adds no checksum parameters to the upload URL', async () => {
    const { client } = fakeS3(() => ({ statusCode: 500 }));
    const upload = await client.signUpload(KEY, 'image/jpeg', 600);
    const url = new URL(upload.url);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(upload.headers).toEqual({ 'content-type': 'image/jpeg' });
    expect([...url.searchParams.keys()].some((k) => /checksum/i.test(k))).toBe(false);
    expect(upload.url).not.toContain(SETTINGS.secretAccessKey);
  });

  it('refuses a content type that is not a plain type/subtype', async () => {
    const { client } = fakeS3(() => ({ statusCode: 500 }));
    for (const type of ['', 'image', 'image/jpeg\r\nx-evil: 1', 'image/jpeg; q=1']) {
      await expect(client.signUpload(KEY, type, 600)).rejects.toThrow(RangeError);
    }
  });

  it('never takes a key that buildKey did not make', async () => {
    const { client, requests } = fakeS3(() => ({ statusCode: 200 }));
    const fromClient = [
      'sessions/../secrets.txt',
      `sessions/${SESSION}/${PHOTO}.jpg/../../x.jpg`,
      `sessions/${SESSION}/other.jpg`,
      `${PHOTO}.jpg`,
      '',
    ] as R2Key[];
    for (const key of fromClient) {
      await expect(client.signUpload(key, 'image/jpeg', 60)).rejects.toThrow(InvalidR2KeyError);
      await expect(client.signDownload(key, 60)).rejects.toThrow(InvalidR2KeyError);
      await expect(client.head(key)).rejects.toThrow(InvalidR2KeyError);
      await expect(client.delete(key)).rejects.toThrow(InvalidR2KeyError);
      await expect(client.deleteMany([KEY, key])).rejects.toThrow(InvalidR2KeyError);
    }
    expect(requests).toHaveLength(0);
  });

  it('deleteMany batches by 1000, ignores missing keys and reports refusals', async () => {
    const keys = Array.from({ length: 1001 }, (_, i) => keyFor(i));
    const [missing, refused] = [keyFor(0), keyFor(1)];
    let call = 0;
    const { client, requests } = fakeS3(() => ({
      statusCode: 200,
      body:
        call++ === 0
          ? deleteResult([
              { key: missing, code: 'NoSuchKey' },
              { key: refused, code: 'AccessDenied' },
            ])
          : deleteResult(),
    }));
    const result = await client.deleteMany([...keys, missing]);
    expect(result).toEqual({ failed: [refused] });
    expect(requests.every((r) => r.method === 'POST' && 'delete' in r.query)).toBe(true);
    expect(requests.map((r) => (r.body.match(/<Key>/g) ?? []).length)).toEqual([1000, 1]);
  });

  it('deleteMany with no keys sends nothing', async () => {
    const { client, requests } = fakeS3(() => ({ statusCode: 500 }));
    await expect(client.deleteMany([])).resolves.toEqual({ failed: [] });
    expect(requests).toHaveLength(0);
  });
});

describe.each<[string, () => R2Client & { put?: (k: R2Key, size: number) => void }]>([
  ['InMemoryR2Client', () => new InMemoryR2Client(() => NOW)],
])('%s', (_name, make) => {
  it('head on missing returns null, after put returns the size', async () => {
    const r2 = make() as InMemoryR2Client;
    await expect(r2.head(KEY)).resolves.toBeNull();
    r2.put(KEY, 42);
    await expect(r2.head(KEY)).resolves.toMatchObject({ size: 42, contentType: 'image/jpeg' });
  });

  it('delete twice succeeds', async () => {
    const r2 = make() as InMemoryR2Client;
    r2.put(KEY, 1);
    await r2.delete(KEY);
    await r2.delete(KEY);
    await expect(r2.head(KEY)).resolves.toBeNull();
  });

  it('signed URLs carry the expiry', async () => {
    const r2 = make();
    const upload = await r2.signUpload(KEY, 'image/jpeg', 600);
    expect(upload.expiresAt).toEqual(new Date('2026-11-15T10:10:00.000Z'));
    await expect(r2.signDownload(KEY, 0)).rejects.toThrow(RangeError);
  });

  it('refuses a key that buildKey did not make', async () => {
    const r2 = make();
    await expect(r2.head('sessions/../x' as R2Key)).rejects.toThrow(InvalidR2KeyError);
  });
});
