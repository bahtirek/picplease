import Foundation
import Observation
import PicPleaseCore

/// The requester's screen state (docs/mobile/requester.md). Named `RequesterState` (the brief's
/// `SessionState`) so it does not clash with the server's `PicPleaseCore.SessionState`.
public enum RequesterState: Equatable, Sendable {
    case idle
    case creating
    case showingQR(QRCode)
    case nobodyScanned
    case claimed
    case receiving
    case stopping
    case summary(received: Int)
    case failed(ApiError)
}

public struct QRCode: Equatable, Sendable {
    public let sessionId: String
    public let link: URL
    public let png: Data
    public let expiresAt: Date
}

/// Owns the requester session: create, QR, claim, receiving, stop, summary, restore.
@MainActor
@Observable
public final class RequesterSessionStore {
    public private(set) var state: RequesterState = .idle
    public private(set) var sessionId: String?
    /// The receiving side for the current session; set once a session exists.
    public private(set) var receiving: (any ReceivingControlling)?

    private let api: RequesterAPI
    private let tokens: TokenStoring
    private let push: PushRegistering
    private let ledger: PhotoLedger
    private let realtime: @MainActor () -> AsyncStream<RealtimeEvent>
    private let makeReceiving: @MainActor (String) -> any ReceivingControlling
    private let now: @Sendable () -> Date
    private let sleep: @Sendable (TimeInterval) async throws -> Void

    @ObservationIgnored private var eventsTask: Task<Void, Never>?
    @ObservationIgnored private var countdownTask: Task<Void, Never>?

    /// How often, and how many times, to ask the server again when the countdown hits zero
    /// but the session still reads `pending` (the expiry job may run a moment later).
    static let recheckDelay: TimeInterval = 3
    static let recheckLimit = 5

