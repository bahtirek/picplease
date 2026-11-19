import Observation
import PicPleaseCore

/// Builds the shared services once. Background work (the relaunch for background URLSession events)
/// calls `forBackgroundWork()` instead of reaching into the UI (docs/mobile/structure.md).
@Observable
final class AppContainer {
    let config: AppConfig
    let tokens: TokenStoring
    let api: ApiClient

    init(config: AppConfig, tokens: TokenStoring) {
        self.config = config
        self.tokens = tokens
        self.api = ApiClient(config: config, tokens: tokens)
    }

    static func live() -> AppContainer {
        AppContainer(config: .make(currentEnvironment), tokens: KeychainTokenStore())
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
