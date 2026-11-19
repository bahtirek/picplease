import Foundation

/// The socket was closed. `code` is the WebSocket close code (4401 bad auth, 4410 session gone).
public struct WebSocketClosed: Error, Equatable {
    public let code: Int
    public init(code: Int) { self.code = code }
}

/// One WebSocket connection. `URLSessionWebSocketConnection` in the app, a fake in tests.
public protocol WebSocketConnection: Sendable {
    func send(_ text: String) async throws
    /// Next text message. Throws `WebSocketClosed` when the socket closes.
    func receive() async throws -> String
    /// Sends a ping and waits for the pong. Throws if none comes in time.
    func ping() async throws
    func close()
}

public protocol WebSocketConnector: Sendable {
    func connect(to url: URL) -> WebSocketConnection
}

/// What the stream gives the stores.
public enum RealtimeEvent: Sendable, Equatable {
    case message(WireEvent)
    /// The connection dropped; a reconnect follows (and a fresh snapshot after it).
    case disconnected
    /// Closed with 4410, or no token stored. The stream ends; do not reconnect.
    case sessionGone
}

/// Plain WebSocket to `/ws`. Sends `{type:"auth", token}` first, reconnects with backoff from 1 to 30 s
/// with jitter, never after close code 4410. Pings to detect a dead connection. Never logs the token.
public struct RealtimeClient: Sendable {
    public static let sessionGoneCloseCode = 4410

    private let url: URL
    private let role: Role
    private let tokens: TokenStoring
    private let connector: WebSocketConnector
    private let minDelay: TimeInterval
    private let maxDelay: TimeInterval
    private let heartbeatInterval: Duration?
    private let sleep: @Sendable (TimeInterval) async throws -> Void
    private let jitter: @Sendable () -> Double

    /// - Parameters:
    ///   - heartbeatInterval: how often to ping; nil turns the client's ping off.
    ///   - jitter: factor applied to each backoff delay; the default spreads it over 50 to 100 %.
    public init(
        config: AppConfig,
        role: Role,
        tokens: TokenStoring,
        connector: WebSocketConnector = URLSessionWebSocketConnector(),
        heartbeatInterval: Duration? = .seconds(25),
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
        jitter: @escaping @Sendable () -> Double = { Double.random(in: 0.5...1.0) }
    ) {
        self.url = config.realtimeURL
        self.role = role
        self.tokens = tokens
        self.connector = connector
        self.minDelay = config.reconnectMinDelay
        self.maxDelay = config.reconnectMaxDelay
        self.heartbeatInterval = heartbeatInterval
        self.sleep = sleep
        self.jitter = jitter
    }

    /// Connects and keeps reconnecting until the consumer stops iterating, the task is cancelled,
    /// or the session is gone.
    public func events() -> AsyncStream<RealtimeEvent> {
        AsyncStream { continuation in
            let task = Task { await run(continuation) }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Delay before reconnect attempt `attempt` (0 based), before jitter: 1, 2, 4 ... capped at 30.
    func backoff(_ attempt: Int) -> TimeInterval {
        min(maxDelay, minDelay * pow(2, Double(min(attempt, 16))))
    }

    private func run(_ out: AsyncStream<RealtimeEvent>.Continuation) async {
        defer { out.finish() }
        var attempt = 0
        while !Task.isCancelled {
            guard let token = tokens.load(role) else {
                out.yield(.sessionGone)
                return
            }
            let connection = connector.connect(to: url)
            let closeCode = await session(connection, token: token, out: out) { attempt = 0 }
            connection.close()
            if Task.isCancelled { return }
            if closeCode == Self.sessionGoneCloseCode {
                out.yield(.sessionGone)
                return
            }
            out.yield(.disconnected)
            let delay = min(maxDelay, backoff(attempt) * jitter())
            attempt += 1
            do { try await sleep(delay) } catch { return }
        }
    }

    /// Runs one connection until it ends. Returns the close code, or nil for any other failure.
    private func session(
        _ connection: WebSocketConnection, token: String, out: AsyncStream<RealtimeEvent>.Continuation,
        onSnapshot: () -> Void
    ) async -> Int? {
        let heartbeat = heartbeatInterval.map { interval in
            Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: interval)
                    if Task.isCancelled { return }
                    do { try await connection.ping() } catch {
                        connection.close()
                        return
                    }
                }
            }
        }
        defer { heartbeat?.cancel() }

        do {
            let auth = try JSONSerialization.data(withJSONObject: ["type": "auth", "token": token])
            try await connection.send(String(decoding: auth, as: UTF8.self))
            while !Task.isCancelled {
                let text = try await connection.receive()
                guard let event = WireEvent.decode(text) else { continue }
                if case .snapshot = event { onSnapshot() }
                out.yield(.message(event))
            }
            return nil
        } catch let closed as WebSocketClosed {
            return closed.code
        } catch {
            return nil
        }
    }
}

// MARK: URLSession

public struct URLSessionWebSocketConnector: WebSocketConnector {
    private let session: URLSession
    private let pingTimeout: TimeInterval

    public init(session: URLSession = .shared, pingTimeout: TimeInterval = 10) {
        self.session = session
        self.pingTimeout = pingTimeout
    }

    public func connect(to url: URL) -> WebSocketConnection {
        URLSessionWebSocketConnection(task: session.webSocketTask(with: url), pingTimeout: pingTimeout)
    }
}

final class URLSessionWebSocketConnection: WebSocketConnection, @unchecked Sendable {
    private let task: URLSessionWebSocketTask
    private let pingTimeout: TimeInterval

    init(task: URLSessionWebSocketTask, pingTimeout: TimeInterval) {
        self.task = task
        self.pingTimeout = pingTimeout
        task.resume()
    }

    func send(_ text: String) async throws {
        do { try await task.send(.string(text)) } catch { throw closedError() }
    }

    func receive() async throws -> String {
        while true {
            let message: URLSessionWebSocketTask.Message
            do { message = try await task.receive() } catch { throw closedError() }
            if case .string(let text) = message { return text }
        }
    }

    func ping() async throws {
        let task = self.task
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
                    task.sendPing { error in
                        if let error { done.resume(throwing: error) } else { done.resume() }
                    }
                }
            }
            group.addTask { [pingTimeout] in
                try await Task.sleep(for: .seconds(pingTimeout))
                throw URLError(.timedOut)
            }
            try await group.next()
            group.cancelAll()
        }
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }

    /// The server's close code survives in `closeCode` (checked: 4410 comes through as 4410).
    private func closedError() -> Error {
        WebSocketClosed(code: task.closeCode.rawValue)
    }
}