    public init(
        api: RequesterAPI,
        tokens: TokenStoring,
        push: PushRegistering,
        ledger: PhotoLedger,
        realtime: @escaping @MainActor () -> AsyncStream<RealtimeEvent>,
        makeReceiving: @escaping @MainActor (String) -> any ReceivingControlling,
        now: @escaping @Sendable () -> Date = { Date() },
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }
    ) {
        self.api = api
        self.tokens = tokens
        self.push = push
        self.ledger = ledger
        self.realtime = realtime
        self.makeReceiving = makeReceiving
        self.now = now
        self.sleep = sleep
    }

    // MARK: Actions

    /// Home: "Ask someone nearby".
    public func startAsking() async {
        switch state {
        case .idle, .failed, .nobodyScanned: break
        default: return
        }
        state = .creating
        let created: CreatedSession
        do {
            created = try await api.createSession()
        } catch {
            state = .failed(error)
            return
        }
        do {
            try tokens.save(created.requesterToken, for: .requester)
        } catch {
            state = .failed(.server)
            return
        }
        sessionId = created.sessionId
        receiving = makeReceiving(created.sessionId)
        state = .showingQR(
            QRCode(
                sessionId: created.sessionId, link: created.link,
                png: Data(base64Encoded: created.qrPngBase64) ?? Data(), expiresAt: created.expiresAt))
        connect()
        startCountdown(until: created.expiresAt)
        let push = self.push
        let id = created.sessionId
        Task { await push.registerForSession(id) }
    }

    /// "Nobody scanned" → "Try again": a fresh session.
    public func tryAgain() async {
        endSession()
        receiving = nil
        state = .idle
        await startAsking()
    }

    /// Leaves the QR screen before anyone scanned.
    public func cancelAsking() async {
        guard case .showingQR = state, let sessionId else { return }
        _ = try? await api.revokeSession(sessionId)
        endSession()
        receiving = nil
        state = .idle
    }

    /// Stop sheet confirmed: cancel downloads in progress, let saving finish, revoke (the server
    /// deletes photos not downloaded yet), then the summary.
    public func stopReceiving() async {
        guard state == .claimed || state == .receiving, let sessionId else { return }
        state = .stopping
        await receiving?.stop()
        _ = try? await api.revokeSession(sessionId)
        endSession()
        state = .summary(received: receiving?.savedCount ?? 0)
    }

    /// Summary → Done.
    public func finishAndReset() {
        endSession()
        try? ledger.clear()
        receiving = nil
        sessionId = nil
        state = .idle
    }

    /// On launch: a stored token for a live session resumes receiving; anything else is cleared.
    public func restore() async {
        guard state == .idle, let id = tokens.sessionId(for: .requester) else { return }
        let status: SessionStatus
        do {
            status = try await api.getStatus(id, as: .requester)
        } catch .network {
            return  // Keep the token; the next launch tries again.
        } catch {
            clearStoredSession()
            return
        }
        switch status.state {
        case .claimed, .finished:
            sessionId = id
            receiving = makeReceiving(id)
            state = .claimed
            connect()
        case .pending:
            // The QR cannot be shown again (the link is not stored), so end it.
            _ = try? await api.revokeSession(id)
            clearStoredSession()
        case .expired, .revoked, .closed:
            clearStoredSession()
        }
    }

    // MARK: Events

    public func handleEvent(_ event: RealtimeEvent) async {
        switch event {
        case .message(.snapshot(let snapshot)):
            await applySnapshot(snapshot)
        case .message(.sessionClaimed):
            if case .showingQR = state {
                countdownTask?.cancel()
                state = .claimed
            }
        case .message(.photoReady(let photoId)):
            guard isLive else { return }
            countdownTask?.cancel()
            state = .receiving
            receiving?.photoReady(photoId)
        case .message(.sessionExpired):
            if case .showingQR = state { expire() }
        case .message(.windowClosed):
            if state == .claimed || state == .receiving { await closeWindow() }
        case .message(.sessionEnded), .message(.sessionFinished), .disconnected:
            break
        case .sessionGone:
            if case .showingQR = state {
                expire()
            } else if state == .claimed || state == .receiving {
                await closeWindow()
            }
        }
    }

    public func applySnapshot(_ snapshot: WireEvent.Snapshot) async {
        guard isLive else { return }
        let pending = snapshot.pendingPhotos ?? []
        switch snapshot.session.state {
        case .pending:
            break
        case .claimed, .finished:
            countdownTask?.cancel()
            if state != .receiving {
                state = pending.isEmpty ? .claimed : .receiving
            }
            receiving?.apply(pending: pending)
        case .expired:
            if case .showingQR = state { expire() } else { await closeWindow() }
        case .revoked, .closed:
            await closeWindow()
        }
    }

    // MARK: Private

    private var isLive: Bool {
        switch state {
        case .showingQR, .claimed, .receiving: true
        default: false
        }
    }

    private func connect() {
        eventsTask?.cancel()
        let stream = realtime()
        eventsTask = Task { [weak self] in
            for await event in stream {
                guard let self, !Task.isCancelled else { return }
                await self.handleEvent(event)
            }
        }
    }

    private func startCountdown(until expiresAt: Date) {
        countdownTask?.cancel()
        let wait = max(0, expiresAt.timeIntervalSince(now()))
        let sleep = self.sleep
        countdownTask = Task { [weak self] in
            do { try await sleep(wait) } catch { return }
            await self?.countdownReachedZero()
        }
    }

    /// The countdown is display only: at zero, ask the server before showing "Nobody scanned".
    private func countdownReachedZero() async {
        for check in 0...Self.recheckLimit {
            guard case .showingQR = state, let sessionId, !Task.isCancelled else { return }
            let status = try? await api.getStatus(sessionId, as: .requester)
            guard case .showingQR = state else { return }
            switch status?.state {
            case .claimed, .finished:
                state = .claimed
                return
            case .expired, .revoked, .closed:
                expire()
                return
            case .pending, nil:
                if check == Self.recheckLimit {
                    expire()
                    return
                }
                do { try await sleep(Self.recheckDelay) } catch { return }
            }
        }
    }

    private func expire() {
        endSession()
        receiving = nil
        state = .nobodyScanned
    }

    private func closeWindow() async {
        await receiving?.stop()
        endSession()
        state = .summary(received: receiving?.savedCount ?? 0)
    }

    /// Stops the connection and countdown and forgets the token.
    private func endSession() {
        eventsTask?.cancel()
        eventsTask = nil
        countdownTask?.cancel()
        countdownTask = nil
        try? tokens.clear(.requester)
    }

    private func clearStoredSession() {
        try? tokens.clear(.requester)
        try? ledger.clear()
    }
}
