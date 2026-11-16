# Backend module: Data layer

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `database.module.ts` (`transaction`, `listenConnection`, `healthCheck`), `migrations/`, `sessions.repository.ts`, `photos.repository.ts`, `devices.repository.ts`, `r2.client.ts`.
Atomic steps that must each be a single conditional statement: `claimIfPending`, `transition(id, from, to)`, `reserveIfUnderLimit(sessionId, max, ttl)`.

In-flight counter (owner decision, slice 7b): `sessions.photos_in_flight` counts pending photos (migration 005). `reserveIfUnderLimit` is one statement: a CTE increments the counter only while `state = 'claimed' AND photos_in_flight < max`, then inserts the photo. A `count(*)` in the same statement would read a stale snapshot under READ COMMITTED and let two simultaneous requests both pass; the row lock on the counter makes the waiting request re-check the committed value. `markUploaded` and `discardPending` decrement the counter in the same statement.
R2 client: `buildKey`, `signUpload(key, type, ttl)`, `signDownload(key, ttl)`, `head`, `delete`, `deleteMany`. The content type is signed: an upload with another type gets 403.
Size pinning (verified against the dev bucket in slice 7a): R2 cannot limit an upload to a range of sizes. Our upload URL accepted a 6 MB body, and a signed Content-Length only pins one exact size, which is not known when the URL is issued. So `signUpload` takes no size (owner decision) and the head check after upload is the only size enforcement.
