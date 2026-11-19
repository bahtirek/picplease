import Foundation

@testable import PicPleaseCore

/// Answers every request with the next scripted result and records what was sent.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    enum Reply {
        case json(Int, String)
        case failure(Error)
    }

    private let lock = NSLock()
    private var replies: [Reply]
    private(set) var requests: [URLRequest] = []

    init(_ replies: Reply...) {
        self.replies = replies
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let reply: Reply = lock.withLock {
            requests.append(request)
            return replies.removeFirst()
        }
        switch reply {
        case .failure(let error):
            throw error
        case .json(let status, let body):
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"])!
            return (Data(body.utf8), response)
        }
    }

    var lastRequest: URLRequest? { lock.withLock { requests.last } }
}

final class InMemoryTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [Role: String] = [:]

    init(_ tokens: [Role: String] = [:]) {
        self.tokens = tokens
    }

    func save(_ token: String, for role: Role) { lock.withLock { tokens[role] = token } }
    func load(_ role: Role) -> String? { lock.withLock { tokens[role] } }
    func clear(_ role: Role) { lock.withLock { tokens[role] = nil } }
    func clearAll() { lock.withLock { tokens.removeAll() } }
}
