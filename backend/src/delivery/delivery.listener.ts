import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EVENT_BUS, type EventBus, type EventPayload, type Unsubscribe } from '../eventbus';
import { DeliveryService } from './delivery.service';

/** Re-checks the delivery window on every event that can close it; cleans up on revoke. */
@Injectable()
export class DeliveryListener implements OnModuleInit, OnModuleDestroy {
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly delivery: DeliveryService,
  ) {}

  onModuleInit(): void {
    this.unsubscribers = [
      this.bus.subscribe('photo.acknowledged', (p) => this.onAcknowledged(p)),
      this.bus.subscribe('session.finished', (p) => this.onFinished(p)),
      this.bus.subscribe('photo.discarded', (p) => this.onDiscarded(p)),
      this.bus.subscribe('session.revoked', (p) => this.onRevoked(p)),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  async onAcknowledged(payload: EventPayload): Promise<void> {
    await this.evaluate(payload);
  }

  async onFinished(payload: EventPayload): Promise<void> {
    await this.evaluate(payload);
  }

  async onDiscarded(payload: EventPayload): Promise<void> {
    await this.evaluate(payload);
  }

  async onRevoked(payload: EventPayload): Promise<void> {
    const { sessionId } = payload;
    if (typeof sessionId === 'string') await this.delivery.deleteUndelivered(sessionId);
  }

  private async evaluate(payload: EventPayload): Promise<void> {
    const { sessionId } = payload;
    if (typeof sessionId === 'string') await this.delivery.evaluateWindow(sessionId);
  }
}
