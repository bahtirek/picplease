# Mobile: test plan

| Area | Cases |
|---|---|
| ApiClient (7) | 401 unauthorized. 409 already claimed. 410 gone. 429 with the upload-limit code vs a plain 429. Right role's token attached. Timeout becomes a network error. Unknown response fields ignored. |
| RealtimeClient (6) | Token sent first. Reconnect with growing delay. No reconnect after a session-gone close. Missed heartbeat reconnects. Unknown messages ignored. Snapshot after every reconnect. |
| TokenStore (3) | Save then load. Roles stored separately. `clearAll`. |
| Requester store (11) | Create to showingQR. Failed create. Claim event. First photo to receiving. Expiry shows nobodyScanned. Countdown at zero triggers a status check. Try again makes a fresh session. Stop to summary and token cleared. Window closed to summary. Snapshot resync. Restore with a gone token returns to idle. |
| ReceivingViewModel (9) | Download, save, acknowledge in order. Already-saved only acknowledged. Download failure retries. Acknowledge failure retries without saving twice. Permission denied routes to the gallery. One at a time. Remove deletes from camera roll and list. Stop cancels downloads in progress, lets completed ones finish saving and discards the rest. |
| PhotoLedger (4) | Status after `markSaved`. `unacknowledged` list. `markAcknowledged`. `clear`. |
| Helper store (11) | Valid scan to shooting. Already claimed. Unknown code. Deep link skips scanning. Offline claim shows an error. Finish to wrappingUp once URLs ready. `session.ended`. `session.finished`. Finished snapshot on foreground. Done and reset clear the token. Restore with a gone session. |
| CameraViewModel (6) | Shutter blocked offline. With 5 in flight the alert shows and the shutter is disabled, with no backend call. Capture, compress, enqueue. Alert dismisses when a slot frees. Finish waits for pending URLs. Denied camera. |
| LifecycleWatcher (4) | Background sends the grace Finish. Foreground within grace resumes. Foreground after grace checks status. Rapid flapping sends no duplicates. |
| UploadCoordinator (10) | Order of compress, URL, hand-off. Limit reached keeps the job queued. Expired URL asks for a new one (3 times). 4th failure marks failed. Success triggers confirm. Failed confirm retries without re-uploading. Session gone discards. `recover()` confirms finished jobs. `recover()` re-issues for queued jobs. `stop()` leaves uploads running. |
| UploadQueue (5) | Enqueue counts as in flight. Sixth refused. Done frees a slot. `awaitingUrlCount`. `discardAll`. |
| ImageCompressor (4) | Longest edge at most 1920. Location removed. Rotated photo upright. No upscaling. |
| Shell (7) | Link while idle starts the claim. Link while helping ignored. Unknown link ignored. Push tap opens Receiving. Stale tap goes Home. Restore picks the helper if both live. Gone sessions land on Home. |

Also test on real devices, with a checklist: airplane mode mid-upload, low power mode, locked phone, app switched away (not swiped), Android battery optimization, a poor network, a tab or app killed during a grace period.
