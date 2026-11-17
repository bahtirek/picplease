# Backend module: Uploads

Rules for how modules depend on each other are in docs/backend/modules/README.md.

Files: `uploads.controller.ts`, `uploads.service.ts`, `uploads.module.ts`, `upload-limits.ts`, `upload.events.ts`, `uploads.dto.ts`, `uploads.constants.ts`, `moderation.hook.ts`.

- `issueUploadUrl(sessionId, req)`: session must be claimed. `reserveSlot` checks the count and inserts the pending photo in one step (never exceeds 5). Signs a PUT URL for the server-made key at the 5 MB maximum. Calls `touchActivity`.
- `confirmUpload(photoId)`: the photo must belong to the token's session. Head check for existence, size and type. Deletes the object if the check fails. Marks uploaded, publishes `photo.uploaded`. Safe to repeat without a second event.
- `reconcileStale(photoId)` (Jobs): same check with no helper token. Promotes the photo if the object exists. On a revoked, expired or closed session it deletes the object instead. If nothing is there, discards the row and publishes `photo.discarded`.
- `moderation.hook.ts`: undecided. A step between the head check and `photo.uploaded`. Default `NoopModeration` allows everything.
- No lifetime photo cap per session (owner decision, slice 8b); only the 5 in flight limit applies.
