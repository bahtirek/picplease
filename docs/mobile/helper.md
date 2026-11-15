# Mobile: helper flow

**States**: `idle`, `scanning`, `claiming`, `shooting`, `wrappingUp`, `done`, `codeProblem`, `ended`, `cameraDenied`. A deep link goes from idle straight to `claiming`.

**HelperSessionStore**: `startHelping`, `claim(link)` (from a scan or a deep link: claims, saves the token, starts the connection and uploads), `finishTapped`, `enterBackground`, `enterForeground`, `doneTapped`, `resetToHome`, `restore`, `handleEvent` (`session.ended`, `session.finished`), `applySnapshot`.

**Screens**: Scan, Camera (with UploadBadge, OfflineBanner, SendingToast, BufferFullAlert), Wrap-up, Done, Code used or invalid, Session ended (a modal), Camera denied. No "paired" screen: scanning goes straight to the camera.

**Camera rules**
- Offline: the shutter is blocked and the banner shows.
- 5 uploads in flight: the buffer alert shows and the shutter is disabled. This is worked out on the device from the local queue, with no backend call. It dismisses itself when a slot frees. The Finish link stays available.
- Live shots only. No picking from the gallery.
- Flash and a front-camera switch are not in the spec (undecided).

**Compression** (`ImageCompressor`): bake in orientation, resize so the longest edge is at most 1920 (never upscale), encode JPEG at quality 0.7, strip all metadata including location. Runs off the main thread.

**Upload pipeline** (one photo):
1. Shutter tapped: online? slot free?
2. Capture a live shot.
3. Compress, and in parallel request the upload URL (`issueUploadUrl`, signed for the 5 MB maximum).
4. Save the job to disk (`UploadQueue.enqueue`, `UploadJobStore.insert`).
5. Hand to the OS with the exact signed headers (`BackgroundUploader.start`).
6. The OS uploads. The app may be in the background.
7. Confirm (`confirmUpload`, safe to repeat).
8. Clean up: delete the file, free the slot.

Job statuses: `queued`, `uploading`, `uploaded`, `done`, `failed`, `discarded`. A limit-reached answer keeps the job queued. An expired or rejected URL gets a new one, up to 3 times, then the job is `failed`. `SESSION_GONE` discards all jobs and shows the Session ended modal. `SESSION_FINISHED` moves to Wrap-up. `recover()` runs after a relaunch: it confirms jobs that finished uploading and re-issues URLs for queued ones.

**UploadCoordinator**: `start`, `pump`, `issueAndHandOff`, `onUploadFinished`, `confirm`, `recover`, `handleSessionEnded`, `stop` (in-flight uploads keep running). **UploadQueue**: `enqueue`, `nextQueued`, `inFlightCount` (counted locally), `hasFreeSlot`, `observeCounts`, `awaitingUrlCount`, `discardAll`. **UploadJobStore**: `insert`, `update`, `find`, `findByStatus`, `delete`, `loadAll`.

**Platform upload**
- iOS: a background `URLSession` uploading from a file. Files: `BackgroundUploader.swift` (session, `start`, `cancel`, `resumePending`), `SessionDelegate.swift` (completion goes to the coordinator, calls the system handler), `AppDelegate.swift` (keeps the background-session handler), `RetryTask.swift` (BGTaskScheduler retry for unconfirmed jobs). Confirm runs in the short relaunch window.
- Android: WorkManager chains `UploadWorker` (PUT the file with the signed headers) then `ConfirmWorker` (confirm, retry with backoff), both requiring a network. `BackgroundUploader.kt` enqueues the chain. `UploadNotification.kt` supplies the foreground notification Android may require.
- Known limit: swiping the app away on iOS (or Force stop on Android) cancels background transfers. The jobs and files stay on disk, and `recover()` resumes at the next open.

**Three ways a helper's session finishes**
- A. The helper taps Finish: wait up to 10 seconds until every captured photo has its URL, then `requestFinish` with no grace, then Wrap-up. Uploads keep draining.
- B. The app goes to the background (`LifecycleWatcher`): send `requestFinish(30)` once. iOS runs it inside a short background task, Android is best effort. If the helper returns in under 30 seconds, `resume()` cancels it and they stay on the camera. If they return later, the snapshot says finished and the app lands on Wrap-up.
- C. The server finishes after 2 idle minutes: the app receives `session.finished` (or sees it in the snapshot) and moves to Wrap-up.

Photos still queued without a URL when a session finishes are discarded.
