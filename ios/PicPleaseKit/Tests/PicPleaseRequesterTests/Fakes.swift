import Foundation

@testable import PicPleaseCore
@testable import PicPleaseRequester

// MARK: Shared log (order checks)

final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var _items: [String] = []
    var items: [String] { lock.withLock { _items } }
    func add(_ item: String) { lock.withLock { _items.append(item) } }
    func count(_ prefix: String) -> Int { items.filter { $0.hasPrefix(prefix) }.count }
}

// MARK: API

final class FakeRequesterAPI: RequesterAPI, @unchecked Sendable {
    let log: EventLog
    private let lock = NSLock()
    private var createResults: [Result<CreatedSession, ApiError>] = []
    var statusResult: Result<SessionStatus, ApiError> = .failure(.network)
    var pendingResult: Result<PendingPhotos, ApiError> = .success(PendingPhotos(state: .claimed, photos: []))
    /// Failures handed out before the call succeeds, per call name.
    private var failures: [String: [ApiError]] = [:]

    init(log: EventLog = EventLog()) { self.log = log }

    func queueCreate(_ results: Result<CreatedSession, ApiError>...) { lock.withLock { createResults += results } }
    func fail(_ call: String, with errors: ApiError...) { lock.withLock { failures[call, default: []] += errors } }

    private func check(_ call: String) throws(ApiError) {
        let error: ApiError? = lock.withLock {
            guard var list = failures[call], !list.isEmpty else { return nil }
            let first = list.removeFirst()
            failures[call] = list
            return first
        }
        if let error { throw error }
    }

    func createSession() async throws(ApiError) -> CreatedSession {
        log.add("create")
        let next = lock.withLock { createResults.isEmpty ? nil : createResults.removeFirst() }
        guard let next else { throw .server }
        return try next.get()
    }

    func getStatus(_ sessionId: String, as role: Role) async throws(ApiError) -> SessionStatus {
        log.add("status \(sessionId)")
        return try lock.withLock { statusResult }.get()
    }

    func revokeSession(_ sessionId: String) async throws(ApiError) -> SessionStatus {
        log.add("revoke \(sessionId)")
        return Samples.status(sessionId, .revoked)
    }

    func listPending(_ sessionId: String) async throws(ApiError) -> PendingPhotos {
        log.add("list \(sessionId)")
        return try lock.withLock { pendingResult }.get()
    }

    func getDownloadUrl(_ photoId: String) async throws(ApiError) -> DownloadUrl {
        log.add("url \(photoId)")
        try check("url")
        return DownloadUrl(photoId: photoId, url: URL(string: "https://r2.test/\(photoId)")!, expiresAt: .now)
    }

    func acknowledge(_ photoId: String) async throws(ApiError) {
        log.add("ack \(photoId)")
        try check("ack")
    }

    func registerDevice(_ sessionId: String, platform: DevicePlatform, pushToken: String) async throws(ApiError) {
        log.add("device \(sessionId)")
    }
}

enum Samples {
    static let date = Date(timeIntervalSince1970: 1_794_996_600)

    static func created(_ id: String, expiresIn: TimeInterval = 300) -> CreatedSession {
        CreatedSession(
            sessionId: id, link: URL(string: "https://picplease.app/s/\(id)?t=secret")!,
            qrPngBase64: Data("png".utf8).base64EncodedString(), requesterToken: "\(id).random",
            expiresAt: date.addingTimeInterval(expiresIn), limits: .fallback)
    }

    static func status(_ id: String, _ state: SessionState) -> SessionStatus {
        SessionStatus(
            sessionId: id, state: state, createdAt: date, expiresAt: date, claimedAt: nil, finishedAt: nil,
            closedAt: nil, revokedAt: nil)
    }

    static func snapshot(_ id: String, _ state: SessionState, pending: [String] = []) -> WireEvent.Snapshot {
        WireEvent.Snapshot(
            role: .requester, session: status(id, state),
            pendingPhotos: pending.map { PendingPhoto(photoId: $0, sizeBytes: 100, uploadedAt: date) })
    }
}

// MARK: Tokens, push

final class InMemoryTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [Role: String] = [:]
    init(_ tokens: [Role: String] = [:]) { self.tokens = tokens }
    func save(_ token: String, for role: Role) { lock.withLock { tokens[role] = token } }
    func load(_ role: Role) -> String? { lock.withLock { tokens[role] } }
    func clear(_ role: Role) { lock.withLock { tokens[role] = nil } }
    func clearAll() { lock.withLock { tokens.removeAll() } }
}

