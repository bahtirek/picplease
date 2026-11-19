import Foundation

@testable import PicPleaseCore

/// A scripted connection: the test pushes server messages or a close; the client's sends are recorded.
final class FakeConnection: WebSocketConnection, @unchecked Sendable {
    private let lock = NSLock()
    private let incoming: AsyncStream<Result<String, WebSocketClosed>>
    private let feed: AsyncStream<Result<String, WebSocketClosed>>.Continuation
    private var _sent: [String] = []
    private var _pings = 0
    private let pingFails: Bool

    init(pingFails: Bool = false) {
        (incoming, feed) = AsyncStream.makeStream()
        self.pingFails = pingFails
    }

    var sent: [String] { lock.withLock { _sent } }
    var pings: Int { lock.withLock { _pings } }

    func server(_ text: String) { feed.yield(.success(text)) }
    func serverClose(_ code: Int) { feed.yield(.failure(WebSocketClosed(code: code))) }

    func send(_ text: String) async throws { lock.withLock { _sent.append(text) } }

    func receive() async throws -> String {
        for await item in incoming {
            return try item.get()
        }
        throw WebSocketClosed(code: 1006)
    }

    func ping() async throws {
        lock.withLock { _pings += 1 }
        if pingFails { throw URLError(.timedOut) }
    }

    /// Like a real socket: once closed, receive fails.
    func close() { feed.finish() }
}

/// Hands out connections in order; waits until the test has queued the next one.
final class FakeConnector: WebSocketConnector, @unchecked Sendable {
    private let lock = NSLock()
    private var queued: [FakeConnection]
    private var _urls: [URL] = []

    init(_ connections: [FakeConnection]) { queued = connections }

    var connectCount: Int { lock.withLock { _urls.count } }
    var urls: [URL] { lock.withLock { _urls } }

    func connect(to url: URL) -> WebSocketConnection {
        lock.withLock {
            _urls.append(url)
            // Past the script: a connection that stays open with no messages.
            return queued.isEmpty ? FakeConnection() : queued.removeFirst()
        }
    }
}

/// Records backoff delays and returns at once.
final class RecordingSleeper: @unchecked Sendable {
    private let lock = NSLock()
    private var _delays: [TimeInterval] = []
    var delays: [TimeInterval] { lock.withLock { _delays } }

    func sleep(_ seconds: TimeInterval) async throws {
        lock.withLock { _delays.append(seconds) }
        await Task.yield()
    }
}

/// Polls until the condition holds (fails the wait after about 2 s).
func eventually(_ condition: () -> Bool) async -> Bool {
    for _ in 0..<400 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
}
