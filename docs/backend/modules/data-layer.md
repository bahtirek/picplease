# Backend module: Data layer

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `database.module.ts` (`transaction`, `listenConnection`, `healthCheck`), `migrations/`, `sessions.repository.ts`, `photos.repository.ts`, `devices.repository.ts`, `r2.client.ts`.
Atomic steps that must each be a single conditional statement: `claimIfPending`, `transition(id, from, to)`, `reserveIfUnderLimit(sessionId, max, ttl)`.
R2 client: `buildKey`, `signUpload(key, type, ttl)`, `signDownload(key, ttl)`, `head`, `delete`, `deleteMany`. The content type is signed: an upload with another type gets 403.
Size pinning (verified against the dev bucket in slice 7a): R2 cannot limit an upload to a range of sizes. Our upload URL accepted a 6 MB body, and a signed Content-Length only pins one exact size, which is not known when the URL is issued. So `signUpload` takes no size (owner decision) and the head check after upload is the only size enforcement.
