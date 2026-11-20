# Mobile: decisions

| Decision | Value |
|---|---|
| Platforms | Native iOS (Swift, SwiftUI) and native Android (Kotlin, Jetpack Compose). Reason: reliable background upload. React Native was rejected. |
| Build order | One platform first, then port. iOS first (owner decision, 2026-11-18), because its background limits are tighter. |
| Architecture | MVVM. Each screen has a view and a view model. Both platforms use the same logical file names, so this brief describes both. |
| App identifier | `app.picplease` on both platforms (owner decision, 2026-11-18; hard to change after publishing). iOS test bundle `app.picplease.tests`. |
| Domains | Links `https://picplease.app/s/{session}#{secret}` (secret in the fragment, owner decision 2026-11-19). API and WebSocket `https://api.picplease.app`. |
| API client | Hand-written `ApiClient` and hand-written Codable models that mirror backend/openapi.json (owner decision, 2026-11-18: no generator). |
| Live connection | Plain WebSocket, no Socket.IO |
| Offline | No connection, no help: the helper's shutter is disabled offline. Uploads already handed to the OS survive drops. |
| Downloads | The requester downloads only while the app is open. A push brings them back. No background downloads in v1. |
| Remove (iOS) | Add-only photo access at the first save. Full access is requested the first time Remove is tapped. |
| iOS force-quit | Accepted: swiping the app away on iOS cancels background uploads. No warning text. |
| Limits | 5 in flight, 1920 pixel longest edge, JPEG quality 0.7, 5 MB maximum. The server sends the real limits in the create and claim responses. |
| Minimum OS versions | iOS 17 (owner decision, 2026-11-18). Android not decided. |
| iOS project | `ios/PicPlease.xcodeproj` (thin app target `PicPlease` + app-hosted test target `PicPleaseTests`, folder-synced groups) and the local Swift package `ios/PicPleaseKit` (library `PicPleaseCore`; requester and helper targets later). No third-party dependencies; ask before adding one. Swift 6 language mode, Swift Testing, Xcode 26. Formatting with the swift-format bundled in Xcode (`ios/.swift-format`). iPhone only, portrait. |
| iOS environments | Debug builds use the local backend (`http://localhost:3000`, `ws://localhost:3000/ws`); release uses api.picplease.app. Staging has no server yet and points at local. |
