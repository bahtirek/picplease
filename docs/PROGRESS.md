# Progress

Update this file at the end of every slice. A new session starts by reading it.

## Done
- Design: all docs in docs/.
- Server (Bluehost VPS, Ubuntu): key-only SSH (user deploy), firewall 22/80/443, Postgres 18 on localhost (database picplease, user picplease_app), Node 24, Nginx, Let's Encrypt certificates, /health placeholder.
- DNS for picplease.app and api.picplease.app (Hostinger).
- Cloudflare R2 buckets: picplease-photos-dev and picplease-photos-prod.
- Backend scaffold: NestJS 12.5 on Fastify 5, TypeScript 6.0 strict, Jest 30, ESLint 10, Prettier, Node 24 pinned. Env validation at startup, GET /health, global {code, message} error filter, log redaction, CORS for WEB_ORIGIN only, OpenAPI export script.

## To confirm (owner)
- Provider snapshot of the finished server.
- R2: CORS rule on both buckets, 2-day expiry rule, buckets private, separate dev and prod tokens, secrets in a password manager.
- Google Play account. Apple Team ID. App identifier (proposed: app.picplease.mobile).

## Added after review
- CORS: the API must allow only WEB_ORIGIN (the helper page is on a different origin). Included in slice 1.

## Decisions pending
See docs/open-items.md.

## Next
Backend slice 2: data layer (docs/backend/slices.md). Slice 1 is done. The global error filter from slice 3 is already built; slice 3 still needs the token service, guards and rate limits.

## Session log
(Add one line per finished slice: date, slice, what changed, anything the next session must know.)
- 2026-11-15, backend scaffold: backend/ created. Notes: NestJS 12 is ESM-only; the backend compiles to CommonJS and loads Nest through Node 24 require(esm), so `npm test` sets --experimental-vm-modules. TypeScript is pinned to 6.0.x (swagger, ts-jest and typescript-eslint don't accept 7 yet). Run dev with `nest start --watch`, not tsx (esbuild drops decorator metadata). Only NODE_ENV, PORT and WEB_ORIGIN are validated so far; add the others as slices use them.
- 2026-11-15, error handler: global filter in backend/src/common/errors/. Modules throw `new AppError(code)` (leave the message out for NOT_FOUND and UNAUTHORIZED so they look identical). Nest HttpExceptions and Fastify errors are mapped too; unlisted 4xx become INVALID_REQUEST with their real status; anything else is a generic INTERNAL_ERROR (500) and is logged. INTERNAL_ERROR and the 4xx rule were added to api-contract.md (owner decision). createApp takes `imports` for test-only modules.
