# Progress

Update this file at the end of every slice. A new session starts by reading it.

## Done
- Design: all docs in docs/.
- Server (Bluehost VPS, Ubuntu): key-only SSH (user deploy), firewall 22/80/443, Postgres 18 on localhost (database picplease, user picplease_app), Node 24, Nginx, Let's Encrypt certificates, /health placeholder.
- DNS for picplease.app and api.picplease.app (Hostinger).
- Cloudflare R2 buckets: picplease-photos-dev and picplease-photos-prod.
- Backend scaffold: NestJS 12.5 on Fastify 5, TypeScript 6.0 strict, Jest 30, ESLint 10, Prettier, Node 24 pinned. Env validation at startup, GET /health, global {code, message} error filter, log redaction, CORS for WEB_ORIGIN only, OpenAPI export script.
- Data layer (slice 2): database module, migrations 001–004 with `npm run migrate`, sessions repository (claim, transition, touchActivity, findIdle, purge).
- Auth (slice 3): token service, helper and requester guards, `@Auth()` context, rate limiting (`@fastify/rate-limit`, `@RateLimited()`).
- EventBus (slice 4): interface, in-memory bus, Postgres LISTEN/NOTIFY bus with reconnect.

## To confirm (owner)
- Provider snapshot of the finished server.
- R2: CORS rule on both buckets, 2-day expiry rule, buckets private, separate dev and prod tokens, secrets in a password manager.
- Google Play account. Apple Team ID. App identifier (proposed: app.picplease.mobile).

## Added after review
- CORS: the API must allow only WEB_ORIGIN (the helper page is on a different origin). Included in slice 1.

## Decisions pending
See docs/open-items.md.

## Next
Backend slice 5: sessions (docs/backend/slices.md).

Moved tests (owner decision, slice 2): the Data layer test "sixth concurrent reservation refused" belongs to slice 7b (photos repository, `reserveIfUnderLimit`); the four R2 Data layer tests belong to slice 7a.

## Session log
(Add one line per finished slice: date, slice, what changed, anything the next session must know.)
- 2026-11-15, backend scaffold: backend/ created. Notes: NestJS 12 is ESM-only; the backend compiles to CommonJS and loads Nest through Node 24 require(esm), so `npm test` sets --experimental-vm-modules. TypeScript is pinned to 6.0.x (swagger, ts-jest and typescript-eslint don't accept 7 yet). Run dev with `nest start --watch`, not tsx (esbuild drops decorator metadata). Only NODE_ENV, PORT and WEB_ORIGIN are validated so far; add the others as slices use them.
- 2026-11-15, error handler: global filter in backend/src/common/errors/. Modules throw `new AppError(code)` (leave the message out for NOT_FOUND and UNAUTHORIZED so they look identical). Nest HttpExceptions and Fastify errors are mapped too; unlisted 4xx become INVALID_REQUEST with their real status; anything else is a generic INTERNAL_ERROR (500) and is logged. INTERNAL_ERROR and the 4xx rule were added to api-contract.md (owner decision). createApp takes `imports` for test-only modules.
- 2026-11-15, slice 2 data layer: backend/src/database/ (DatabaseModule is global; repositories take an optional `db` so they can run inside `DatabaseService.transaction`). DATABASE_URL is now required at startup. Own migration runner (schema_migrations table, advisory lock, one transaction per file); the build copies the .sql files into dist/. Local Postgres is the Docker container `picplease-pg` (postgres:18, localhost:5433, volume picplease-pg) with databases picplease_dev and picplease_test. DB tests read DATABASE_URL_TEST (from .env if set), refuse a database not ending in _test, and run each test file in its own throwaway schema. `transition` only covers finished/closed/revoked/expired; which moves are legal is left to the slice 5 rulebook. `purgeCreatedBefore` deletes regardless of state; slice 8a picks the cutoff and any state filter.
- 2026-11-15, slice 3 auth: backend/src/auth/. Token = `sessionId.random` (32 bytes base64url); only hash(random) is stored, so it can be computed before the row and its id exist (`generateToken()` returns {random, hash}; `format(id, random)` gives the client token). Guards take `Authorization: Bearer` or `{ token }` in the body (beacon), refuse a token whose session differs from the route's `:id`, and answer every failure with the same UNAUTHORIZED. Owner decisions: requester token accepted in every state; helper token only in claimed and finished; per-route state rules belong to the slice 5 rulebook. Rate limit: `@fastify/rate-limit` 11.2.2 (owner-approved, added to stack.md), global:false, routes opt in with `@RateLimited()` (slice 5 must mark create and claim); 10 per 60 s per IP per route by default, optional RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS. `openTestDb()` now returns a `databaseUrl` bound to its schema for full-app tests. The sandbox may block reading backend/.env; pass DATABASE_URL_TEST in the environment if DB tests say it is not set.
- 2026-11-15, slice 4 eventbus: backend/src/eventbus/. Inject `EVENT_BUS` (from `EventBusModule`, not in AppModule yet; Sessions should import it). Event names are a typed union (`EVENT_NAMES`) from protocol-and-events.md; payloads are flat scalars (IDs), and publish throws if the JSON is 8000 bytes or more. One channel `picplease_events` carries every event as `{n, p}`; publish is `SELECT pg_notify` on `tx` or the pool, so a rolled-back transaction never delivers. The listen connection starts in the background (startup does not wait for the database) and reconnects with backoff from 0.5 s to 30 s; `whenListening()` resolves once it is listening. Handlers run asynchronously, each gets a frozen copy of the payload, and a handler that throws is logged without affecting the others. `InMemoryEventBus` delivers on the next microtask and ignores `tx` (it cannot see a rollback). Tests give each case its own channel. EventBus has 11 tests: the 4 shared tests run on both buses, plus reconnect, rollback and payload size on Postgres.
