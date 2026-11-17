# Backend module: Notifications

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `notifications.service.ts`, `devices.controller.ts`, `devices.dto.ts`, `push.provider.ts`, `apns.provider.ts`, `fcm.provider.ts`, `jwt.ts`, `photo.listener.ts`, `notifications.constants.ts`, `notifications.module.ts`. Repository: `database/devices.repository.ts`.

- `registerDevice(sessionId, platform, token)`: upsert (same session and token updates the platform). Allowed while the session is pending, claimed or finished; afterwards `SESSION_GONE`.
- `notifyPhotoReady(sessionId)`: one push per burst (owner decision, slice 8b): at most one push per session per 60 s, plus a collapse key `photos-{sessionId}` so the phone keeps only the latest. The cooldown is one conditional UPDATE on `sessions.last_push_at` (migration 006) that also returns the session's devices; it only takes the slot when the session is claimed or finished and has a device. Generic text ("You have new photos to save."), never photo content, photo IDs or URLs; data is `{type: "photo.ready", sessionId}`.
- `photo.listener`: pushes on `photo.uploaded` only if Realtime presence says the requester is offline (an online requester does not use up the cooldown).
- `push.provider.ts`: one interface (`send` returns sent, invalid-token, failed or disabled; never throws, never logs the token), routed by platform to the APNs and FCM adapters. `removeInvalidToken` deletes that platform and token from every session when a provider says it is gone.
- APNs and FCM adapters (owner decision, slice 8b: no push library, only Node built-ins). APNs: HTTP/2 (`node:http2`) with a token-based ES256 provider key, renewed every 50 minutes; 410, `BadDeviceToken`, `DeviceTokenNotForTopic` and `Unregistered` mean the token is gone. FCM: HTTP v1 through `fetch`, OAuth access token from a service-account RS256 JWT; 404/`UNREGISTERED`, `SENDER_ID_MISMATCH` and an `INVALID_ARGUMENT` about the registration token mean the token is gone. Pushes expire after one hour.
- Credentials are optional: without them a platform's pushes are off (logged once at startup). See stack.md for the variables. The real adapters have not been tried against Apple or Google yet; that needs the credentials.
- 36 hour reminder: dropped (owner decision, slice 8b).
