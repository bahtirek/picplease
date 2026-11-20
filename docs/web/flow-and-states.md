# Web: screens, states and the one-photo flow

## Screen states
| State | When | Shows |
|---|---|---|
| opening | Link parsed, claim call in flight | Spinner |
| cameraAccess | Claimed, camera permission not yet granted | Explanation and an "Allow camera" button |
| shooting | Camera live | Viewfinder, shutter, count of photos sent, Done |
| sending | Done pressed while uploads still in flight | Progress, waits for the queue |
| thanks | Finished | Thank-you message and "Get the app" links |
| codeProblem | Claim failed (NOT_FOUND, UNAUTHORIZED, ALREADY_CLAIMED, SESSION_GONE) | Ask the traveler to show a new code |
| noCamera | Permission denied or no camera | Explain how to allow it, plus Get the app |
| ended | Session expired, revoked or finished by the traveler | "Session ended. Thanks for your help!" |

Wording for each is in docs/mobile/ui-wording.md. Owner decision (2026-11-19): the flow follows the mobile helper flow (docs/mobile/helper.md); W5 aligns these states with it.

## One-photo flow
1. Shutter pressed: capture a frame from the video stream to a canvas.
2. In parallel: compress to JPEG (1920 px longest edge, quality 0.7) and request the upload URL (`POST /sessions/:id/photos`).
3. When both are ready: `PUT` the bytes to the signed URL with the signed headers.
4. `POST /photos/:id/confirm`. Retry confirm on network errors (idempotent).
5. Update the sent counter. If the limit of 5 in flight is reached, the shutter is disabled until one completes.

## Leaving the page
- Done pressed: call finish with no grace.
- Tab hidden or closed: send finish with a 30 second grace as a JSON body `{ "token": "...", "graceSeconds": 30 }` (owner decision 2026-11-19: what the backend expects; mechanism chosen in W6, see overview.md).
- Page visible again within the grace: call resume.
- 2 minutes idle: finish.
- WebSocket (optional for the helper) is used only to learn the session ended; on close 4401 or 4410 go to `ended`.
