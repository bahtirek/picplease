# Backend module: Auth

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `token.service.ts`, `helper.guard.ts`, `requester.guard.ts`, `rate-limit.config.ts`, `auth.module.ts`.
Token service: `generateSecret`, `generateToken`, `format`/`parse` (`sessionId.random`), `hash` (SHA-256 hex), `verify` (constant-time). Guards read the token, load the session, verify the hash, check the state and attach `{sessionId, role}`. A wrong token and an unknown session look the same. For the web beacon, the token may come from the request body.
