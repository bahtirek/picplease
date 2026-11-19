import PicPleaseCore

/// The API calls the requester side uses. `ApiClient` in the app, a fake in tests.
public protocol RequesterAPI: Sendable {
    func createSession() async throws(ApiError) -> CreatedSession
    func getStatus(_ sessionId: String, as role: Role) async throws(ApiError) -> SessionStatus
    func revokeSession(_ sessionId: String) async throws(ApiError) -> SessionStatus
    func listPending(_ sessionId: String) async throws(ApiError) -> PendingPhotos
    func getDownloadUrl(_ photoId: String) async throws(ApiError) -> DownloadUrl
    func acknowledge(_ photoId: String) async throws(ApiError)
    func registerDevice(_ sessionId: String, platform: DevicePlatform, pushToken: String) async throws(ApiError)
}

extension ApiClient: RequesterAPI {}
