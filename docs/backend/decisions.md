# Backend: decision log

| Decision | Value |
|---|---|
| Helper finish | Explicit `finish` call, plus a 30 second grace when the app goes to the background, plus automatic finish after 2 idle minutes |
| Requester identity | Device-held `requester_token` issued at session creation. No accounts. |
| Tokens | Opaque random, stored hashed (SHA-256). Format `sessionId.random`. "Device-bound" means possession-based. |
| After revoke | Photos already downloaded stay on the phone. Photos not yet downloaded are deleted from R2 immediately. Late uploads arriving after a revoke are deleted by the stale-upload job. |
| Confirm upload | The client calls confirm after its PUT. The server verifies the object with a head request. R2 event notifications are a later hardening. |
| Upload URL timing | Requested at the shutter, in parallel with compression, signed for the 5 MB maximum. The head check enforces the real size. |
| Session row retention | Deleted at 48 hours with the photos |
| EventBus | Postgres `LISTEN/NOTIFY` behind an interface. In-memory for tests. Redis later. |
| Limits | 5 in flight, 5 MB per photo, 10 minute upload URL, 10 minute download URL (owner decision, slice 7c), JPEG only (owner decision, slice 7b) |
| Proposed rate limits | 10 per minute per IP for create and claim |

| Lifetime photo cap | None for now (owner decision, slice 8b). Only the 5 in flight limit. |
| 36 hour reminder push | Dropped for now (owner decision, slice 8b). |
| Push burst | At most one photo push per session per 60 s, plus a per-session collapse key (owner decision, slice 8b). |
| Push client | APNs and FCM through Node built-ins (`node:http2`, `fetch`, `node:crypto`), no push library (owner decision, slice 8b). |

Open (not decided): content moderation (must be settled before launch).
