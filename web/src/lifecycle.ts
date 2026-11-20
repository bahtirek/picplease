/**
 * Leaving and coming back (docs/web/flow-and-states.md "Leaving the page", mobile way B and C):
 * hidden → finish with a 30 s grace, sent so it survives the page closing; visible again within the
 * grace → resume; later → the session finished; 2 minutes without activity while shooting → finish.
 */
import { ApiError, type ApiClient } from './api';
import type { HelperFlow } from './flow';
import type { AppState, Store } from './state';

export const GRACE_SECONDS = 30;
export const IDLE_MS = 2 * 60 * 1000;

/** Sends a request that may outlive the page. Returns false if it could not be queued. */
export type KeepaliveSender = (url: string, json: string) => boolean;

export interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface LifecycleDeps {
  store: Store;
  flow: Pick<
    HelperFlow,
    'finishTapped' | 'sessionFinished' | 'sessionEnded' | 'pauseCamera' | 'resumeCamera'
  >;
  api: Pick<ApiClient, 'resume'>;
  apiBase: string;
  document: EventTargetLike & { readonly visibilityState: DocumentVisibilityState };
  window: EventTargetLike;
  send?: KeepaliveSender;
  now?: () => number;
}

/**
 * fetch with keepalive first (JSON with the token in the body, which the finish guard accepts since
 * nothing else can carry headers when the page is going away), sendBeacon as the fallback.
 */
export function sendKeepalive(url: string, json: string): boolean {
  try {
    void globalThis
      .fetch(url, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: json,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
      .catch(() => undefined);
    return true;
  } catch {
    // keepalive unsupported: fall through to the beacon.
  }
  try {
    return navigator.sendBeacon(url, new Blob([json], { type: 'application/json' }));
  } catch {
    return false;
  }
}

const ACTIVE: readonly AppState['screen'][] = ['shooting', 'sending'];

export class Lifecycle {
  private readonly send: KeepaliveSender;
  private readonly now: () => number;
  private hiddenAt: number | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUploads: AppState['uploads'] | null = null;
  private lastScreen: AppState['screen'] | null = null;
  private unsubscribe: (() => void) | null = null;

  private readonly onVisibility = (): void => {
    if (this.deps.document.visibilityState === 'hidden') this.hidden();
    else void this.visible();
  };
  private readonly onPageHide = (): void => {
    this.hidden();
  };

  constructor(private readonly deps: LifecycleDeps) {
    this.send = deps.send ?? sendKeepalive;
    this.now = deps.now ?? (() => Date.now());
  }

  start(): void {
    this.deps.document.addEventListener('visibilitychange', this.onVisibility);
    this.deps.window.addEventListener('pagehide', this.onPageHide);
    this.unsubscribe = this.deps.store.subscribe((state) => {
      this.watchIdle(state);
    });
    this.watchIdle(this.deps.store.get());
  }

  stop(): void {
    this.deps.document.removeEventListener('visibilitychange', this.onVisibility);
    this.deps.window.removeEventListener('pagehide', this.onPageHide);
    this.unsubscribe?.();
    this.unsubscribe = null;
    clearTimeout(this.idleTimer);
  }

  /** Hidden or closing: one grace finish per hidden period, only while photos can be taken. */
  private hidden(): void {
    const { session, screen } = this.deps.store.get();
    if (this.hiddenAt !== null || !session || !ACTIVE.includes(screen)) return;
    this.hiddenAt = this.now();
    const url = `${this.deps.apiBase}/sessions/${encodeURIComponent(session.sessionId)}/finish`;
    this.send(url, JSON.stringify({ token: session.token, graceSeconds: GRACE_SECONDS }));
    if (screen === 'shooting') this.deps.flow.pauseCamera();
  }

  private async visible(): Promise<void> {
    const hiddenAt = this.hiddenAt;
    if (hiddenAt === null) return;
    this.hiddenAt = null;
    const { session } = this.deps.store.get();
    if (!session) return;

    if (this.now() - hiddenAt >= GRACE_SECONDS * 1000) {
      // The grace ran out: the server has finished (or is about to); wrap up like mobile.
      await this.deps.flow.sessionFinished();
      return;
    }
    try {
      await this.deps.api.resume(session.sessionId, session.token);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'SESSION_FINISHED') {
          await this.deps.flow.sessionFinished();
          return;
        }
        if (error.code === 'SESSION_GONE' || error.code === 'UNAUTHORIZED') {
          this.deps.flow.sessionEnded();
          return;
        }
      }
      // No answer: carry on; if the grace finish lands, realtime or the uploader will say so.
    }
    await this.deps.flow.resumeCamera();
  }

  /** Any change in the uploads counts as activity; the timer only runs on the camera screen. */
  private watchIdle(state: Readonly<AppState>): void {
    const changed = state.uploads !== this.lastUploads || state.screen !== this.lastScreen;
    this.lastUploads = state.uploads;
    this.lastScreen = state.screen;
    if (state.screen !== 'shooting') {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
      return;
    }
    if (changed || this.idleTimer === undefined) this.armIdle();
  }

  private armIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const state = this.deps.store.get();
      if (state.screen !== 'shooting') return;
      if (state.uploads.inFlight > 0) {
        this.armIdle();
        return;
      }
      void this.deps.flow.finishTapped();
    }, IDLE_MS);
  }
}
