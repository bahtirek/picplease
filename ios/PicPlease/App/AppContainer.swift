import Observation
import PicPleaseCore
import PicPleaseRequester

/// Builds the shared services once. Background work (the relaunch for background URLSession events)
/// calls `forBackgroundWork()` instead of reaching into the UI (docs/mobile/structure.md).
@MainActor
@Observable
final class AppContainer {
    let config: AppConfig
    let tokens: TokenStoring
    let api: ApiClient
    let connectivity: ConnectivityMonitoring
    let push: PushRegistrar
    let ledger: PhotoLedger
    let gallery: LocalGalleryStoring
    let downloads: DownloadServicing
    let saver: PhotoSaving

    init(config: AppConfig, tokens: TokenStoring, connectivity: ConnectivityMonitoring) {
        self.config = config
        self.tokens = tokens
        self.api = ApiClient(config: config, tokens: tokens)
        self.connectivity = connectivity
        self.push = PushRegistrar(api: api)
        self.ledger = .live()
        self.gallery = LocalGalleryStore.live()
        self.downloads = DownloadService()
        self.saver = PhotoSaver()
    }

    /// One live connection per role; the role's store owns it and iterates `events()`.
    func realtime(for role: Role) -> RealtimeClient {
        RealtimeClient(config: config, role: role, tokens: tokens)
    }

    func makeRequesterStore() -> RequesterSessionStore {
        RequesterSessionStore(
            api: api, tokens: tokens, push: push, ledger: ledger,
            realtime: { [unowned self] in self.realtime(for: .requester).events() },
            makeReceiving: { [unowned self] sessionId in
                ReceivingViewModel(
                    sessionId: sessionId, api: api, downloads: downloads, saver: saver, gallery: gallery,
                    ledger: ledger)
            })
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
