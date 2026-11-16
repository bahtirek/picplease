# Backend: stack and environment

| Item | Choice |
|---|---|
| Language and framework | TypeScript, NestJS on the Fastify adapter, Node 24 |
| Database | PostgreSQL 18 on the same server, plain SQL through the `pg` driver, no ORM. Direct (non-pooled) connection is required. |
| Jobs | `pg-boss` on the same Postgres |
| Realtime | Plain WebSocket (`@nestjs/platform-ws`), JSON messages. No Socket.IO. |
| Photo storage | Cloudflare R2 (S3-compatible API), signed URLs |
| Rate limiting | `@fastify/rate-limit`, in-memory store (single instance). Only routes marked `@RateLimited()` are limited. |
| QR codes | `qrcode` 1.5.4 (PNG for the create response, SVG optional). Owner-approved in slice 5. |
| API contract | `@nestjs/swagger` generates OpenAPI. Swift, Kotlin and TypeScript models are generated from it. |
| Hosting | One Bluehost self-managed VPS, Ubuntu 26.04 LTS, 1 vCPU, 2 GB. Nginx in front, systemd runs the app. Single instance. |
| Domain | `picplease.app` (links and helper page), `api.picplease.app` (API and WebSocket). DNS at Hostinger. TLS by Let's Encrypt. |

Already done on the server: key-only SSH (user `deploy`), firewall (22, 80, 443), Postgres on `127.0.0.1:5432` with database `picplease` and limited user `picplease_app`, Nginx, certificates, a `/health` endpoint placeholder.

Environment variables (secrets only in a root-readable env file on the server, never in git):

| Variable | Notes |
|---|---|
| `NODE_ENV`, `PORT` | |
| `DATABASE_URL` | localhost, user `picplease_app` |
| `LINK_BASE_URL` | `https://picplease.app` |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` | optional; default 10 requests per 60000 ms per IP, per limited route (create, claim) |
| `WEB_ORIGIN` | `https://picplease.app`. The only origin allowed by CORS and by the WebSocket origin check. |
| `EVENT_BUS` | `postgres` (or `memory` for tests) |
| `R2_ENDPOINT` | `https://5e30bb91025217d71df1d3412cf6e152.r2.cloudflarestorage.com` |
| `R2_BUCKET` | `picplease-photos-prod` on the server, `picplease-photos-dev` for development |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | separate tokens for dev and prod, each limited to its own bucket |
| `APNS_*`, `FCM_*` | push credentials, added in milestone 3 |


## Tooling

npm, Jest, ESLint and Prettier. Node 24 pinned in the project. Strict TypeScript. Before scaffolding, verify that the installed NestJS, Fastify adapter and Node 24 versions work together.

## Cross-origin rule

The helper web page runs on `https://picplease.app` and calls `https://api.picplease.app`, which is a different origin. The API must send CORS headers allowing only `WEB_ORIGIN`, with the `Authorization` and `Content-Type` headers. The WebSocket upgrade must check the same origin for browser clients. Native apps are unaffected.
