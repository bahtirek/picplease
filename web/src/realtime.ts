/**
 * Optional WebSocket (docs/backend/protocol-and-events.md): used only to learn that the session
 * finished or ended. First message is the auth; the token never goes in the URL. Close 4401 or 4410
 * means ended (no retry); any other close reconnects with backoff, 1 to 30 s with jitter.
 */
import type { HelperFlow } from './flow';

export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface RealtimeDeps {
  url: string;
  token: string;
  flow: Pick<HelperFlow, 'sessionFinished' | 'sessionEnded'>;
  createSocket?: (url: string) => SocketLike;
  sleep?: (ms: number) => Promise<void>;
  /** 0.5 to 1.0 by default. */
  jitter?: () => number;
}

export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_GONE = 4410;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000] as const;
const GONE_STATES = ['revoked', 'expired', 'closed'];

export class HelperRealtime {
  private socket: SocketLike | null = null;
  private stopped = false;
  private attempt = 0;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly jitter: () => number;

  constructor(private readonly deps: RealtimeDeps) {
    this.createSocket = deps.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.jitter = deps.jitter ?? (() => 0.5 + Math.random() / 2);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close(1000);
    }
  }

  private connect(): void {
    if (this.stopped) return;
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.deps.url);
    } catch {
      void this.reconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: this.deps.token }));
    };
    socket.onmessage = (event) => {
      this.handle(event.data);
    };
    socket.onerror = () => undefined;
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (event.code === CLOSE_GONE || event.code === CLOSE_UNAUTHORIZED) {
        this.stopped = true;
        this.deps.flow.sessionEnded();
        return;
      }
      void this.reconnect();
    };
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    this.attempt += 1;
    await this.sleep(Math.round(base * this.jitter()));
    this.connect();
  }

  private handle(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const { type, data } = message as { type?: unknown; data?: unknown };
    if (type === 'snapshot') {
      this.attempt = 0;
      const state = (data as { session?: { state?: unknown } } | undefined)?.session?.state;
      if (state === 'finished') void this.deps.flow.sessionFinished();
      else if (typeof state === 'string' && GONE_STATES.includes(state))
        this.deps.flow.sessionEnded();
    } else if (type === 'session.finished') {
      void this.deps.flow.sessionFinished();
    } else if (type === 'session.ended') {
      this.deps.flow.sessionEnded();
    }
  }
}
