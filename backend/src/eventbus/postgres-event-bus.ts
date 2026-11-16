import { Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Client, Notification } from 'pg';
import type { DatabaseService, Queryable } from '../database/database.service';
import {
  EVENT_NAMES,
  type EventBus,
  type EventHandler,
  type EventName,
  type EventPayload,
  type Unsubscribe,
} from './event-bus.interface';
import { HandlerRegistry } from './handler-registry';

export const DEFAULT_CHANNEL = 'picplease_events';
/** Postgres refuses notification payloads of 8000 bytes or more. */
const MAX_PAYLOAD_BYTES = 7999;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 30_000;

export interface PostgresEventBusOptions {
  /** One channel carries every event. Tests pass their own to stay isolated. */
  channel?: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

interface Envelope {
  n: EventName;
  p: EventPayload;
}

/**
 * LISTEN/NOTIFY on one dedicated connection outside the pool. Publishing uses
 * pg_notify, so inside a transaction it is delivered only on commit. After a dropped
 * connection it reconnects with backoff and listens again; events sent while it was
 * down are lost (Realtime sends a snapshot on every connect).
 */
export class PostgresEventBus implements EventBus, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('EventBus');
  private readonly registry = new HandlerRegistry(this.logger);
  readonly channel: string;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;

  private client: Client | null = null;
  private stopped = false;
  private connecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly database: DatabaseService,
    options: PostgresEventBusOptions = {},
  ) {
    this.channel = options.channel ?? DEFAULT_CHANNEL;
    this.reconnectMinMs = options.reconnectMinMs ?? RECONNECT_MIN_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? RECONNECT_MAX_MS;
  }

  /** Starts listening in the background; a database that is down does not block startup. */
  onModuleInit(): void {
    this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners('notification');
      client.removeAllListeners('end');
      await client.end().catch(() => undefined);
    }
  }

  /** Resolves once a connection is listening. Used at startup and by tests. */
  whenListening(): Promise<void> {
    if (this.client) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async publish(name: EventName, payload: EventPayload, tx?: Queryable): Promise<void> {
    const body = JSON.stringify({ n: name, p: payload } satisfies Envelope);
    if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) {
      throw new Error(`Event ${name} payload is too large; send IDs only.`);
    }
    await (tx ?? this.database.pool).query('SELECT pg_notify($1, $2)', [this.channel, body]);
  }

  subscribe(name: EventName, handler: EventHandler): Unsubscribe {
    return this.registry.add(name, handler);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.client) return;
    this.connecting = true;
    let client: Client | null = null;
    try {
      client = await this.database.listenConnection();
      // Without an error listener a dropped connection would crash the process.
      client.on('error', (err) => {
        this.logger.warn(`Listen connection error: ${err.message}`);
      });
      client.on('end', () => {
        this.onConnectionLost(client);
      });
      client.on('notification', (msg) => {
        this.onNotification(msg);
      });
      await client.query(`LISTEN ${client.escapeIdentifier(this.channel)}`);
      // stop() may have run while LISTEN was in flight.
      if (this.isStopped()) {
        await client.end().catch(() => undefined);
        return;
      }
      this.client = client;
      if (this.attempt > 0) this.logger.log('Listen connection restored');
      this.attempt = 0;
      const waiters = this.waiters;
      this.waiters = [];
      waiters.forEach((resolve) => {
        resolve();
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Listen connection failed: ${message}`);
      if (client) {
        client.removeAllListeners('end');
        await client.end().catch(() => undefined);
      }
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private isStopped(): boolean {
    return this.stopped;
  }

  private onConnectionLost(client: Client | null): void {
    if (this.client !== client) return;
    this.client = null;
    if (this.stopped) return;
    this.logger.warn('Listen connection lost; reconnecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(this.reconnectMinMs * 2 ** this.attempt, this.reconnectMaxMs);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private onNotification(msg: Notification): void {
    if (msg.channel !== this.channel || !msg.payload) return;
    let envelope: unknown;
    try {
      envelope = JSON.parse(msg.payload);
    } catch {
      this.logger.warn('Ignored a notification that is not JSON');
      return;
    }
    if (!isEnvelope(envelope)) {
      this.logger.warn('Ignored a notification with an unknown shape');
      return;
    }
    this.registry.dispatch(envelope.n, envelope.p);
  }
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false;
  const { n, p } = value as Record<string, unknown>;
  return (
    typeof n === 'string' &&
    (EVENT_NAMES as readonly string[]).includes(n) &&
    typeof p === 'object' &&
    p !== null &&
    !Array.isArray(p)
  );
}
