# Mobile: requester flow

**States**: `idle`, `creating`, `showingQR`, `nobodyScanned`, `claimed`, `receiving`, `stopping`, `summary`, `failed`.

| From | Trigger | To |
|---|---|---|
| idle | `startAsking()` | creating, then showingQR (or failed) |
| showingQR | `session.claimed` | claimed |
| showingQR | `session.expired`, or countdown at zero plus a status check | nobodyScanned |
| nobodyScanned | `tryAgain()` | creating (a fresh session) |
| claimed | first `photo.ready` | receiving |
| claimed, receiving | Stop confirmed | stopping, then summary |
| receiving | `window.closed` | summary |
| summary | done | idle (clears the token) |
| any | snapshot | resynced |

**RequesterSessionStore** owns the state: `startAsking`, `tryAgain`, `stopReceiving`, `finishAndReset`, `restore`, `handleEvent`, `applySnapshot`. On `startAsking` it also asks for notification permission and registers the push token. The countdown is display only: at zero with no event the app asks the server before showing "Nobody scanned".

**Screens**: Home (shell), QR, Claimed, Receiving (with PhotoGrid and the Stop sheet), Summary, in-app Gallery. Stop is available on Claimed and Receiving at all times.

**Stop behavior**: revoke the session. Cancel downloads still in progress. Downloads that already completed finish saving. Photos not yet downloaded are discarded (the server deletes them from R2).

**ReceivingViewModel.processPhoto**, one photo at a time:
1. Check `PhotoLedger`. Already saved? Skip to step 7.
2. `getDownloadUrl`.
3. `DownloadService.download` to a temp file.
4. `DownloadService.verify` (the image must decode).
5. `PhotoSaver.save`, or `LocalGalleryStore.add` if access is denied.
6. `PhotoLedger.markSaved`.
7. `acknowledge`, then `markAcknowledged`. A failure retries and never saves twice.
8. Update the list and count.

Failures in steps 2 to 5 leave the photo pending on the server so the next catch-up fetches it again. `syncPending()` runs on connect using `listPending`. Remove deletes the saved photo from the camera roll and the list; it stays available on each photo while the Receiving screen is showing (no timer).

**Services**: `DownloadService` (`download`, `verify`, `cancelAll`), `PhotoSaver` (Photos framework / MediaStore: `permissionStatus`, `requestPermission`, `save`, `delete`, `openPhotosApp`), `PhotoLedger` (local record: `status`, `markSaved`, `markAcknowledged`, `unacknowledged`, `clear`), `LocalGalleryStore`, `PushRegistrar` (APNs or FCM: `requestPermission`, `currentToken`, `register`, `onTokenRefreshed`).

Platform notes: Android 10 and later saves to the camera roll with no permission, and can delete its own photos without a prompt. iOS needs add-only access to save and full access to delete (with a system confirmation). The denied-permission gallery path is mostly an iOS case.
