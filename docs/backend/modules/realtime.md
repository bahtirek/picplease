# Backend module: Realtime

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `realtime.gateway.ts`, `ws-auth.guard.ts`, `realtime.listener.ts`, `catchup.service.ts`, `presence.service.ts`, `realtime.module.ts`.

- Gateway: `handleConnection` (first-message auth, join the session, record presence, send snapshot), `handleDisconnect`, `emitToSession(sessionId, type, data, role)`.
- `buildSnapshot(sessionId, role)`: state, plus pending photos for the requester via Delivery.
- Presence is in memory (fine for one instance): `markConnected`, `markDisconnected`, `isRequesterOnline`.
- Listener: maps each internal event in protocol-and-events.md to its WebSocket message.
