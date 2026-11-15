# PicPlease: overview

Status: design complete, no code written yet. Values marked (proposed) are defaults that can still change.

## What PicPlease is

A traveler asks a stranger nearby to take their photo with the stranger's own phone. The photos land in the traveler's camera roll. Pairing is by QR code.

- **Requester**: the traveler. Shows a QR code, receives photos, saves them to the camera roll.
- **Helper**: the stranger. Scans the QR, takes photos with a live camera only, photos upload in the background.
- Helper has either the native app (preferred) or a web page (fallback, no install).
- Photos never pass through the API. They go from the phone straight to Cloudflare R2 using signed URLs. The API signs URLs, tracks state and notifies.

## Product rules

1. A session is created by the requester. One QR, one claim: the first helper to claim wins. The pairing secret becomes useless immediately after.
2. The pairing window is 5 minutes. After that an unclaimed session expires.
3. A claimed session allows at most 5 photos in flight at once.
4. Upload URLs are scoped to one object, short-lived, write-only and size-limited.
5. The requester can stop (revoke) at any time. The helper is told the session ended.
6. Delivery is event-driven. The delivery window closes when the helper has finished, nothing is in flight, and every uploaded photo has been downloaded.
7. Safety net: everything (photos, session rows) is deleted 48 hours after creation.
8. No photo bytes ever pass through the API.

## What the mobile app does

One native app with two roles:

- **Requester**: taps "Ask someone nearby", shows a QR code, receives photos as they arrive, saves each one to the camera roll.
- **Helper**: scans the QR in the app, goes straight to a live camera, takes photos back to back. Photos upload in the background, even if the app is closed or the phone is locked.

Photos go directly to Cloudflare R2 through signed URLs. The app only talks to the API for small JSON calls.

See docs/README.md for where everything else lives.
