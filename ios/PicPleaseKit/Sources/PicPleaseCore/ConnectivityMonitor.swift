import Foundation
import Network

/// Online or not. Stores and view models depend on this protocol so tests can drive it.
public protocol ConnectivityMonitoring: Sendable {
    var isOnline: Bool { get }
    /// Current value first, then changes once they have held for the debounce time.
    func observe() -> AsyncStream<Bool>
}

/// `NWPathMonitor`. "Online" means the path is satisfied; it does not prove the API is reachable.
public final class ConnectivityMonitor: ConnectivityMonitoring, @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "app.picplease.connectivity")
    private let debounce: Duration
    private let lock = NSLock()
    private var online = true
    private var observers: [UUID: AsyncStream<Bool>.Continuation] = [:]

    public init(debounce: Duration = .milliseconds(500)) {
        self.debounce = debounce
        monitor.pathUpdateHandler = { [weak self] path in
            self?.update(path.status == .satisfied)
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }

    public var isOnline: Bool {
        lock.withLock { online }
    }

    public func observe() -> AsyncStream<Bool> {
        let raw = AsyncStream<Bool> { continuation in
            let id = UUID()
            let current = lock.withLock {
                observers[id] = continuation
                return online
            }
            continuation.yield(current)
            continuation.onTermination = { [weak self] _ in
                self?.lock.withLock { _ = self?.observers.removeValue(forKey: id) }
            }
        }
        return Self.debounced(raw, by: debounce)
    }

    private func update(_ value: Bool) {
        let targets: [AsyncStream<Bool>.Continuation] = lock.withLock {
            guard value != online else { return [] }
            online = value
            return Array(observers.values)
        }
        for target in targets { target.yield(value) }
    }

    /// Passes the first value at once; later values only once no newer value arrived within `interval`,
    /// and only when they differ from the last value passed.
    static func debounced(_ source: AsyncStream<Bool>, by interval: Duration) -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let task = Task {
                let state = DebounceState()
                for await value in source {
                    let generation = await state.next(value)
                    if await state.isFirst() {
                        await state.emit(value, to: continuation)
                        continue
                    }
                    Task {
                        try? await Task.sleep(for: interval)
                        if await state.isCurrent(generation) {
                            await state.emit(value, to: continuation)
                        }
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

private actor DebounceState {
    private var generation = 0
    private var last: Bool?

    func next(_ value: Bool) -> Int {
        generation += 1
        return generation
    }

    func isFirst() -> Bool { last == nil }
    func isCurrent(_ g: Int) -> Bool { g == generation }

    func emit(_ value: Bool, to continuation: AsyncStream<Bool>.Continuation) {
        guard value != last else { return }
        last = value
        continuation.yield(value)
    }
}
