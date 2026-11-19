import Foundation
import PicPleaseCore
import UIKit
import UserNotifications

/// What the session store needs from push.
public protocol PushRegistering: Sendable {
    /// Asks for notification permission (once) and registers the device token for the session.
    /// Never throws: push is a nice-to-have, the app works without it.
    func registerForSession(_ sessionId: String) async
}

/// APNs. The app delegate forwards `didRegisterForRemoteNotificationsWithDeviceToken` to `tokenReceived`.
@MainActor
public final class PushRegistrar: PushRegistering {
    private let api: RequesterAPI
    private var token: String?
    private var waiters: [CheckedContinuation<String?, Never>] = []
    private var activeSessionId: String?

    public init(api: RequesterAPI) {
        self.api = api
    }

    public nonisolated func registerForSession(_ sessionId: String) async {
        await register(sessionId)
    }

    public func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]))
            ?? false
    }

    /// The APNs token as hex, or nil when registration fails or takes longer than 10 seconds.
    public func currentToken() async -> String? {
        if let token { return token }
        UIApplication.shared.registerForRemoteNotifications()
        return await withCheckedContinuation { continuation in
            waiters.append(continuation)
            Task {
                try? await Task.sleep(for: .seconds(10))
                self.resumeWaiters(with: nil)
            }
        }
    }

    public func register(_ sessionId: String) async {
        activeSessionId = sessionId
        guard await requestPermission(), let token = await currentToken() else { return }
        try? await api.registerDevice(sessionId, platform: .ios, pushToken: token)
    }

    /// Stop sending this session's token after it ends.
    public func sessionEnded() {
        activeSessionId = nil
    }

    // MARK: From the app delegate

    public func tokenReceived(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        let changed = token != nil && token != hex
        token = hex
        resumeWaiters(with: hex)
        if changed { onTokenRefreshed(hex) }
    }

    public func registrationFailed() {
        resumeWaiters(with: nil)
    }

    private func onTokenRefreshed(_ hex: String) {
        guard let sessionId = activeSessionId else { return }
        Task { try? await api.registerDevice(sessionId, platform: .ios, pushToken: hex) }
    }

    private func resumeWaiters(with value: String?) {
        let pending = waiters
        waiters.removeAll()
        for waiter in pending { waiter.resume(returning: value) }
    }
}
