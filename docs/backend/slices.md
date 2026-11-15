# Backend slices

One slice per session. Start each in plan mode, read only the files listed, finish with tests, update docs/PROGRESS.md, commit, then clear the session.

Local requirements: a local Postgres for development and tests, and the dev R2 key in backend/.env. Never use production.

## Slice 1: scaffold
Read: docs/backend/stack.md.
Build: NestJS on the Fastify adapter in backend/, strict TypeScript, Jest, ESLint, Prettier, Node 24 pinned. Config from environment variables, validated at startup (only the variables used so far are required). GET /health returns {"status":"ok"} with no database check yet. Logging redacts the Authorization header and fields named token or secret. CORS allows only WEB_ORIGIN. OpenAPI is exported to backend/openapi.json by an npm script and no docs page is served in production. No module code yet.
Done when: tests run, /health answers, and the Commands section of CLAUDE.md and docs/PROGRESS.md are updated.

Prompt:

```
Read docs/backend/stack.md only. Plan first, do not edit yet.
Then scaffold backend/: NestJS on the Fastify adapter, strict TypeScript, Jest, ESLint, Prettier,
Node 24 pinned. Config from environment variables, validated at startup (only the variables used
so far are required). GET /health returns {"status":"ok"} with no database check yet.
Logging redacts the Authorization header and fields named token or secret. CORS allows only WEB_ORIGIN.
OpenAPI is exported to backend/openapi.json by an npm script; do not serve a docs page in production.
Do not create any module code (sessions, uploads and so on) yet.
First check that the installed NestJS, Fastify adapter and Node 24 versions work together and tell me.
Done when: tests run, /health answers, and CLAUDE.md "Commands" and docs/PROGRESS.md are updated.
```

## Slice 2: data layer
Read: docs/backend/state-and-data.md, docs/backend/modules/data-layer.md.
Build: database module (transaction, direct listen connection), the four plain SQL migrations, sessions repository including the atomic claim and conditional transition.
Done when: the Data layer tests in docs/backend/tests.md pass against a real Postgres, including two concurrent claims with exactly one winner.

## Slice 3: auth
Read: docs/backend/modules/auth.md, docs/backend/security.md.
Build: token service, helper and requester guards, rate limit config, the global error filter.
Done when: the 8 Auth tests pass.

## Slice 4: eventbus
Read: docs/backend/modules/eventbus.md, docs/backend/protocol-and-events.md (internal events).
Build: interface, in-memory version, Postgres LISTEN/NOTIFY version with reconnect.
Done when: the 6 EventBus tests pass, including the rolled-back transaction case.

## Slice 5: sessions
Read: docs/backend/modules/sessions.md, docs/backend/api-contract.md, docs/backend/state-and-data.md.
Build: state rulebook, service, controller, QR rendering, events.
Done when: create, claim, status, revoke, finish and resume work through the API and the 8 Sessions tests pass.

## Slice 6: realtime basics
Read: docs/backend/modules/realtime.md, docs/backend/protocol-and-events.md.
Build: WebSocket gateway with first-message auth, presence, snapshot, listener for session events.
Done when: the Realtime tests that do not need photos pass. This completes milestone 2.

## Slice 7a: R2 client
Read: docs/backend/modules/data-layer.md (R2 section).
Build: buildKey, signUpload, signDownload, head, delete, deleteMany. Verify R2's signing behavior for size pinning and report the result.
Done when: the R2 client tests pass (faked) and one manual check against the dev bucket succeeds.

## Slice 7b: uploads
Read: docs/backend/modules/uploads.md, docs/backend/api-contract.md.
Done when: the 9 Uploads tests pass.

## Slice 7c: delivery
Read: docs/backend/modules/delivery.md.
Done when: the 12 Delivery tests pass and a scripted client moves a photo end to end through the dev bucket.

## Slice 8a: jobs
Read: docs/backend/modules/jobs.md.
Done when: the 8 Jobs tests pass.

## Slice 8b: notifications
Read: docs/backend/modules/notifications.md.
Done when: the 6 Notifications tests pass. Needs the lifetime-cap and reminder decisions in docs/open-items.md. This completes milestone 3.

## Slice 9: deployment
Build: a deploy script or documented steps (build, copy, run migrations, restart the systemd service). The owner runs the final deploy, not the agent.
Done when: the live /health shows the new build.
