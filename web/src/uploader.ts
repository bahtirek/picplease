/**
 * The one-photo flow (docs/web/flow-and-states.md): compress and request the upload URL in
 * parallel, PUT the bytes straight to R2 with the signed headers, then confirm. At most
 * `limits.maxInFlight` photos are in flight, counted here with no backend call.
 */
import { ApiError, type ApiClient, type FetchLike, type UploadTarget } from './api';
import { encodeJpeg, type CanvasLike } from './compressor';
import type { HelperSession } from './state';

/** finished: no new photos (the ones already sending carry on); gone: everything stops. */
export type StopReason = 'finished' | 'gone';

export interface UploaderCounts {
  inFlight: number;
  sent: number;
  failed: number;
}

export type AddResult = 'accepted' | 'full' | 'stopped';

export interface UploaderDeps {
  api: Pick<ApiClient, 'issueUpload' | 'confirm'>;
  session: HelperSession;
  fetch?: FetchLike;
  encode?: (frame: CanvasLike, maxBytes: number) => Promise<Blob>;
  sleep?: (ms: number) => Promise<void>;
  onChange?: (counts: UploaderCounts) => void;
  onStop?: (reason: StopReason) => void;
}

/** Waits between attempts of a call that failed for a passing reason (about one minute in all). */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 15_000, 15_000] as const;
/** Waits between PUT attempts to the same signed URL. */
export const PUT_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
/** A refused or expired URL is replaced at most this many times. */
export const MAX_NEW_URLS = 3;
const PUT_TIMEOUT_MS = 60_000;

const PASSING: readonly string[] = ['NETWORK', 'RATE_LIMITED', 'INTERNAL_ERROR'];

class Discarded extends Error {
  override name = 'Discarded';
}

