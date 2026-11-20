import { describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiErrorCode, type UploadTarget } from './api';
import type { CanvasLike } from './compressor';
import type { HelperSession } from './state';
import { MAX_NEW_URLS, RETRY_DELAYS_MS, Uploader, type UploaderDeps } from './uploader';

const SESSION: HelperSession = {
  sessionId: '3428da7f-d9f8-48a5-879b-971b2e1c3a54',
  token: 'session.token',
  limits: { maxInFlight: 5, maxPhotoBytes: 5 * 1024 * 1024, uploadUrlTtlSeconds: 600 },
};
const FRAME = {} as CanvasLike;
const JPEG = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function target(n: number): UploadTarget {
  return {
    photoId: `photo-${String(n)}`,
    url: `https://r2.example/key-${String(n)}?X-Amz-Signature=s`,
    headers: { 'Content-Type': 'image/jpeg' },
    expiresAt: '2026-11-19T10:10:00.000Z',
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<UploaderDeps> = {}) {
  let issued = 0;
  const issueUpload = vi.fn<UploaderDeps['api']['issueUpload']>(() => {
    issued += 1;
    return Promise.resolve(target(issued));
  });
  const confirm = vi.fn<UploaderDeps['api']['confirm']>(() => Promise.resolve());
  const put = vi.fn<NonNullable<UploaderDeps['fetch']>>(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );
  const encode = vi.fn<NonNullable<UploaderDeps['encode']>>(() => Promise.resolve(JPEG));
  const sleep = vi.fn<NonNullable<UploaderDeps['sleep']>>(() => Promise.resolve());
  const onStop = vi.fn<NonNullable<UploaderDeps['onStop']>>();
  const uploader = new Uploader({
    api: { issueUpload, confirm },
    session: SESSION,
    fetch: put,
    encode,
    sleep,
    onStop,
    ...overrides,
  });
  return { uploader, issueUpload, confirm, put, encode, sleep, onStop };
}

const apiError = (code: ApiErrorCode) => new ApiError(code, null);

describe('uploader', () => {
  it('sends one photo: URL, PUT with the signed headers only, confirm', async () => {
    const { uploader, issueUpload, put, confirm } = setup();
    expect(uploader.add(FRAME)).toBe('accepted');
    await uploader.whenIdle();
    expect(issueUpload).toHaveBeenCalledWith(SESSION.sessionId, SESSION.token);
    const [url, init] = put.mock.calls[0] ?? [];
    expect(url).toBe(target(1).url);
    expect(init).toMatchObject({ method: 'PUT', body: JPEG, credentials: 'omit' });
    expect(init?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(confirm).toHaveBeenCalledWith('photo-1', SESSION.token);
    expect(uploader.counts).toEqual({ inFlight: 0, sent: 1, failed: 0 });
  });

  it('never exceeds 5 in flight (test 6)', async () => {
    const gates: Deferred<undefined>[] = [];
    const { uploader, issueUpload } = setup();
    issueUpload.mockImplementation(() => {
      const gate = deferred<undefined>();
      gates.push(gate);
      return gate.promise.then(() => target(gates.length));
    });
    const results = Array.from({ length: 7 }, () => uploader.add(FRAME));
    expect(results).toEqual([...Array<string>(5).fill('accepted'), 'full', 'full']);
    expect(uploader.counts.inFlight).toBe(5);
    expect(uploader.canShoot).toBe(false);
    await flush();
    expect(issueUpload).toHaveBeenCalledTimes(5);

    gates[0]?.resolve(undefined);
    await flush();
    expect(uploader.counts).toMatchObject({ inFlight: 4, sent: 1 });
    expect(uploader.canShoot).toBe(true);
    expect(uploader.add(FRAME)).toBe('accepted');
    expect(uploader.add(FRAME)).toBe('full');
    for (const gate of gates) gate.resolve(undefined);
    await uploader.whenIdle();
    expect(uploader.counts).toEqual({ inFlight: 0, sent: 6, failed: 0 });
  });

  it('requests the upload URL in parallel with compression (test 7)', async () => {
    const encoding = deferred<Blob>();
    const { uploader, issueUpload, put } = setup();
    const encode = vi.fn(() => encoding.promise);
    const parallel = new Uploader({
      api: { issueUpload, confirm: () => Promise.resolve() },
      session: SESSION,
      fetch: put,
      encode,
      sleep: () => Promise.resolve(),
    });
    parallel.add(FRAME);
    expect(encode).toHaveBeenCalledWith(FRAME, SESSION.limits.maxPhotoBytes);
    expect(issueUpload).toHaveBeenCalledOnce();
    await flush();
    expect(put).not.toHaveBeenCalled();
    encoding.resolve(JPEG);
    await parallel.whenIdle();
    expect(put).toHaveBeenCalledOnce();
    expect(uploader.counts.sent).toBe(0);
  });

  it('retries confirm after a network error without duplicating the photo (test 8)', async () => {
    const { uploader, issueUpload, put, confirm, sleep } = setup();
    confirm.mockRejectedValueOnce(apiError('NETWORK'));
    confirm.mockRejectedValueOnce(apiError('INVALID_REQUEST'));
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(confirm.mock.calls.every(([photoId]) => photoId === 'photo-1')).toBe(true);
    expect(issueUpload).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(uploader.counts).toEqual({ inFlight: 0, sent: 1, failed: 0 });
  });

  it('stops on SESSION_FINISHED: no new photos, the ones with a URL finish (test 9)', async () => {
    const firstPut = deferred<Response>();
    const { uploader, issueUpload, put, onStop } = setup();
    put.mockImplementationOnce(() => firstPut.promise);
    uploader.add(FRAME);
    await flush();
    expect(put).toHaveBeenCalledOnce();

    issueUpload.mockRejectedValueOnce(apiError('SESSION_FINISHED'));
    uploader.add(FRAME);
    await flush();
    expect(onStop).toHaveBeenCalledExactlyOnceWith('finished');
    expect(uploader.stopReason).toBe('finished');
    expect(uploader.add(FRAME)).toBe('stopped');
    expect(uploader.canShoot).toBe(false);

    firstPut.resolve(new Response(null, { status: 200 }));
    await uploader.whenIdle();
    expect(uploader.counts).toEqual({ inFlight: 0, sent: 1, failed: 0 });
  });

  it.each(['SESSION_GONE', 'UNAUTHORIZED'] as const)(
    '%s aborts every upload and discards',
    async (code) => {
      const signals: AbortSignal[] = [];
      const { uploader, put, issueUpload, onStop } = setup();
      put.mockImplementation((_url, init) => {
        if (init.signal) signals.push(init.signal);
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      });
      uploader.add(FRAME);
      await flush();
      issueUpload.mockRejectedValueOnce(apiError(code));
      uploader.add(FRAME);
      await uploader.whenIdle();
      expect(onStop).toHaveBeenCalledExactlyOnceWith('gone');
      expect(signals[0]?.aborted).toBe(true);
      expect(uploader.counts).toEqual({ inFlight: 0, sent: 0, failed: 0 });
      expect(uploader.add(FRAME)).toBe('stopped');
    },
  );

  it('end() from outside aborts and discards', async () => {
    const { uploader, put, onStop } = setup();
    put.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    uploader.add(FRAME);
    await flush();
    uploader.end();
    await uploader.whenIdle();
    expect(onStop).toHaveBeenCalledWith('gone');
    expect(uploader.counts.sent + uploader.counts.failed).toBe(0);
  });

  it('waits and tries again when the server says the limit is reached', async () => {
    const { uploader, issueUpload, sleep } = setup();
    issueUpload.mockRejectedValueOnce(apiError('UPLOAD_LIMIT_REACHED'));
    issueUpload.mockRejectedValueOnce(apiError('RATE_LIMITED'));
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(issueUpload).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
    expect(uploader.counts.sent).toBe(1);
  });

  it('gets a new URL when R2 refuses the PUT, up to 3 times', async () => {
    const { uploader, put, issueUpload, confirm } = setup();
    put.mockResolvedValueOnce(new Response(null, { status: 403 }));
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(issueUpload).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1]?.[0]).toBe(target(2).url);
    expect(confirm).toHaveBeenCalledExactlyOnceWith('photo-2', SESSION.token);

    put.mockResolvedValue(new Response(null, { status: 403 }));
    issueUpload.mockClear();
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(issueUpload).toHaveBeenCalledTimes(1 + MAX_NEW_URLS);
    expect(uploader.counts).toEqual({ inFlight: 0, sent: 1, failed: 1 });
  });

  it('retries the same URL after a network error during the PUT', async () => {
    const { uploader, put, issueUpload } = setup();
    put.mockRejectedValueOnce(new TypeError('offline'));
    put.mockResolvedValueOnce(new Response(null, { status: 503 }));
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(put).toHaveBeenCalledTimes(3);
    expect(new Set(put.mock.calls.map(([url]) => url))).toEqual(new Set([target(1).url]));
    expect(issueUpload).toHaveBeenCalledOnce();
    expect(uploader.counts.sent).toBe(1);
  });

  it('counts a photo as failed when retries run out or a call is refused', async () => {
    const { uploader, issueUpload, confirm } = setup();
    issueUpload.mockRejectedValue(apiError('NETWORK'));
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(issueUpload).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
    expect(uploader.counts.failed).toBe(1);

    issueUpload.mockReset().mockResolvedValue(target(9));
    confirm.mockRejectedValueOnce(apiError('NOT_FOUND'));
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(confirm).toHaveBeenCalledOnce();
    expect(uploader.counts).toEqual({ inFlight: 0, sent: 0, failed: 2 });
  });

  it('counts a photo that cannot be compressed as failed', async () => {
    const { uploader, put } = setup({ encode: () => Promise.reject(new Error('too large')) });
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(put).not.toHaveBeenCalled();
    expect(uploader.counts.failed).toBe(1);
  });

  it('reports count changes', async () => {
    const onChange = vi.fn();
    const { uploader } = setup({ onChange });
    uploader.add(FRAME);
    await uploader.whenIdle();
    expect(onChange.mock.calls.map(([c]) => c as unknown)).toEqual([
      { inFlight: 1, sent: 0, failed: 0 },
      { inFlight: 0, sent: 1, failed: 0 },
    ]);
  });
});
