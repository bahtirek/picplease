# Backend module: Notifications

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `notifications.service.ts`, `devices.controller.ts`, `push.provider.ts`, `photo.listener.ts`, `reminder.ts`, `notifications.module.ts`.

- `registerDevice(sessionId, platform, token)`: upsert.
- `notifyPhotoReady(sessionId)`: one push per burst (collapse key). Generic text, never photo content.
- `photo.listener`: pushes on `photo.uploaded` only if Realtime presence says the requester is offline.
- `push.provider.ts`: one interface, APNs and FCM adapters. `removeInvalidToken` when a provider says a token is gone.
- `reminder.ts`: undecided (36 hour reminder).
