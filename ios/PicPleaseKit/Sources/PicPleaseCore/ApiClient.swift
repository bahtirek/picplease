import Foundation

/// Sends one HTTP request. `URLSessionTransport` in the app, a fake in tests.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// Hand-written client for the PicPlease API (docs/backend/api-contract.md).
/// Never retries on its own. Picks the token by role on each call; never logs tokens.
/// Photo bytes never go through here: upload and download use the signed R2 URLs.
public struct ApiClient: Sendable {
    private let baseURL: URL
    private let timeout: TimeInterval
    private let transport: HTTPTransport
    private let tokens: TokenStoring

    public init(config: AppConfig, transport: HTTPTransport = URLSessionTransport(), tokens: TokenStoring) {
        self.baseURL = config.apiBaseURL
        self.timeout = config.requestTimeout
        self.transport = transport
        self.tokens = tokens
    }

    // MARK: Requester

    public func createSession() async throws(ApiError) -> CreatedSession {
        try await call("POST", "sessions", auth: nil)
    }

    public func revokeSession(_ sessionId: String) async throws(ApiError) -> SessionStatus {
        try await call("POST", "sessions", sessionId, "revoke", auth: .requester)
    }

    public func listPending(_ sessionId: String) async throws(ApiError) -> PendingPhotos {
        try await call("GET", "sessions", sessionId, "photos", auth: .requester)
    }

    public func getDownloadUrl(_ photoId: String) async throws(ApiError) -> DownloadUrl {
        try await call("GET", "photos", photoId, "download", auth: .requester)
    }

    /// Safe to repeat. `SESSION_GONE` counts as success (the window closed after the photo was saved).
    public func acknowledge(_ photoId: String) async throws(ApiError) {
        do {
            let _: Empty = try await call("POST", "photos", photoId, "ack", auth: .requester)
        } catch .sessionGone {
            return
        }
    }

    public func registerDevice(_ sessionId: String, platform: DevicePlatform = .ios, pushToken: String)
        async throws(ApiError)
    {
        let _: Empty = try await call(
            "POST", "sessions", sessionId, "device", auth: .requester,
            body: RegisterDeviceBody(platform: platform, pushToken: pushToken))
    }

    // MARK: Either role

    public func getStatus(_ sessionId: String, as role: Role) async throws(ApiError) -> SessionStatus {
        try await call("GET", "sessions", sessionId, auth: role)
    }

    // MARK: Helper

    /// No token. Not retried automatically: a retry after a lost answer would read `ALREADY_CLAIMED`.
    public func claimSession(_ sessionId: String, secret: String) async throws(ApiError) -> ClaimedSession {
        try await call("POST", "sessions", sessionId, "claim", auth: nil, body: ClaimBody(secret: secret))
    }

    public func issueUploadUrl(_ sessionId: String) async throws(ApiError) -> UploadTicket {
        try await call(
            "POST", "sessions", sessionId, "photos", auth: .helper,
            body: IssueUploadBody(contentType: "image/jpeg"))
    }

    /// Safe to repeat.
    public func confirmUpload(_ photoId: String) async throws(ApiError) {
        let _: Empty = try await call("POST", "photos", photoId, "confirm", auth: .helper)
    }

    /// No grace finishes now; the server caps grace at 30 seconds.
    public func requestFinish(_ sessionId: String, graceSeconds: Int? = nil) async throws(ApiError) -> SessionStatus {
        try await call(
            "POST", "sessions", sessionId, "finish", auth: .helper,
            body: FinishBody(graceSeconds: graceSeconds))
    }

    public func resume(_ sessionId: String) async throws(ApiError) -> SessionStatus {
        try await call("POST", "sessions", sessionId, "resume", auth: .helper)
    }

    // MARK: Plumbing

    private struct Empty: Decodable {}
    private struct NoBody: Encodable {}

    private func call<Response: Decodable>(
        _ method: String, _ segments: String..., auth: Role?
    ) async throws(ApiError) -> Response {
        try await send(method, segments, auth: auth, body: NoBody?.none)
    }

    private func call<Response: Decodable, Body: Encodable>(
        _ method: String, _ segments: String..., auth: Role?, body: Body
    ) async throws(ApiError) -> Response {
        try await send(method, segments, auth: auth, body: body)
    }

    private func send<Response: Decodable, Body: Encodable>(
        _ method: String, _ segments: [String], auth: Role?, body: Body?
    ) async throws(ApiError) -> Response {
        var url = baseURL
        for segment in segments {
            url.append(path: segment, directoryHint: .notDirectory)
        }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let auth {
            guard let token = tokens.load(auth) else { throw .unauthorized }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONEncoder().encode(body)
        }

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw .network
        }

        guard (200..<300).contains(response.statusCode) else {
            throw ApiError.from(status: response.statusCode, body: data)
        }
        if Response.self == Empty.self {
            return Empty() as! Response
        }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            throw .malformed
        }
    }

    /// ISO 8601 dates, with or without fractional seconds (the server sends milliseconds).
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(
                text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true))
            {
                return date
            }
            if let date = try? Date(text, strategy: .iso8601) {
                return date
            }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date"))
        }
        return decoder
    }()
}
