import Observation
import PicPleaseCore

/// Builds the shared services once. Background work (the relaunch for background URLSession events)
/// calls `forBackgroundWork()` instead of reaching into the UI (docs/mobile/structure.md).
@Observable
final class AppContainer {
    let config: AppConfig
    let tokens: TokenStoring
    let api: ApiClient
    let connectivity: ConnectivityMonitoring

    init(config: AppConfig, tokens: TokenStoring, connectivity: ConnectivityMonitoring) {
        self.config = config
        self.tokens = tokens
        self.api = ApiClient(config: config, tokens: tokens)
        self.connectivity = connectivity
    }

    /// One live connection per role; the role's store owns it and iterates `events()`.
    func realtime(for role: Role) -> RealtimeClient {
        RealtimeClient(config: config, role: role, tokens: tokens)
    }

    static func live() -> AppContainer {
        AppContainer(
            config: .make(currentEnvironment), tokens: KeychainTokenStore(), connectivity: ConnectivityMonitor())
    }

    static func forBackgroundWork() -> AppContainer {
        live()
    }

    /// Debug builds talk to the local backend; release builds to api.picplease.app.
    static var currentEnvironment: AppConfig.Environment {
        #if DEBUG
            .debug
        #else
            .release
        #endif
    }
}