final class FakePush: PushRegistering, @unchecked Sendable {
    let log: EventLog
    init(log: EventLog) { self.log = log }
    func registerForSession(_ sessionId: String) async { log.add("push \(sessionId)") }
}

// MARK: Receiving (for store tests)

@MainActor
final class FakeReceiving: ReceivingControlling {
    var ready: [String] = []
    var applied: [[String]] = []
    var stopped = false
    var savedCount = 0

    func photoReady(_ photoId: String) { ready.append(photoId) }
    func apply(pending: [PendingPhoto]) { applied.append(pending.map(\.photoId)) }
    func syncPending() async {}
    func stop() async { stopped = true }
}

// MARK: Sleep gate

/// `sleep` suspends until the test calls `fire()`; cancellation ends the wait.
final class SleepGate: @unchecked Sendable {
    private let lock = NSLock()
    private var waiters: [UUID: CheckedContinuation<Void, Error>] = [:]
    private var _requested: [TimeInterval] = []
    var requested: [TimeInterval] { lock.withLock { _requested } }
    var waiting: Int { lock.withLock { waiters.count } }

    func sleep(_ seconds: TimeInterval) async throws {
        let id = UUID()
        lock.withLock { _requested.append(seconds) }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.withLock { waiters[id] = continuation }
            }
        } onCancel: {
            let waiter = lock.withLock { waiters.removeValue(forKey: id) }
            waiter?.resume(throwing: CancellationError())
        }
    }

    func fire() {
        let all = lock.withLock {
            let all = Array(waiters.values)
            waiters.removeAll()
            return all
        }
        for waiter in all { waiter.resume() }
    }
}

// MARK: Download, saver

final class FakeDownloads: DownloadServicing, @unchecked Sendable {
    let log: EventLog
    private let lock = NSLock()
    private var failuresLeft: Int
    private var _active = 0
    private var _maxActive = 0
    private var _cancelled = 0
    /// When set, downloads wait on this gate (to test Stop mid-download).
    var gate: SleepGate?
    let directory: URL

    init(log: EventLog, failures: Int = 0, directory: URL) {
        self.log = log
        self.failuresLeft = failures
        self.directory = directory
    }

    var maxActive: Int { lock.withLock { _maxActive } }
    var cancelAllCalls: Int { lock.withLock { _cancelled } }

    func download(_ url: URL) async throws -> URL {
        let id = url.lastPathComponent
        lock.withLock {
            _active += 1
            _maxActive = max(_maxActive, _active)
        }
        defer { lock.withLock { _active -= 1 } }
        log.add("download \(id)")
        if let gate { try await gate.sleep(0) }
        let fail = lock.withLock {
            guard failuresLeft > 0 else { return false }
            failuresLeft -= 1
            return true
        }
        if fail { throw DownloadFailed(status: 500) }
        await Task.yield()
        let file = directory.appending(path: "\(id)-\(UUID().uuidString).jpg")
        try Data("jpeg \(id)".utf8).write(to: file)
        return file
    }

    func verify(_ file: URL) -> Bool { true }
    func cancelAll() { lock.withLock { _cancelled += 1 } }
}

final class FakeSaver: PhotoSaving, @unchecked Sendable {
    let log: EventLog
    private let lock = NSLock()
    private var _permission: PhotoPermission
    var grantOnRequest: Bool
    /// When set, save waits on this gate (to test Stop mid-save).
    var gate: SleepGate?
    private(set) var deleted: [String] = []

    init(log: EventLog, permission: PhotoPermission = .granted, grantOnRequest: Bool = true) {
        self.log = log
        self._permission = permission
        self.grantOnRequest = grantOnRequest
    }

    func permissionStatus() -> PhotoPermission { lock.withLock { _permission } }

    func requestPermission() async -> PhotoPermission {
        log.add("permission")
        return lock.withLock {
            _permission = grantOnRequest ? .granted : .denied
            return _permission
        }
    }

    func save(_ file: URL) async throws -> String {
        let id = file.lastPathComponent.components(separatedBy: "-").first ?? "?"
        log.add("save \(id)")
        if let gate { try? await gate.sleep(0) }
        log.add("saved \(id)")
        return "asset-\(id)"
    }

    func delete(_ assetId: String) async throws {
        log.add("delete \(assetId)")
        lock.withLock { deleted.append(assetId) }
    }

    @MainActor func openPhotosApp() {}
}

// MARK: Helpers

func tempDirectory() -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "picplease-tests-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

@MainActor
func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
    for _ in 0..<400 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return condition()
}
