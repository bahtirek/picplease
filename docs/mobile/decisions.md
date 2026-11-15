# Mobile: decisions

| Decision | Value |
|---|---|
| Platforms | Native iOS (Swift, SwiftUI) and native Android (Kotlin, Jetpack Compose). Reason: reliable background upload. React Native was rejected. |
| Build order | One platform first, then port. iOS first is recommended because its background limits are tighter. (Your choice pending.) |
| Architecture | MVVM. Each screen has a view and a view model. Both platforms use the same logical file names, so this brief describes both. |
| App identifier | `app.picplease.mobile` on both platforms (proposed, hard to change after publishing) |
| Domains | Links `https://picplease.app/s/{session}?t={secret}`. API and WebSocket `https://api.picplease.app`. |
| API client | Hand-written `ApiClient` over generated models from the backend's OpenAPI description |
| Live connection | Plain WebSocket, no Socket.IO |
| Offline | No connection, no help: the helper's shutter is disabled offline. Uploads already handed to the OS survive drops. |
| Downloads | The requester downloads only while the app is open. A push brings them back. No background downloads in v1. |
| Remove (iOS) | Add-only photo access at the first save. Full access is requested the first time Remove is tapped. |
| iOS force-quit | Accepted: swiping the app away on iOS cancels background uploads. No warning text. |
| Limits | 5 in flight, 1920 pixel longest edge, JPEG quality 0.7, 5 MB maximum. The server sends the real limits in the create and claim responses. |
| Minimum OS versions | Not decided |
