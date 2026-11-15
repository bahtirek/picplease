# Backend: security rules

- Session ids are random UUIDs, never sequential.
- Secrets and tokens are 32 random bytes, stored only as hashes, never logged.
- Wrong secret and unknown session return the same answer.
- Signed URLs are single-object, write-only for uploads, read-only for downloads, short-lived.
- Object keys come only from the server.
- The R2 buckets are private. CORS allows `PUT` from `https://picplease.app` only.
- A QR screenshot is the known weakness: the 5 minute window, the single claim, the requester seeing "claimed" and being able to stop all limit it. Review before launch.
- Browser access is limited by CORS to `WEB_ORIGIN`. The WebSocket upgrade checks the origin for browser clients.
- Logs never contain tokens, secrets or the `Authorization` header.
