# Backend module: EventBus

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `event-bus.interface.ts`, `postgres-event-bus.ts`, `in-memory-event-bus.ts`, `redis-event-bus.ts` (later), `event-bus.module.ts`.
Interface: `publish(name, payload, tx?)`, `subscribe(name, handler)` returning a stop function. The Postgres version uses a dedicated direct connection, `pg_notify` with IDs only, routes notifications to local handlers, and reconnects and re-listens after a drop. Missed events are acceptable because Realtime sends a snapshot on every connect.
