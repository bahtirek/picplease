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
| Proposed limits | 5 in flight, 5 MB per photo, 10 minute upload URL, 10 minute download URL, JPEG only |
| Proposed rate limits | 10 per minute per IP for create and claim |

Open (not decided): lifetime photo cap per session, content moderation (must be settled before launch), the 36 hour reminder push.
