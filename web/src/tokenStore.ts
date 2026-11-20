/**
 * Keeps the helper token for this tab in sessionStorage, keyed by session id (docs/web/overview.md).
 * Never localStorage, never logged, never in a URL. If storage is unavailable the token lives only
 * in memory and a reload ends the session for this tab.
 */
import { DEFAULT_LIMITS, type Limits } from './api';

export interface StoredSession {
  sessionId: string;
  token: string;
  limits: Limits;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'picplease.helper.';

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export class TokenStore {
  constructor(private readonly storage: StorageLike | null = defaultStorage()) {}

  save(session: StoredSession): boolean {
    try {
      this.storage?.setItem(PREFIX + session.sessionId, JSON.stringify(session));
      return this.storage !== null;
    } catch {
      return false;
    }
  }

  load(sessionId: string): StoredSession | null {
    let raw: string | null;
    try {
      raw = this.storage?.getItem(PREFIX + sessionId) ?? null;
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (parsed.sessionId !== sessionId || typeof parsed.token !== 'string') return null;
      return { sessionId, token: parsed.token, limits: { ...DEFAULT_LIMITS, ...parsed.limits } };
    } catch {
      return null;
    }
  }

  clear(sessionId: string): void {
    try {
      this.storage?.removeItem(PREFIX + sessionId);
    } catch {
      // Nothing to do: the tab's storage goes away with the tab.
    }
  }
}
