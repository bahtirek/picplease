import { Logger } from '@nestjs/common';
import type {
  EventBus,
  EventHandler,
  EventName,
  EventPayload,
  Unsubscribe,
} from './event-bus.interface';
import { HandlerRegistry } from './handler-registry';

/**
 * For unit tests of other modules. Delivers on the next tick, in the same process.
 * It cannot see transactions: an event published with tx is delivered even if that
 * transaction later rolls back. Use the Postgres bus to test commit behaviour.
 */
export class InMemoryEventBus implements EventBus {
  private readonly registry = new HandlerRegistry(new Logger('EventBus'));

  publish(name: EventName, payload: EventPayload): Promise<void> {
    const copy = { ...payload };
    queueMicrotask(() => {
      this.registry.dispatch(name, copy);
    });
    return Promise.resolve();
  }

  subscribe(name: EventName, handler: EventHandler): Unsubscribe {
    return this.registry.add(name, handler);
  }
}
