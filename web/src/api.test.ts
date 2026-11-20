import { describe, expect, it } from 'vitest';
import {
  ApiClient,
  ApiError,
  DEFAULT_LIMITS,
  SERVER_ERROR_CODES,
  errorFromResponse,
  type ServerErrorCode,
} from './api';
import { fakeFetch } from './testing/fakeFetch';

const BASE = 'https://api.picplease.app';
const ID = '3428da7f-d9f8-48a5-879b-971b2e1c3a54';
const PHOTO = '7f0c3e1a-5b2d-4c9e-8a1f-2d3e4f5a6b7c';
const TOKEN = `${ID}.tokenRandomPart_abc-123`;
const STATUS = { sessionId: ID, state: 'claimed', createdAt: 'x' };

const STATUS_FOR: Record<ServerErrorCode, number> = {
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  ALREADY_CLAIMED: 409,
  SESSION_FINISHED: 409,
  SESSION_GONE: 410,
  UPLOAD_LIMIT_REACHED: 429,
  RATE_LIMITED: 429,
  INVALID_REQUEST: 400,
  INTERNAL_ERROR: 500,
};

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
}

describe('api error mapping (test 3)', () => {
  it.each(SERVER_ERROR_CODES)('maps %s to its typed error', async (code) => {
    const fetch = fakeFetch({ status: STATUS_FOR[code], body: { code, message: 'm' } });
    const api = new ApiClient({ baseUrl: BASE, fetch });
    const error = await caught(api.issueUpload(ID, TOKEN));
    expect(error.code).toBe(code);
    expect(error.status).toBe(STATUS_FOR[code]);
  });

  it('falls back to the status when the body has no known code', () => {
    expect(errorFromResponse(404, null).code).toBe('NOT_FOUND');
    expect(errorFromResponse(401, 'x').code).toBe('UNAUTHORIZED');
    expect(errorFromResponse(410, { code: 'WHAT' }).code).toBe('SESSION_GONE');
    expect(errorFromResponse(429, {}).code).toBe('RATE_LIMITED');
    expect(errorFromResponse(502, null).code).toBe('INTERNAL_ERROR');
    expect(errorFromResponse(415, null).code).toBe('INVALID_REQUEST');
  });

  it('maps a failed fetch to NETWORK', async () => {
    const api = new ApiClient({ baseUrl: BASE, fetch: fakeFetch(new TypeError('offline')) });
    expect((await caught(api.confirm(PHOTO, TOKEN))).code).toBe('NETWORK');
  });

  it('times out to NETWORK', async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('timeout', 'TimeoutError'));
        });
      });
    const api = new ApiClient({ baseUrl: BASE, fetch: hang, timeoutMs: 10 });
    expect((await caught(api.resume(ID, TOKEN))).code).toBe('NETWORK');
  });

  it('treats an unexpected success body as INTERNAL_ERROR', async () => {
    const api = new ApiClient({ baseUrl: BASE, fetch: fakeFetch({ status: 200, body: {} }) });
    expect((await caught(api.claim(ID, 'secret'))).code).toBe('INTERNAL_ERROR');
  });
});

describe('api calls', () => {
  it('claim sends the secret in the body, no token, and reads the limits', async () => {
    const fetch = fakeFetch({
      status: 201,
      body: {
        sessionId: ID,
        helperToken: TOKEN,
        limits: { maxInFlight: 3, maxPhotoBytes: 1000, uploadUrlTtlSeconds: 60 },
      },
    });
    const result = await new ApiClient({ baseUrl: BASE, fetch }).claim(ID, 'the-secret');
    expect(result).toEqual({
      sessionId: ID,
      helperToken: TOKEN,
      limits: { maxInFlight: 3, maxPhotoBytes: 1000, uploadUrlTtlSeconds: 60 },
    });
    const call = fetch.calls[0];
    expect(call?.url).toBe(`${BASE}/sessions/${ID}/claim`);
    expect(call?.init.method).toBe('POST');
    expect(call?.body).toEqual({ secret: 'the-secret' });
    expect(call?.headers.Authorization).toBeUndefined();
    expect(call?.init.credentials).toBe('omit');
  });

  it('claim falls back to the default limits for missing or bad values', async () => {
    const fetch = fakeFetch({
      status: 201,
      body: { sessionId: ID, helperToken: TOKEN, limits: { maxInFlight: -1 } },
    });
    expect((await new ApiClient({ baseUrl: BASE, fetch }).claim(ID, 's')).limits).toEqual(
      DEFAULT_LIMITS,
    );
  });

  it('issueUpload asks for image/jpeg and returns the signed target', async () => {
    const target = {
      photoId: PHOTO,
      url: 'https://r2.example/key?X-Amz-Signature=abc',
      headers: { 'Content-Type': 'image/jpeg' },
      expiresAt: '2026-11-19T10:00:00.000Z',
    };
    const fetch = fakeFetch({ status: 201, body: target });
    expect(await new ApiClient({ baseUrl: BASE, fetch }).issueUpload(ID, TOKEN)).toEqual(target);
    expect(fetch.calls[0]?.url).toBe(`${BASE}/sessions/${ID}/photos`);
    expect(fetch.calls[0]?.body).toEqual({ contentType: 'image/jpeg' });
  });

  it('confirm, finish and resume hit their routes', async () => {
    const fetch = fakeFetch(
      { status: 200, body: { photoId: PHOTO, status: 'uploaded' } },
      { status: 200, body: STATUS },
      { status: 200, body: STATUS },
      { status: 200, body: STATUS },
    );
    const api = new ApiClient({ baseUrl: BASE, fetch });
    await api.confirm(PHOTO, TOKEN);
    expect(await api.finish(ID, TOKEN)).toEqual({ sessionId: ID, state: 'claimed' });
    await api.finish(ID, TOKEN, 30);
    await api.resume(ID, TOKEN);
    expect(fetch.calls.map((c) => c.url)).toEqual([
      `${BASE}/photos/${PHOTO}/confirm`,
      `${BASE}/sessions/${ID}/finish`,
      `${BASE}/sessions/${ID}/finish`,
      `${BASE}/sessions/${ID}/resume`,
    ]);
    expect(fetch.calls.map((c) => c.body)).toEqual([{}, {}, { graceSeconds: 30 }, {}]);
  });

  it('never puts the token in a URL, only in the Authorization header (test 4)', async () => {
    const fetch = fakeFetch({ status: 200, body: { ...STATUS, photoId: PHOTO, url: 'u' } });
    const api = new ApiClient({ baseUrl: BASE, fetch });
    await api.issueUpload(ID, TOKEN).catch(() => undefined);
    await api.confirm(PHOTO, TOKEN);
    await api.finish(ID, TOKEN, 30);
    await api.resume(ID, TOKEN);
    expect(fetch.calls).toHaveLength(4);
    for (const call of fetch.calls) {
      expect(call.url).not.toContain(TOKEN);
      expect(call.url).not.toContain('tokenRandomPart');
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(JSON.stringify(call.body)).not.toContain(TOKEN);
    }
  });
});
