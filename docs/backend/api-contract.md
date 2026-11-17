# Backend: API contract

All JSON. Auth is `Authorization: Bearer <token>`. Errors always return `{ "code": "...", "message": "..." }`.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /sessions` | none, rate limited | Create. Returns session id, link, QR image (PNG, base64), requester token, expiry, limits. |
| `POST /sessions/:id/claim` | none, rate limited | Body: pairing secret. Returns helper token, session id, limits. |
| `GET /sessions/:id` | either token | State and timestamps. |
| `POST /sessions/:id/revoke` | requester | Stop. |
| `POST /sessions/:id/finish` | helper | Optional `graceSeconds` (capped at 30). No grace means finish now. |
| `POST /sessions/:id/resume` | helper | Cancels a pending grace finish. |
| `POST /sessions/:id/photos` | helper | Body: content type. Returns photo id, signed PUT URL, signed headers, expiry. |
| `POST /photos/:id/confirm` | helper | Idempotent. Verifies the object, marks uploaded. |
| `GET /sessions/:id/photos` | requester | Pending photos (uploaded, not downloaded), oldest first, plus session state. |
| `GET /photos/:id/download` | requester | Signed GET URL. Marks nothing. |
| `POST /photos/:id/ack` | requester | Idempotent. Marks downloaded and deletes the R2 object. |
| `POST /sessions/:id/device` | requester | Body: platform and push token. |
| `GET /health` | none | Liveness. |

Create response fields: `sessionId`, `link`, `qrPngBase64`, `requesterToken`, `expiresAt`, `limits`. Claim response: `sessionId`, `helperToken`, `limits`. Status, revoke, finish and resume return the session status (`sessionId`, `state`, and the timestamps).

Uploads (slice 7b): `POST /sessions/:id/photos` takes `{ contentType }`, which must be `image/jpeg` (owner decision; anything else is `INVALID_REQUEST`). It returns `photoId`, `url`, `headers` (send them with the PUT exactly as given) and `expiresAt`. Not claimed: `SESSION_FINISHED` (finished) or `SESSION_GONE`; full: `UPLOAD_LIMIT_REACHED`. `POST /photos/:id/confirm` returns `{ photoId, status: "uploaded" }`. Unknown or another session's photo is `NOT_FOUND`. Object not there yet: `INVALID_REQUEST`, the photo stays pending and confirm can be retried. Empty, over 5 MB or wrong content type: `INVALID_REQUEST`, and the object and photo are discarded (`photo.discarded`). On a revoked, expired or closed session the helper token is refused (`UNAUTHORIZED`).

Delivery (slice 7c): `GET /sessions/:id/photos` returns `{ state, photos: [{ photoId, sizeBytes, uploadedAt }] }`, uploaded and not downloaded, oldest first. It is refused (`SESSION_GONE`) only once the session is revoked, expired or closed, as delivery.md says; a pending session gets an empty list. `GET /photos/:id/download` returns `{ photoId, url, expiresAt }` (10 minute URL, owner decision); a photo not uploaded yet is `INVALID_REQUEST`, and an already downloaded photo is `NOT_FOUND`. `POST /photos/:id/ack` returns `{ photoId, status: "downloaded" }`. Owner decision: acking an already downloaded photo answers 200 in any session state (so a retried ack after the window closed is not an error); a first ack needs `claimed` or `finished`. Unknown or another session's photo is `NOT_FOUND`; all three routes take the requester token only, and the photo routes use `:photoId` like confirm.

Claim errors (owner decision, slice 5): the secret is checked first, so a wrong secret or unknown id is `NOT_FOUND` whatever the state. Then `claimed` or `finished` is `ALREADY_CLAIMED`; pending past its expiry, `expired`, `revoked` or `closed` is `SESSION_GONE`.

Finish: `graceSeconds` above 30 is capped to 30. With a grace, the state stays `claimed` and Jobs finishes it later; `resume` cancels that. Calling finish, resume or revoke in a state that does not allow it returns `SESSION_FINISHED` (finished) or `SESSION_GONE` (terminal).

Limits object in create and claim responses: `maxInFlight`, `maxPhotoBytes`, `uploadUrlTtlSeconds`.

Error codes:

| Code | HTTP | Meaning |
|---|---|---|
| `NOT_FOUND` | 404 | Unknown session, or wrong pairing secret. The two look identical on purpose. |
| `UNAUTHORIZED` | 401 | Missing or wrong token. Also identical for unknown sessions. |
| `ALREADY_CLAIMED` | 409 | Someone else claimed it first. |
| `SESSION_FINISHED` | 409 | The helper's session is finished (no new photos). |
| `SESSION_GONE` | 410 | Revoked, expired or closed. |
| `UPLOAD_LIMIT_REACHED` | 429 | 5 already in flight. |
| `RATE_LIMITED` | 429 | Too many requests. |
| `INVALID_REQUEST` | 400 | Bad input. Other 4xx errors not listed here (405, 413, 415) also use this code but keep their real HTTP status. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. The message is always generic; details are only logged. |

Which states allow which calls:

| Call | Allowed in |
|---|---|
| issue upload URL | `claimed` |
| confirm upload | `claimed`, `finished` |
| finish, resume | `claimed` |
| list pending, download URL | `claimed`, `finished` |
| acknowledge | `claimed`, `finished` |
| status | any state |
