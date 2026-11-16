import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { type RawData, type Server, WebSocket } from 'ws';
import type { AuthContext, SessionRole } from '../auth';
import { CatchupService } from './catchup.service';
import { PresenceService } from './presence.service';
import {
  AUTH_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_CLIENT_MESSAGE_BYTES,
  WS_CLOSE,
  WS_PATH,
} from './realtime.constants';
import { WsAuthGuard } from './ws-auth.guard';

/** Message types the server sends, from docs/backend/protocol-and-events.md. */
export type ServerMessageType =
  | 'snapshot'
  | 'session.claimed'
  | 'photo.ready'
  | 'session.expired'
  | 'window.closed'
  | 'session.ended'
  | 'session.finished';

interface ClientState {
  authTimer: NodeJS.Timeout | null;
  auth: AuthContext | null;
  /** False until the snapshot is sent; messages for the session wait in `queue` until then. */
  ready: boolean;
  queue: string[];
  /** Answered the last ping. */
  alive: boolean;
}

const INTERNAL_ERROR_CLOSE = 1011;

/**
 * One socket per client. The first message must be `{ type: "auth", token }`; then the
 * socket joins its session, presence is recorded and `snapshot` is sent before anything else.
 * Clients send nothing after auth; later messages are ignored.
 */
@WebSocketGateway({ path: WS_PATH, maxPayload: MAX_CLIENT_MESSAGE_BYTES })
export class RealtimeGateway
  implements
    OnGatewayInit<Server>,
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly clients = new Map<WebSocket, ClientState>();
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly authGuard: WsAuthGuard,
    private readonly presence: PresenceService,
    private readonly catchup: CatchupService,
  ) {}

  afterInit(): void {
    this.heartbeat = setInterval(() => {
      this.checkHeartbeats();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  handleConnection(client: WebSocket): void {
    const state: ClientState = {
      authTimer: setTimeout(() => {
        client.close(WS_CLOSE.UNAUTHORIZED);
      }, AUTH_TIMEOUT_MS),
      auth: null,
      ready: false,
      queue: [],
      alive: true,
    };
    this.clients.set(client, state);
    client.on('pong', () => {
      state.alive = true;
    });
    client.once('message', (data: RawData) => {
      void this.authenticate(client, state, data);
    });
  }

  handleDisconnect(client: WebSocket): void {
    const state = this.clients.get(client);
    if (!state) return;
    this.clients.delete(client);
    if (state.authTimer) clearTimeout(state.authTimer);
    if (state.auth) this.leave(client, state.auth);
  }

  /** Sends to every socket of the session with the given role. */
  emitToSession(sessionId: string, type: ServerMessageType, data: object, role: SessionRole): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    const message = JSON.stringify({ type, data });
    for (const client of room) {
      const state = this.clients.get(client);
      if (!state || state.auth?.role !== role) continue;
      if (state.ready) this.send(client, message);
      else state.queue.push(message);
    }
  }

  private async authenticate(client: WebSocket, state: ClientState, data: RawData): Promise<void> {
    if (state.authTimer) clearTimeout(state.authTimer);
    state.authTimer = null;
    try {
      const result = await this.authGuard.authenticate(rawToString(data));
      if (!this.isOpen(client)) return;
      if (!result.ok) {
        client.close(result.closeCode);
        return;
      }
      // Join before building the snapshot so no event is missed; events that arrive
      // meanwhile wait in the queue and are sent after it.
      state.auth = result.auth;
      this.join(client, result.auth);
      const snapshot = await this.catchup.buildSnapshot(result.auth.sessionId, result.auth.role);
      if (!this.isOpen(client)) return;
      this.send(client, JSON.stringify({ type: 'snapshot', data: snapshot }));
      for (const message of state.queue) this.send(client, message);
      state.queue = [];
      state.ready = true;
    } catch (err) {
      this.logger.error(`WebSocket auth failed: ${err instanceof Error ? err.message : 'unknown'}`);
      if (this.isOpen(client)) client.close(INTERNAL_ERROR_CLOSE);
    }
  }

  private join(client: WebSocket, auth: AuthContext): void {
    let room = this.rooms.get(auth.sessionId);
    if (!room) {
      room = new Set();
      this.rooms.set(auth.sessionId, room);
    }
    room.add(client);
    this.presence.markConnected(auth.sessionId, auth.role);
  }

  private leave(client: WebSocket, auth: AuthContext): void {
    const room = this.rooms.get(auth.sessionId);
    if (room?.delete(client)) {
      this.presence.markDisconnected(auth.sessionId, auth.role);
      if (room.size === 0) this.rooms.delete(auth.sessionId);
    }
  }

  private checkHeartbeats(): void {
    for (const [client, state] of this.clients) {
      if (!state.alive) {
        client.terminate();
        continue;
      }
      state.alive = false;
      if (this.isOpen(client)) client.ping();
    }
  }

  private send(client: WebSocket, message: string): void {
    if (this.isOpen(client)) client.send(message);
  }

  private isOpen(client: WebSocket): boolean {
    return client.readyState === WebSocket.OPEN;
  }
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
