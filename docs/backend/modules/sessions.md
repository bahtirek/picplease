# Backend module: Sessions

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `sessions.controller.ts`, `sessions.service.ts`, `sessions.module.ts`, `session-state.ts`, `qr.service.ts`, `session.events.ts`, `sessions.dto.ts`, `sessions.constants.ts`.

- `createSession()`: random ids, pairing secret and requester token (32 bytes each), stores only hashes, publishes `session.created`, renders the QR.
- `claimSession(id, secret)`: one conditional UPDATE (only if pending, not expired, secret matches) so exactly one claim wins. Issues the helper token. Publishes `session.claimed`.
- `revokeSession(id)`: pending, claimed or finished to revoked. Publishes `session.revoked`.
- `markFinished(id)`, `requestFinish(id, graceSeconds)` (publishes `session.finish-requested`), `resume(id)` (publishes `session.resumed`), `getStatus(id)`.
- `expirePending(id)` (called by Jobs), `markClosed(id)` (called by Delivery), `touchActivity(id)` (called by Uploads).
- `session-state.ts`: `canTransition`, `assertTransition`, `isTerminal`, the transitions table.
- `qr.service.ts`: `renderPng(link)` is the main output. `renderSvg(link)` optional.
- QR link format: `https://picplease.app/s/{sessionId}#{pairingSecret}`. The secret is the URL fragment, so a browser never sends it to a server, a log or a Referer (owner decision 2026-11-19, slice L1).
