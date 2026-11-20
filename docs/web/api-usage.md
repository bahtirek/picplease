# Web: how the page uses the API

Full contract: docs/backend/api-contract.md and protocol-and-events.md.

| Moment | Call | Notes |
|---|---|---|
| Page open | `POST /sessions/:id/claim` with the secret | Store the helper token in sessionStorage |
| Shutter | `POST /sessions/:id/photos` | Bearer token; content type image/jpeg |
| Upload | `PUT` signed URL | Use the signed headers exactly |
| After upload | `POST /photos/:id/confirm` | Idempotent, safe to retry |
| Done | `POST /sessions/:id/finish` | No grace |
| Tab hidden | finish that survives the page closing | JSON body with token and graceSeconds 30 (mechanism chosen in W6) |
| Back to tab | `POST /sessions/:id/resume` | Within the grace window |

Errors: UPLOAD_LIMIT_REACHED means wait for an in-flight photo; SESSION_FINISHED or SESSION_GONE means `ended`; RATE_LIMITED means retry after a pause.
Env (see web/.env.example): VITE_API_BASE, VITE_WS_URL, VITE_APP_STORE_URL, VITE_PLAY_STORE_URL.
