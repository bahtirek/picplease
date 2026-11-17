import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EVENT_BUS, type EventBus, type EventPayload, type Unsubscribe } from '../eventbus';
import { PresenceService } from '../realtime/presence.service';
import { NotificationsService } from './notifications.service';

/** Pushes on photo.uploaded, only when Realtime says the requester has no open socket. */
@Injectable()
export class PhotoListener implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: Unsubscribe | undefined;

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe('photo.uploaded', (p) => this.onUploaded(p));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async onUploaded(payload: EventPayload): Promise<void> {
    const { sessionId } = payload;
    if (typeof sessionId !== 'string') return;
    if (this.presence.isRequesterOnline(sessionId)) return;
    await this.notifications.notifyPhotoReady(sessionId);
  }
}
