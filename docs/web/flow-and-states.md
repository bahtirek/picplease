# Web: screens, states and the one-photo flow

## Screen states
Aligned with the mobile helper flow in W5 (owner decision 2026-11-19). Mobile names in brackets.

| State | When | Shows |
|---|---|---|
| opening [claiming] | Link parsed, claim call in flight | Spinner |
| cameraAccess (web only) | Claimed (or reloaded with a stored token), camera not open yet | "To take their photos…" and "Allow camera" |
| shooting [shooting] | Camera live | Viewfinder, shutter, "N sent", Finish; offline banner (shutter blocked), "All 5 sending, one second…" (shutter disabled until a slot frees), brief "Sending…" toast after each shot |
| sending [wrappingUp] | Finish tapped, or the server finished the session, while photos are still in flight | "Sending photo, please keep this open." and "N sent" (closing the tab stops uploads, so the mobile "Still sending in the background" is not used) |
| thanks [done] | Everything sent and the session finished | "Thanks for helping!" and Get the app |
| codeProblem [codeProblem] | Bad link or claim failed | ALREADY_CLAIMED: "This code was already used"; wrong, unknown or gone: "This code isn't valid anymore"; no answer or server error: the offline text |
| noCamera [cameraDenied] | Camera refused, missing or unusable | Denied: how to turn it on; unavailable: try another browser; Get the app |
| ended [Session ended modal] | Revoked, expired or closed (SESSION_GONE, UNAUTHORIZED, WebSocket 4410) | "Session ended. Thanks for your help!" and Get the app |

Wording for each is in docs/mobile/ui-wording.md (web rows). Finish (mobile way A): stop the camera, wait until every photo is sent (sending), then `finish` with no grace, then thanks. The web waits for the uploads rather than only for their URLs, because the page must stay open anyway. A failed finish call still ends on thanks (the server finishes an idle session after 2 minutes). The tab's stored token is removed on thanks and ended.

## One-photo flow
1. Shutter pressed: capture a frame from the video stream to a canvas.
2. In parallel: compress to JPEG (1920 px longest edge, quality 0.7) and request the upload URL (`POST /sessions/:id/photos`).
3. When both are ready: `PUT` the bytes to the signed URL with the signed headers.
4. `POST /photos/:id/confirm`. Retry confirm on network errors (idempotent).
5. Update the sent counter. If the limit of 5 in flight is reached, the shutter is disabled until one completes.

## Leaving the page
- Finish tapped: wait for the uploads, then call finish with no grace.
- Tab hidden or closed: send finish with a 30 second grace as a JSON body `{ "token": "...", "graceSeconds": 30 }` (owner decision 2026-11-19: what the backend expects; mechanism chosen in W6, see overview.md).
- Page visible again within the grace: call resume.
- 2 minutes idle: finish.
- WebSocket (optional for the helper) is used only to learn the session ended; on close 4401 or 4410 go to `ended`.
