import { describe, expect, it, vi } from 'vitest';
import { ApiError, type UploadTarget } from './api';
import type { MediaDevicesLike, VideoLike } from './camera';
import type { CanvasLike } from './compressor';
import { HelperFlow, type FlowDeps } from './flow';
import { createStore, type HelperSession } from './state';
import { TokenStore, type StorageLike } from './tokenStore';

const SESSION: HelperSession = {
  sessionId: '3428da7f-d9f8-48a5-879b-971b2e1c3a54',
  token: 'session.token',
  limits: { maxInFlight: 2, maxPhotoBytes: 5 * 1024 * 1024, uploadUrlTtlSeconds: 600 },
};
const JPEG = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup() {
  const store = createStore();
  store.set({ screen: 'cameraAccess', session: SESSION });
  const items = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, v),
    removeItem: (k) => items.delete(k),
  };
  const tokens = new TokenStore(storage);
  tokens.save(SESSION);

  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const devices: MediaDevicesLike = { getUserMedia: () => Promise.resolve(stream) };
  const video: VideoLike = {
    srcObject: null,
    muted: false,
    playsInline: false,
    videoWidth: 1920,
    videoHeight: 1080,
    setAttribute: () => undefined,
    play: () => Promise.resolve(),
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => undefined }),
    toBlob: () => undefined,
  };
  let n = 0;
  const api = {
    issueUpload: vi.fn<FlowDeps['api']['issueUpload']>(() => {
      n += 1;
      const target: UploadTarget = {
        photoId: `p${String(n)}`,
        url: `https://r2.example/${String(n)}`,
        headers: {},
        expiresAt: 'x',
      };
      return Promise.resolve(target);
    }),
    confirm: vi.fn<FlowDeps['api']['confirm']>(() => Promise.resolve()),
    finish: vi.fn<FlowDeps['api']['finish']>(() =>
      Promise.resolve({ sessionId: SESSION.sessionId, state: 'finished' as const }),
    ),
  };
  const put = vi.fn<NonNullable<NonNullable<FlowDeps['uploader']>['fetch']>>(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );
  const flow = new HelperFlow({
    store,
    api,
    tokens,
    video,
    devices,
    createCanvas: () => canvas,
    uploader: { fetch: put, encode: () => Promise.resolve(JPEG), sleep: () => Promise.resolve() },
  });
  return { flow, store, api, put, tokens, track };
}

describe('flow', () => {
  it('allow camera, shoot, Finish: waits for uploads, finishes now, thanks', async () => {
    const { flow, store, api, tokens, track } = setup();
    await flow.allowCamera();
    expect(store.get().screen).toBe('shooting');

    expect(flow.shoot()).toBe('accepted');
    await flush();
    expect(store.get().uploads).toEqual({ inFlight: 0, sent: 1, failed: 0 });

    await flow.finishTapped();
    expect(api.finish).toHaveBeenCalledExactlyOnceWith(SESSION.sessionId, SESSION.token);
    expect(store.get().screen).toBe('thanks');
    expect(track.stop).toHaveBeenCalled();
    expect(tokens.load(SESSION.sessionId)).toBeNull();
  });

  it('shows sending while photos are in flight and finishes only after them', async () => {
    const { flow, store, api, put } = setup();
    const slow = deferred<Response>();
    put.mockImplementationOnce(() => slow.promise);
    await flow.allowCamera();
    flow.shoot();
    await flush();

    const finishing = flow.finishTapped();
    await flush();
    expect(store.get().screen).toBe('sending');
    expect(api.finish).not.toHaveBeenCalled();

    slow.resolve(new Response(null, { status: 200 }));
    await finishing;
    expect(api.finish).toHaveBeenCalledOnce();
    expect(store.get()).toMatchObject({ screen: 'thanks', uploads: { sent: 1 } });
  });

  it('blocks the shutter offline and when the limit is reached', async () => {
    const { flow, put } = setup();
    put.mockImplementation(() => new Promise(() => undefined));
    await flow.allowCamera();
    flow.setOnline(false);
    expect(flow.shoot()).toBe('offline');
    flow.setOnline(true);
    expect([flow.shoot(), flow.shoot(), flow.shoot()]).toEqual(['accepted', 'accepted', 'full']);
  });

  it('goes to ended when the session is gone, without calling finish', async () => {
    const { flow, store, api, tokens } = setup();
    api.issueUpload.mockRejectedValueOnce(new ApiError('SESSION_GONE', 410));
    await flow.allowCamera();
    flow.shoot();
    await flush();
    expect(store.get().screen).toBe('ended');
    expect(api.finish).not.toHaveBeenCalled();
    expect(tokens.load(SESSION.sessionId)).toBeNull();
    expect(flow.shoot()).toBe('stopped');
  });

  it('a session finished by the server wraps up without calling finish', async () => {
    const { flow, store, api } = setup();
    api.issueUpload.mockRejectedValueOnce(new ApiError('SESSION_FINISHED', 409));
    await flow.allowCamera();
    flow.shoot();
    await flush();
    expect(store.get().screen).toBe('thanks');
    expect(api.finish).not.toHaveBeenCalled();
  });

  it('a failed finish call still ends on thanks', async () => {
    const { flow, store, api } = setup();
    api.finish.mockRejectedValueOnce(new ApiError('NETWORK', null));
    await flow.allowCamera();
    await flow.finishTapped();
    expect(store.get().screen).toBe('thanks');
  });

  it('sessionEnded during sending wins over thanks', async () => {
    const { flow, store, put } = setup();
    put.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    await flow.allowCamera();
    flow.shoot();
    await flush();
    const finishing = flow.finishTapped();
    await flush();
    flow.sessionEnded();
    await finishing;
    expect(store.get().screen).toBe('ended');
  });
});
