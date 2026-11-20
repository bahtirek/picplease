# Web: helper page overview

Status: W1 to W7 built; the real-device check (docs/web/deploy.md) is pending. Values marked (proposed) can still change.

## Purpose
Fallback for helpers who do not have the app. The helper scans the QR code, the link opens `https://picplease.app/s/<sessionId>#<secret>` in the phone browser, the helper takes live photos, and each photo uploads straight to R2. The traveler's app receives them. The page never shows a gallery and never lets the helper pick existing files (camera stream only, no file input).

## Stack
- Vite, TypeScript strict, Vitest (happy-dom for the screen tests only, owner-approved in W5). No runtime dependencies. Ask before adding any.
- Size budget: 40 KB gzip for all JS and CSS (proposed).
- Static files served by Nginx at picplease.app. `/s/*` serves `index.html`.
- Talks to `https://api.picplease.app` (CORS: only `https://picplease.app`). Photos PUT directly to R2 (R2 CORS allows PUT from `https://picplease.app`).

## Rules
- The secret in the link fragment is read once, sent in the claim call, then removed from the address bar (`history.replaceState`).
- The helper token lives in `sessionStorage` only, keyed by session id. Never `localStorage`, never logged, never in a URL.
- Only wording from docs/mobile/ui-wording.md. Do not invent new messages.
- Wrong secret and unknown session look identical to the user (`codeProblem`).
- Link files served at `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (content needs Apple Team ID and Android fingerprints, see docs/open-items.md).
- Headers: `Permissions-Policy: camera=(self)`, `Referrer-Policy: no-referrer`, CSP limiting connect-src to the API, its WebSocket and R2.
- Upload limits (5 in flight, 5 MB, JPEG, 1920 px longest edge, quality 0.7) come from the claim response; do not hard-code beyond the defaults.

## Owner decisions (2026-11-19)
- Lint and format: ESLint and Prettier, same versions and config as backend/.
- Commit at the end of every web slice (as in the root CLAUDE.md).
- Link format: the secret goes in the fragment, `https://picplease.app/s/<sessionId>#<secret>`, so it never reaches a server, a log or a Referer. Switched in slice L1 (backend link builder and tests, iOS fixtures, docs).
- Leaving the page: finish is sent the way the backend expects, a JSON body `{ "token": "...", "graceSeconds": 30 }` (the guard reads `token` from the body; the backend has no text/plain parser). The send mechanism (`fetch` with `keepalive` or `sendBeacon` with a JSON Blob) is chosen and checked on real devices in W6.
- Flow and wording: the same as the helper flow in the mobile app (docs/mobile/helper.md, ui-wording.md): shoot back to back, a brief "Sending…" toast, "All 5 sending, one second…" when 5 are in flight, Finish, the Session ended message. Web differences (W5, owner-approved): after Finish the page shows "Sending photo, please keep this open." until every photo is sent (closing the tab stops uploads), then "Thanks for helping!" with Get the app; web-only screens (camera access, no camera, Get the app) have their own rows in ui-wording.md. States: flow-and-states.md.