class UrlRefused extends Error {
  override name = 'UrlRefused';
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Uploader {
  private readonly deps: Required<Omit<UploaderDeps, 'onChange' | 'onStop'>> &
    Pick<UploaderDeps, 'onChange' | 'onStop'>;
  private inFlight = 0;
  private sent = 0;
  private failed = 0;
  private stopped: StopReason | null = null;
  private readonly aborts = new Set<AbortController>();
  private idleWaiters: (() => void)[] = [];

  constructor(deps: UploaderDeps) {
    this.deps = {
      fetch: (input, init) => globalThis.fetch(input, init),
      encode: encodeJpeg,
      sleep: defaultSleep,
      ...deps,
    };
  }

  get counts(): UploaderCounts {
    return { inFlight: this.inFlight, sent: this.sent, failed: this.failed };
  }

  get stopReason(): StopReason | null {
    return this.stopped;
  }

  /** True when the shutter may be pressed. */
  get canShoot(): boolean {
    return this.stopped === null && this.inFlight < this.deps.session.limits.maxInFlight;
  }

  /** Takes a captured frame. Refuses when the session stopped or the in-flight limit is reached. */
  add(frame: CanvasLike): AddResult {
    if (this.stopped !== null) return 'stopped';
    if (this.inFlight >= this.deps.session.limits.maxInFlight) return 'full';
    this.inFlight += 1;
    this.changed();
    void this.send(frame);
    return 'accepted';
  }

  /** Resolves once nothing is in flight (sent, failed or discarded). */
  whenIdle(): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** The session finished elsewhere (Done, idle, realtime): photos with a URL still finish. */
  finish(): void {
    this.stop('finished');
  }

  /** The session is gone: abort every upload. */
  end(): void {
    this.stop('gone');
  }

  private async send(frame: CanvasLike): Promise<void> {
    const { session } = this.deps;
    // Compression and the URL request run in parallel.
    const encoding = this.deps.encode(frame, session.limits.maxPhotoBytes);
    encoding.catch(() => undefined);
    let outcome: 'sent' | 'failed' | 'discarded' = 'failed';
    try {
      let target = await this.issue();
      const blob = await encoding;
      for (let newUrls = 0; ; newUrls += 1) {
        try {
          await this.put(target, blob);
          break;
        } catch (error) {
          if (!(error instanceof UrlRefused) || newUrls >= MAX_NEW_URLS) throw error;
          target = await this.issue();
        }
      }
      await this.confirm(target.photoId);
      outcome = 'sent';
    } catch (error) {
      outcome = error instanceof Discarded ? 'discarded' : 'failed';
    } finally {
      this.inFlight -= 1;
      if (outcome === 'sent') this.sent += 1;
      if (outcome === 'failed') this.failed += 1;
      this.changed();
      if (this.inFlight === 0) this.releaseIdle();
    }
  }

  private issue(): Promise<UploadTarget> {
    const { api, session } = this.deps;
    return this.withRetries(
      () => {
        // A session that finished takes no new URLs; one that is gone takes nothing.
        if (this.stopped !== null) throw new Discarded();
        return api.issueUpload(session.sessionId, session.token);
      },
      (code) => PASSING.includes(code) || code === 'UPLOAD_LIMIT_REACHED',
    );
  }

  private confirm(photoId: string): Promise<void> {
    const { api, session } = this.deps;
    return this.withRetries(
      () => {
        if (this.isGone()) throw new Discarded();
        return api.confirm(photoId, session.token);
      },
      // INVALID_REQUEST: the object is not visible yet; the photo stays pending and confirm is safe
      // to repeat.
      (code) => PASSING.includes(code) || code === 'INVALID_REQUEST',
    );
  }

  /** Calls fn, waiting and trying again on passing errors; session errors stop the uploader. */
  private async withRetries<T>(
    fn: () => Promise<T>,
    passing: (code: string) => boolean,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.code === 'SESSION_FINISHED') {
          this.stop('finished');
          throw new Discarded();
        }
        if (error.code === 'SESSION_GONE' || error.code === 'UNAUTHORIZED') {
          // The helper token is refused once the session is revoked, expired or closed.
          this.stop('gone');
          throw new Discarded();
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (!passing(error.code) || delay === undefined) throw error;
        await this.deps.sleep(delay);
        if (this.isGone()) throw new Discarded();
      }
    }
  }

  /** PUT to R2 with exactly the signed headers. 4xx means the URL is expired or refused. */
  private async put(target: UploadTarget, blob: Blob): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      if (this.isGone()) throw new Discarded();
      const abort = new AbortController();
      this.aborts.add(abort);
      const timer = setTimeout(() => {
        abort.abort();
      }, PUT_TIMEOUT_MS);
      let status: number | null;
      try {
        const response = await this.deps.fetch(target.url, {
          method: 'PUT',
          headers: { ...target.headers },
          body: blob,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: abort.signal,
        });
        status = response.status;
      } catch {
        status = null;
      } finally {
        clearTimeout(timer);
        this.aborts.delete(abort);
      }
      if (this.isGone()) throw new Discarded();
      if (status !== null && status >= 200 && status < 300) return;
      if (status !== null && status >= 400 && status < 500) throw new UrlRefused();
      const delay = PUT_RETRY_DELAYS_MS[attempt];
      // Out of retries on the same URL: a fresh one may help (it may also have expired).
      if (delay === undefined) throw new UrlRefused();
      await this.deps.sleep(delay);
    }
  }

  /** A method, not a field check, so TypeScript does not narrow it across awaits. */
  private isGone(): boolean {
    return this.stopped === 'gone';
  }

  private stop(reason: StopReason): void {
    if (this.stopped === 'gone' || this.stopped === reason) return;
    this.stopped = reason;
    if (reason === 'gone') {
      for (const abort of this.aborts) abort.abort();
    }
    this.deps.onStop?.(reason);
    this.changed();
  }

  private changed(): void {
    this.deps.onChange?.(this.counts);
  }

  private releaseIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
