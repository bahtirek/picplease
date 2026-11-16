import type { Queryable } from '../database/database.service';

/** Internal events, from docs/backend/protocol-and-events.md. */
export const EVENT_NAMES = [
  'session.created',
  'session.claimed',
  'session.finish-requested',
  'session.resumed',
  'session.finished',
  'session.revoked',
  'session.expired',
  'session.closed',
  'photo.uploaded',
  'photo.discarded',
  'photo.acknowledged',
  'delivery.window-closed',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** IDs and small scalars only. Postgres notifications are limited to about 8 KB. */
export type EventPayload = Readonly<Record<string, string | number | boolean | null>>;

export type EventHandler = (payload: EventPayload) => void | Promise<void>;

/** Call to stop receiving events. Safe to call more than once. */
export type Unsubscribe = () => void;

export interface EventBus {
  /**
   * Publishes an event. With tx, the event is delivered only if that transaction
   * commits. Delivery is at most once; handlers must not rely on every event arriving.
   */
  publish(name: EventName, payload: EventPayload, tx?: Queryable): Promise<void>;
  subscribe(name: EventName, handler: EventHandler): Unsubscribe;
}

export const EVENT_BUS = Symbol('EVENT_BUS');
