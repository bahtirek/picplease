# PicPlease
A traveler's photo is taken by a stranger. Photos go phone -> Cloudflare R2 -> traveler's phone.
Product rules and decisions: docs/00-overview.md. Index of all docs: docs/README.md.

## Layout
backend/ (NestJS on Fastify, TypeScript, Postgres), web/ (TypeScript page), ios/, android/, docs/

## Rules
- Plain SQL with the pg driver. No ORM.
- Tokens and secrets are stored hashed. Never log them. Never read or print .env files.
- Photo bytes never pass through the API.
- Work one slice at a time. Read only the docs files named in the task.
- Write tests from the test list in docs/ with the code. Run only the tests for the area you changed.
- Keep command output short.
- If the docs are ambiguous or say "(proposed)", ask before deciding.
- Never use the production database, bucket or server from a dev machine.
- Use npm, Jest, ESLint and Prettier. Node 24 is pinned.
- Backend code lives in backend/src/<module>/. Shared code goes in backend/src/common/.
- Ask before adding any dependency that is not named in docs/backend/stack.md.
- Logging must redact the Authorization header and any field named token or secret.
- The API sends CORS headers allowing only WEB_ORIGIN (https://picplease.app).
- Never push or force-push. Commit only at the end of a slice.
- After a slice: run its tests, update docs/PROGRESS.md, commit.

## Commands
Run from backend/ with Node 24 (`.nvmrc`; npm refuses other versions).
- `npm install` — install dependencies
- `npm run start:dev` — run with watch (needs NODE_ENV, PORT, WEB_ORIGIN, DATABASE_URL in the environment)
- `npm run build` then `npm start` — compile to dist/ and run
- `npm test` — all Jest tests; `npm test -- <path>` for one area
- `npm run lint` / `npm run format` / `npm run format:check`
- `npm run migrate` — build and apply pending SQL migrations to DATABASE_URL (reads .env if present)
- Database tests need DATABASE_URL_TEST (a database ending in `_test`). Local Postgres: `docker start picplease-pg` (localhost:5433)
- `npm run delivery:check` — scripted client: one photo end to end through the API and the dev bucket (needs a migrated `*_dev` DATABASE_URL and the dev R2 settings)
- `npm run openapi` — build and write backend/openapi.json (no docs page is served)
- `npm run deploy` — owner only: build HEAD, upload to the VPS, migrate, restart, check /health; `npm run deploy -- rollback` (docs/backend/deploy.md)

iOS (from ios/, Xcode 26, iOS 17+; decisions in docs/mobile/decisions.md):
- `xcodebuild test -project PicPlease.xcodeproj -scheme PicPlease -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.3.1'` — all iOS tests (package and app-hosted)
- `swift format lint -r PicPlease PicPleaseTests PicPleaseKit/Sources PicPleaseKit/Tests` — lint; `swift format format -i -r ...` to format
