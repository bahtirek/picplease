# Backend module: Delivery

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `delivery.controller.ts`, `delivery.service.ts`, `delivery.module.ts`, `delivery-window.ts`, `delivery.listener.ts`, `photo-cleanup.ts`, `delivery.events.ts`, `delivery.dto.ts`, `delivery.constants.ts`.

- `listPending(sessionId)`: refused if the session is revoked, expired or closed. Realtime catch-up uses it too.
- `getDownloadUrl(photoId)`: photo must belong to the session and be uploaded. Marks nothing.
- `acknowledge(photoId)`: marks downloaded, deletes the R2 object, publishes `photo.acknowledged`. A failed delete is retried by the sweep.
- `delivery-window.ts`: `loadWindowState` (counts in flight, left, delivered) and the pure `isClosable(state)`.
- `delivery.listener.ts`: `onAcknowledged`, `onFinished`, `onDiscarded` all call `evaluateWindow(sessionId)`. If closable it calls `Sessions.markClosed` and publishes `delivery.window-closed` with the delivered count. `onRevoked` calls `deleteUndelivered`.
- `photo-cleanup.ts`: `deleteAfterAck`, `deleteMany` (48 hour sweep), `deleteUndelivered(sessionId)` (on revoke; downloaded photos stay).
