import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, DEFAULT_LIMITS, type ServerErrorCode } from './api';
import type { HistoryLike, LocationLike } from './linkParser';
import { start } from './startup';
import { createStore } from './state';
import { fakeFetch } from './testing/fakeFetch';
import { TokenStore, type StorageLike } from './tokenStore';

const ID = '3428da7f-d9f8-48a5-879b-971b2e1c3a54';
const OTHER_ID = '00000000-0000-4000-8000-000000000000';
const SECRET = 'S'.repeat(43);
const TOKEN = `${ID}.random`;
const LIMITS = { maxInFlight: 5, maxPhotoBytes: 5242880, uploadUrlTtlSeconds: 600 };

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function at(href: string): { location: LocationLike; history: HistoryLike } {
  const url = new URL(href);
  return {
    location: { href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { state: null, replaceState: vi.fn() },
  };
}

function claimFails(code: ServerErrorCode, status: number) {
  return fakeFetch({ status, body: { code, message: 'm' } });
}

async function run(
  href: string,
  fetch: ReturnType<typeof fakeFetch>,
  tokens = new TokenStore(null),
) {
  const store = createStore();
  await start({
    ...at(href),
    api: new ApiClient({ baseUrl: 'https://api.picplease.app', fetch }),
    tokens,
    store,
  });
  return store.get();
}

describe('startup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('claims, stores the token and asks for the camera', async () => {
    const storage = new MemoryStorage();
    const fetch = fakeFetch({
      status: 201,
      body: { sessionId: ID, helperToken: TOKEN, limits: LIMITS },
    });
    const state = await run(
      `https://picplease.app/s/${ID}#${SECRET}`,
      fetch,
      new TokenStore(storage),
    );
    expect(state.screen).toBe('cameraAccess');
    expect(state.session).toEqual({ sessionId: ID, token: TOKEN, limits: LIMITS });
    expect(new TokenStore(storage).load(ID)?.token).toBe(TOKEN);
  });

  it('wrong secret and unknown session lead to the same codeProblem (test 16)', async () => {
    // The API answers NOT_FOUND for both; the page must not tell them apart either.
    const wrongSecret = await run(
      `https://picplease.app/s/${ID}#${SECRET}`,
      claimFails('NOT_FOUND', 404),
    );
    const unknown = await run(
      `https://picplease.app/s/${OTHER_ID}#${SECRET}`,
      claimFails('NOT_FOUND', 404),
    );
    expect(wrongSecret).toEqual({ screen: 'codeProblem', session: null, codeProblem: 'invalid' });
    expect(unknown).toEqual(wrongSecret);
  });

  it.each([
    ['UNAUTHORIZED', 401, 'invalid'],
    ['SESSION_GONE', 410, 'invalid'],
    ['ALREADY_CLAIMED', 409, 'used'],
    ['RATE_LIMITED', 429, 'unreachable'],
    ['INTERNAL_ERROR', 500, 'unreachable'],
  ] as const)('claim %s leads to codeProblem (%s)', async (code, status, reason) => {
    const state = await run(`https://picplease.app/s/${ID}#${SECRET}`, claimFails(code, status));
    expect(state.screen).toBe('codeProblem');
    expect(state.codeProblem).toBe(reason);
  });

  it('a network failure is unreachable and the claim is not retried', async () => {
    const fetch = fakeFetch(new TypeError('offline'));
    const state = await run(`https://picplease.app/s/${ID}#${SECRET}`, fetch);
    expect(state.codeProblem).toBe('unreachable');
    expect(fetch.calls).toHaveLength(1);
  });

  it('a link with no secret is codeProblem without calling the API (test 2)', async () => {
    const fetch = fakeFetch({ status: 500 });
    const state = await run(`https://picplease.app/s/${ID}`, fetch);
    expect(state).toEqual({ screen: 'codeProblem', session: null, codeProblem: 'invalid' });
    expect(fetch.calls).toHaveLength(0);
  });

  it('a reload (fragment gone) reuses the token stored for that session', async () => {
    const storage = new MemoryStorage();
    new TokenStore(storage).save({ sessionId: ID, token: TOKEN, limits: LIMITS });
    const fetch = fakeFetch({ status: 500 });
    const state = await run(`https://picplease.app/s/${ID}`, fetch, new TokenStore(storage));
    expect(state.screen).toBe('cameraAccess');
    expect(state.session?.token).toBe(TOKEN);
    expect(fetch.calls).toHaveLength(0);
  });

  it('stores the token in sessionStorage only (test 14)', async () => {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', local);
    const fetch = fakeFetch({
      status: 201,
      body: { sessionId: ID, helperToken: TOKEN, limits: LIMITS },
    });
    await run(`https://picplease.app/s/${ID}#${SECRET}`, fetch, new TokenStore());
    expect([...session.items.values()].join()).toContain(TOKEN);
    expect(local.items.size).toBe(0);
  });

  it('still works when storage is unavailable', async () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    const fetch = fakeFetch({ status: 201, body: { sessionId: ID, helperToken: TOKEN } });
    const state = await run(
      `https://picplease.app/s/${ID}#${SECRET}`,
      fetch,
      new TokenStore(throwing),
    );
    expect(state.screen).toBe('cameraAccess');
    expect(state.session?.limits).toEqual(DEFAULT_LIMITS);
  });

  it('treats a non-ApiError failure as unreachable', async () => {
    const store = createStore();
    await start({
      ...at(`https://picplease.app/s/${ID}#${SECRET}`),
      api: { claim: () => Promise.reject(new Error('boom')) },
      tokens: new TokenStore(null),
      store,
    });
    expect(store.get().codeProblem).toBe('unreachable');
    expect(new ApiError('NETWORK', null)).toBeInstanceOf(Error);
  });
});
