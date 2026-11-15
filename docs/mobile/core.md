# Mobile: shared core

API, errors and WebSocket messages are defined in docs/backend/api-contract.md and docs/backend/protocol-and-events.md.

**ApiClient** (URLSession on iOS, OkHttp on Android). Never retries on its own. Picks the token by role on each call.

| Call | Endpoint | Notes |
|---|---|---|
| `createSession()` | `POST /sessions` | link, QR PNG, requester token, limits |
| `getStatus(id)` | `GET /sessions/:id` | either role |
| `revokeSession(id)` | `POST /sessions/:id/revoke` | |
| `listPending(id)` | `GET /sessions/:id/photos` | photos plus session state |
| `getDownloadUrl(photoId)` | `GET /photos/:id/download` | |
| `acknowledge(photoId)` | `POST /photos/:id/ack` | safe to repeat; treat `SESSION_GONE` as success |
| `registerDevice()` | `POST /sessions/:id/device` | push token |
| `claimSession()` | `POST /sessions/:id/claim` | no token; not retried automatically |
| `issueUploadUrl()` | `POST /sessions/:id/photos` | content type only |
| `confirmUpload()` | `POST /photos/:id/confirm` | safe to repeat |
| `requestFinish()` | `POST /sessions/:id/finish` | optional grace seconds |
| `resume()` | `POST /sessions/:id/resume` | |

**ApiError** cases: network/timeout, unauthorized/notFound (401, 404), alreadyClaimed/gone/finished (409, 410, `SESSION_FINISHED`), limits (`UPLOAD_LIMIT_REACHED`, `RATE_LIMITED`), invalidRequest, server/malformed. Screens react to these cases, never to raw status numbers.

**RealtimeClient**: connects to `wss://api.picplease.app/ws`, sends `{type:"auth", token}` as the first message, exposes a stream of typed events (AsyncStream on iOS, Flow on Android). Reconnects with backoff from 1 to 30 seconds with jitter. Does not retry after close code 4410. Uses the built-in ping as heartbeat.

**WireEvents** (7): `snapshot`, `session.claimed`, `photo.ready`, `session.expired`, `session.ended`, `session.finished`, `window.closed`. Unknown types are ignored.

**TokenStore**: save, load, clear per role. iOS Keychain with the device-only (no iCloud sync) setting. Android Keystore-backed storage, excluded from backup. iOS Keychain survives reinstall, so `SessionRestorer` checks the status on launch and clears stale tokens.

**ConnectivityMonitor**: `NWPathMonitor` on iOS, `NetworkCallback` on Android. `isOnline` and a debounced `observe()`.

**AppConfig**: endpoints, timeouts, backoff, the 30 second grace, fallback limits, environments (debug, staging, release).
