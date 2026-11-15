# Backend module: Data layer

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `database.module.ts` (`transaction`, `listenConnection`, `healthCheck`), `migrations/`, `sessions.repository.ts`, `photos.repository.ts`, `devices.repository.ts`, `r2.client.ts`.
Atomic steps that must each be a single conditional statement: `claimIfPending`, `transition(id, from, to)`, `reserveIfUnderLimit(sessionId, max, ttl)`.
R2 client: `buildKey`, `signUpload(key, type, maxSize, ttl)`, `signDownload`, `head`, `delete`, `deleteMany`. Verify R2's signing behavior for size pinning at implementation. The head check is the real enforcement.
