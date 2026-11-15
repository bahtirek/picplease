# Mobile: app shell

- **AppContainer**: `build()`, `forBackgroundWork()`, `makeRequesterStore()`, `makeHelperStore()`.
- **App entry** (`PhotoHandoffApp`/`MainActivity`): `onLaunch` (build, restore, show Home), `onOpenLink`, `onPushTap`, `onBackgroundEvents` (iOS only).
- **RootRouter**: `currentRole`, `show(role)`, `screenFor(state)`.
- **Home**: two buttons, "Ask someone nearby" and "Help someone". `HomeViewModel` calls `startAsking()` or `startHelping()`.
- **DeepLinkHandler**: `canHandle(url)` (our domain, `/s/` path), `handle(url)`. While idle it parses and starts the claim. While already helping or asking, it is ignored with a short message.
- **NotificationRouter**: a tap for the current session opens Receiving. A stale session goes Home.
- **SessionRestorer**: `restoreAll`, `restoreRequester`, `restoreHelper`. Each loads the stored session and checks its status. If both roles have a live session, the helper wins.

**Platform settings that fail silently if missing**
- iOS `Info.plist`: usage texts for camera, adding to the photo library and full photo library access. Background task identifiers and the processing mode for the confirm retry. Entitlements: associated domain `applinks:picplease.app`, and push (`aps-environment`).
- Android manifest: permissions for camera, internet, network state and notifications (Android 13 and later). A foreground service declared with the data-sync type (required on Android 14). Verified app links for `/s/*` on `picplease.app`. A backup rule excluding the token store. The messaging service for FCM.
- Hosting side (on the server): `apple-app-site-association` and `assetlinks.json` under `/.well-known/` on `picplease.app`. They need the Apple Team ID and the Android signing fingerprints.
