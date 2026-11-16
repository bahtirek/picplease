import { Logger } from '@nestjs/common';
import type { EventHandler, EventName, EventPayload, Unsubscribe } from './event-bus.interface';

/** Local handler list shared by both buses. A failing handler is logged and never affects others. */
export class HandlerRegistry {
  private readonly handlers = new Map<EventName, Set<EventHandler>>();

  constructor(private readonly logger: Logger) {}

  add(name: EventName, handler: EventHandler): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    // Wrap so the same function subscribed twice gets two independent subscriptions.
    const entry: EventHandler = (payload) => handler(payload);
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  dispatch(name: EventName, payload: EventPayload): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const handler of [...set]) {
      // Each handler gets its own copy so one cannot change what another sees.
      const copy = Object.freeze({ ...payload });
      Promise.resolve()
        .then(() => handler(copy))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`Handler for ${name} failed: ${message}`);
        });
    }
  }
}
