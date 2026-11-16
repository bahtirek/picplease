# Backend: WebSocket protocol and internal events

## WebSocket protocol

Endpoint `wss://api.picplease.app/ws`. The first client message is `{ "type": "auth", "token": "..." }`. The server closes the socket if no valid first message arrives within 5 seconds (close code 4401). A gone session closes with 4410, and clients must not retry after that. Ping and pong frames serve as the heartbeat. Messages are `{ "type": "...", "data": {...} }`.

After auth the server joins the socket to its session and sends `snapshot` first: the session state, plus for the requester the pending photos.

Implementation notes (slice 6): `snapshot` data is `{ role, session, pendingPhotos }`, where `session` is the same object as `GET /sessions/:id` and `pendingPhotos` is present for the requester only. A valid token for an expired, revoked or closed session closes with 4410; any other auth failure (bad JSON, wrong type, bad token) closes with 4401. A browser upgrade from an origin other than `WEB_ORIGIN` is refused with HTTP 403; no Origin header (native apps) is allowed. The server pings every 30 seconds and drops a client that missed the previous pong. Session-event messages carry `{ sessionId }`. Clients send nothing after auth; anything later is ignored.

| Message | To | When |
|---|---|---|
| `snapshot` | both | right after auth and after every reconnect |
| `session.claimed` | requester | helper claimed |
| `photo.ready` | requester | a photo was uploaded and confirmed |
| `session.expired` | requester | nobody scanned in time |
| `window.closed` | requester | delivery window closed, with the delivered count |
| `session.ended` | helper | requester revoked |
| `session.finished` | helper | finished by the idle rule or grace timer |

Clients ignore unknown message types.

## Internal events (EventBus)

Payloads carry IDs only (Postgres notifications are limited to about 8 KB). Publishing inside a transaction delivers only if the transaction commits.

| Event | Consumers |
|---|---|
| `session.created` | Jobs: schedule the 5 minute timer |
| `session.claimed` | Realtime (to requester), Jobs: cancel the timer |
| `session.finish-requested` | Jobs: start the grace timer |
| `session.resumed` | Jobs: cancel the grace timer |
| `session.finished` | Delivery: re-check window, Realtime (to helper) |
| `session.revoked` | Realtime (to helper), Delivery: delete undelivered photos |
| `session.expired` | Realtime (to requester) |
| `session.closed` | none (final) |
| `photo.uploaded` | Realtime (`photo.ready`), Notifications |
| `photo.discarded` | Delivery: re-check window |
| `photo.acknowledged` | Delivery: re-check window |
| `delivery.window-closed` | Realtime (`window.closed`) |
