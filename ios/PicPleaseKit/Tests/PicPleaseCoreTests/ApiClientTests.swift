import Foundation
import Testing

@testable import PicPleaseCore

/// docs/mobile/tests.md, ApiClient (7).
@Suite struct ApiClientTests {
    let sessionId = "0b6f2a4e-5d3c-4c1a-9f0e-1a2b3c4d5e6f"
    let photoId = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f"
    let tokens = InMemoryTokenStore([.requester: "req.token", .helper: "help.token"])

    func client(_ transport: FakeTransport) -> ApiClient {
        ApiClient(config: .make(.debug), transport: transport, tokens: tokens)
    }

    func error(_ body: String, status: Int) -> FakeTransport.Reply {
        .json(status, body)
    }

    @Test func unauthorized401() async {
        let api = client(FakeTransport(.json(401, #"{"code":"UNAUTHORIZED","message":"Unauthorized"}"#)))
        await #expect(throws: ApiError.unauthorized) { try await api.getStatus(sessionId, as: .requester) }
    }

    @Test func alreadyClaimed409() async {
        let api = client(FakeTransport(.json(409, #"{"code":"ALREADY_CLAIMED","message":"x"}"#)))
        await #expect(throws: ApiError.alreadyClaimed) { try await api.claimSession(sessionId, secret: "s") }
    }

    @Test func gone410() async {
        let api = client(FakeTransport(.json(410, #"{"code":"SESSION_GONE","message":"x"}"#)))
        await #expect(throws: ApiError.sessionGone) { try await api.listPending(sessionId) }
    }

    @Test func uploadLimit429VersusPlain429() async {
        let limited = client(FakeTransport(.json(429, #"{"code":"UPLOAD_LIMIT_REACHED","message":"x"}"#)))
        await #expect(throws: ApiError.uploadLimitReached) { try await limited.issueUploadUrl(sessionId) }

        let rate = client(FakeTransport(.json(429, #"{"code":"RATE_LIMITED","message":"x"}"#)))
        await #expect(throws: ApiError.rateLimited) { try await rate.issueUploadUrl(sessionId) }

        let bare = client(FakeTransport(.json(429, "")))
        await #expect(throws: ApiError.rateLimited) { try await bare.issueUploadUrl(sessionId) }
    }

    @Test func rightRolesTokenAttached() async throws {
        let status = """
            {"sessionId":"\(sessionId)","state":"claimed","createdAt":"2026-11-18T10:00:00.000Z",
             "expiresAt":"2026-11-18T10:10:00.000Z","claimedAt":"2026-11-18T10:01:00.000Z",
             "finishedAt":null,"closedAt":null,"revokedAt":null}
            """
        let transport = FakeTransport(
            .json(200, status), .json(200, status), .json(200, #"{"photoId":"\#(photoId)","status":"uploaded"}"#),
            .json(200, "{}"))
        let api = client(transport)

        _ = try await api.revokeSession(sessionId)
        #expect(transport.requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer req.token")

        _ = try await api.getStatus(sessionId, as: .helper)
        #expect(transport.requests[1].value(forHTTPHeaderField: "Authorization") == "Bearer help.token")

        try await api.confirmUpload(photoId)
        #expect(transport.requests[2].value(forHTTPHeaderField: "Authorization") == "Bearer help.token")
        #expect(transport.requests[2].url?.path() == "/photos/\(photoId)/confirm")

        _ = try? await api.claimSession(sessionId, secret: "s")
        #expect(transport.requests[3].value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func timeoutBecomesNetworkError() async {
        let api = client(FakeTransport(.failure(URLError(.timedOut))))
        await #expect(throws: ApiError.network) { try await api.createSession() }
    }

    @Test func unknownResponseFieldsIgnored() async throws {
        let body = """
            {"sessionId":"\(sessionId)","link":"https://picplease.app/s/\(sessionId)?t=abc",
             "qrPngBase64":"iVBORw0=","requesterToken":"tok","expiresAt":"2026-11-18T10:10:00.000Z",
             "limits":{"maxInFlight":5,"maxPhotoBytes":5242880,"uploadUrlTtlSeconds":600,
                       "downloadUrlTtlSeconds":600,"somethingNew":1},
             "anotherNewField":{"nested":true}}
            """
        let created = try await client(FakeTransport(.json(200, body))).createSession()
        #expect(created.sessionId == sessionId)
        #expect(created.limits == .fallback)
        #expect(created.expiresAt == Date(timeIntervalSince1970: 1_794_996_600))
    }

    // Extra: behaviour the core brief names alongside the calls.

    @Test func acknowledgeTreatsSessionGoneAsSuccess() async throws {
        let api = client(FakeTransport(.json(410, #"{"code":"SESSION_GONE","message":"x"}"#)))
        try await api.acknowledge(photoId)
    }

    @Test func missingTokenFailsWithoutSending() async {
        let transport = FakeTransport()
        let api = ApiClient(config: .make(.debug), transport: transport, tokens: InMemoryTokenStore())
        await #expect(throws: ApiError.unauthorized) { try await api.listPending(sessionId) }
        #expect(transport.requests.isEmpty)
    }

    @Test func finishSendsGraceAndDeviceAccepts204() async throws {
        let status = """
            {"sessionId":"\(sessionId)","state":"claimed","createdAt":"2026-11-18T10:00:00Z",
             "expiresAt":"2026-11-18T10:10:00Z","claimedAt":null,"finishedAt":null,"closedAt":null,"revokedAt":null}
            """
        let transport = FakeTransport(.json(200, status), .json(204, ""))
        let api = client(transport)

        _ = try await api.requestFinish(sessionId, graceSeconds: 30)
        let body = try #require(transport.requests[0].httpBody)
        #expect(String(decoding: body, as: UTF8.self) == #"{"graceSeconds":30}"#)

        try await api.registerDevice(sessionId, pushToken: "abc123")
        #expect(transport.requests[1].url?.path() == "/sessions/\(sessionId)/device")
    }
}
