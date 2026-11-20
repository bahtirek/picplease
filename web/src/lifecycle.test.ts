import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  GRACE_SECONDS,
  IDLE_MS,
  Lifecycle,
  sendKeepalive,
  type EventTargetLike,
  type LifecycleDeps,
} from './lifecycle';
import { createStore, type AppState, type HelperSession } from './state';

const SESSION: HelperSession = {
  sessionId: '3428da7f-d9f8-48a5-879b-971b2e1c3a54',
  token: 'session.token',
  limits: { maxInFlight: 5, maxPhotoBytes: 5 * 1024 * 1024, uploadUrlTtlSeconds: 600 },
};
const API = 'https://api.picplease.app';

class FakeTarget implements EventTargetLike {
  visibilityState: DocumentVisibilityState = 'visible';
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function setup(screen: AppState['screen'] = 'shooting') {
  const store = createStore();
  store.set({ screen, session: SESSION });
  const doc = new FakeTarget();
  const win = new FakeTarget();
  let clock = 1_000_000;
  const flow = {
    finishTapped: vi.fn(() => Promise.resolve()),
    sessionFinished: vi.fn(() => Promise.resolve()),
    sessionEnded: vi.fn(),
    pauseCamera: vi.fn(),
    resumeCamera: vi.fn(() => Promise.resolve()),
  };
  const api = { resume: vi.fn<LifecycleDeps['api']['resume']>() };
  api.resume.mockResolvedValue({ sessionId: SESSION.sessionId, state: 'claimed' });
  const send = vi.fn<NonNullable<LifecycleDeps['send']>>(() => true);
  const lifecycle = new Lifecycle({
    store,
    flow,
    api,
    apiBase: API,
    document: doc,
    window: win,
    send,
    now: () => clock,
  });
  lifecycle.start();
  const hide = () => {
    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
  };
  const show = async () => {
    doc.visibilityState = 'visible';
    doc.fire('visibilitychange');
    await vi.waitFor(() => undefined);
    await Promise.resolve();
  };
  const advance = (ms: number) => {
    clock += ms;
  };
  return { store, flow, api, send, lifecycle, doc, win, hide, show, advance };
}

describe('lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends finish with a JSON body { token, graceSeconds: 30 } on pagehide (test 10)', () => {
    const { send, win, flow } = setup();
    win.fire('pagehide');
    expect(send).toHaveBeenCalledOnce();
    const [url, json] = send.mock.calls[0] ?? [];
    expect(url).toBe(`${API}/sessions/${SESSION.sessionId}/finish`);
    expect(JSON.parse(json ?? '')).toEqual({ token: SESSION.token, graceSeconds: 30 });
    expect(url).not.toContain(SESSION.token);
    expect(flow.pauseCamera).toHaveBeenCalledOnce();
  });

  it('sends once per hidden period (visibilitychange then pagehide)', () => {
    const { send, win, hide } = setup();
    hide();
    win.fire('pagehide');
    expect(send).toHaveBeenCalledOnce();
  });

  it('calls resume when the page is visible again within the grace (test 11)', async () => {
    const { api, flow, hide, show, advance, send } = setup();
    hide();
    advance((GRACE_SECONDS - 5) * 1000);
    await show();
    expect(api.resume).toHaveBeenCalledExactlyOnceWith(SESSION.sessionId, SESSION.token);
    expect(flow.resumeCamera).toHaveBeenCalledOnce();
    expect(flow.sessionFinished).not.toHaveBeenCalled();

    hide();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('back after the grace: wraps up as finished without resuming', async () => {
    const { api, flow, hide, show, advance } = setup();
    hide();
    advance(GRACE_SECONDS * 1000);
    await show();
    expect(api.resume).not.toHaveBeenCalled();
    expect(flow.sessionFinished).toHaveBeenCalledOnce();
  });

  it.each([
    ['SESSION_FINISHED', 'sessionFinished'],
    ['SESSION_GONE', 'sessionEnded'],
    ['UNAUTHORIZED', 'sessionEnded'],
  ] as const)('resume answering %s leads to %s', async (code, action) => {
    const { api, flow, hide, show } = setup();
    api.resume.mockRejectedValueOnce(new ApiError(code, null));
    hide();
    await show();
    expect(flow[action]).toHaveBeenCalledOnce();
    expect(flow.resumeCamera).not.toHaveBeenCalled();
  });

  it('a resume with no answer carries on shooting', async () => {
    const { api, flow, hide, show } = setup();
    api.resume.mockRejectedValueOnce(new ApiError('NETWORK', null));
    hide();
    await show();
    expect(flow.resumeCamera).toHaveBeenCalledOnce();
  });

  it('also sends the grace finish while photos are still sending', () => {
    const { send, flow, hide } = setup('sending');
    hide();
    expect(send).toHaveBeenCalledOnce();
    expect(flow.pauseCamera).not.toHaveBeenCalled();
  });

  it.each(['opening', 'cameraAccess', 'thanks', 'ended', 'codeProblem'] as const)(
    'sends nothing when hidden on %s',
    (screen) => {
      const { send, hide } = setup(screen);
      hide();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('finishes after 2 minutes idle on the camera screen (test 12)', () => {
    const { flow } = setup();
    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(flow.finishTapped).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flow.finishTapped).toHaveBeenCalledOnce();
  });

  it('activity restarts the idle timer, and photos in flight hold it off', () => {
    const { flow, store } = setup();
    vi.advanceTimersByTime(IDLE_MS - 1000);
    store.set({ uploads: { inFlight: 1, sent: 0, failed: 0 } });
    vi.advanceTimersByTime(IDLE_MS - 1000);
    expect(flow.finishTapped).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(flow.finishTapped).not.toHaveBeenCalled();
    store.set({ uploads: { inFlight: 0, sent: 1, failed: 0 } });
    vi.advanceTimersByTime(IDLE_MS);
    expect(flow.finishTapped).toHaveBeenCalledOnce();
  });

  it('no idle timer off the camera screen, and stop removes everything', () => {
    const { flow, store, lifecycle, win, send } = setup('cameraAccess');
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(flow.finishTapped).not.toHaveBeenCalled();
    store.set({ screen: 'shooting' });
    lifecycle.stop();
    vi.advanceTimersByTime(IDLE_MS * 2);
    win.fire('pagehide');
    expect(flow.finishTapped).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('sendKeepalive', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts JSON with keepalive and no credentials', () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    expect(sendKeepalive(`${API}/x`, '{"a":1}')).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${API}/x`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('falls back to a JSON beacon when keepalive fetch throws', async () => {
    const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    vi.stubGlobal('fetch', () => {
      throw new TypeError('keepalive not supported');
    });
    vi.stubGlobal('navigator', { sendBeacon });
    expect(sendKeepalive(`${API}/x`, '{"a":1}')).toBe(true);
    const blob = sendBeacon.mock.calls[0]?.[1];
    expect(blob?.type).toBe('application/json');
    expect(await blob?.text()).toBe('{"a":1}');
  });

  it('returns false when neither works', () => {
    vi.stubGlobal('fetch', () => {
      throw new TypeError('no');
    });
    vi.stubGlobal('navigator', {});
    expect(sendKeepalive(`${API}/x`, '{}')).toBe(false);
  });
});
