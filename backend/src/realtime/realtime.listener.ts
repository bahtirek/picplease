import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { SessionRole } from '../auth';
import { EVENT_BUS, type EventBus, type EventName, type Unsubscribe } from '../eventbus';
import { RealtimeGateway, type ServerMessageType } from './realtime.gateway';

interface Route {
  type: ServerMessageType;
  to: SessionRole;
}

/**
 * Internal events and the WebSocket message each becomes. The message data is the event
 * payload (IDs and small scalars), e.g. `{ sessionId, photoId }` for `photo.ready`.
 */
export const SESSION_EVENT_ROUTES: Partial<Record<EventName, Route>> = {
  'session.claimed': { type: 'session.claimed', to: 'requester' },
  'session.expired': { type: 'session.expired', to: 'requester' },
  'session.revoked': { type: 'session.ended', to: 'helper' },
  'session.finished': { type: 'session.finished', to: 'helper' },
  'photo.uploaded': { type: 'photo.ready', to: 'requester' },
  'delivery.window-closed': { type: 'window.closed', to: 'requester' },
};

@Injectable()
export class RealtimeListener implements OnModuleInit, OnModuleDestroy {
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    for (const [name, route] of Object.entries(SESSION_EVENT_ROUTES) as [EventName, Route][]) {
      this.unsubscribers.push(
        this.bus.subscribe(name, (payload) => {
          const { sessionId } = payload;
          if (typeof sessionId !== 'string') return;
          this.gateway.emitToSession(sessionId, route.type, { ...payload }, route.to);
        }),
      );
    }
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }
}
