import Foundation

/// Endpoints, timeouts, backoff, grace and fallback limits for one environment.
public struct AppConfig: Sendable, Equatable {
    public enum Environment: String, Sendable, CaseIterable {
        /// Local backend (`npm run start:dev` on port 3000, reachable from the simulator).
        case debug
        /// Not set up yet: no staging server exists. Points at the local backend until it does.
        case staging
        case release
    }

    public let environment: Environment
    /// API base, no trailing slash. REST calls go to `apiBaseURL/<path>`.
    public let apiBaseURL: URL
    /// WebSocket endpoint (`/ws`).
    public let realtimeURL: URL
    /// Host of pairing links (`https://picplease.app/s/{session}?t={secret}`).
    public let linkHost: String
    /// Per-request timeout for API calls.
    public let requestTimeout: TimeInterval
    /// Realtime reconnect backoff: first and largest delay, in seconds.
    public let reconnectMinDelay: TimeInterval
    public let reconnectMaxDelay: TimeInterval
    /// Grace the helper sends with Finish when the app goes to the background.
    public let finishGraceSeconds: Int
    /// Used until the server sends the real limits in the create or claim response.
    public let fallbackLimits: SessionLimits
    /// Client-side image limits (not sent by the server).
    public let maxImageEdgePixels: Int
    public let jpegQuality: Double

    public init(
        environment: Environment,
        apiBaseURL: URL,
        realtimeURL: URL,
        linkHost: String = "picplease.app",
        requestTimeout: TimeInterval = 15,
        reconnectMinDelay: TimeInterval = 1,
        reconnectMaxDelay: TimeInterval = 30,
        finishGraceSeconds: Int = 30,
        fallbackLimits: SessionLimits = .fallback,
        maxImageEdgePixels: Int = 1920,
        jpegQuality: Double = 0.7
    ) {
        self.environment = environment
        self.apiBaseURL = apiBaseURL
        self.realtimeURL = realtimeURL
        self.linkHost = linkHost
        self.requestTimeout = requestTimeout
        self.reconnectMinDelay = reconnectMinDelay
        self.reconnectMaxDelay = reconnectMaxDelay
        self.finishGraceSeconds = finishGraceSeconds
        self.fallbackLimits = fallbackLimits
        self.maxImageEdgePixels = maxImageEdgePixels
        self.jpegQuality = jpegQuality
    }

    public static func make(_ environment: Environment) -> AppConfig {
        switch environment {
        case .debug, .staging:
            AppConfig(
                environment: environment,
                apiBaseURL: URL(string: "http://localhost:3000")!,
                realtimeURL: URL(string: "ws://localhost:3000/ws")!
            )
        case .release:
            AppConfig(
                environment: environment,
                apiBaseURL: URL(string: "https://api.picplease.app")!,
                realtimeURL: URL(string: "wss://api.picplease.app/ws")!
            )
        }
    }
}

extension SessionLimits {
    /// The documented limits: 5 in flight, 5 MB, 600 s upload and download URLs.
    public static let fallback = SessionLimits(
        maxInFlight: 5,
        maxPhotoBytes: 5 * 1024 * 1024,
        uploadUrlTtlSeconds: 600,
        downloadUrlTtlSeconds: 600
    )
}
