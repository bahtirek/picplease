# Mobile: structure

```
app/            App entry, AppContainer, RootRouter, Home, DeepLinkHandler,
                NotificationRouter, SessionRestorer
core/           ApiClient, ApiModels (generated), ApiError, RealtimeClient,
                WireEvents, TokenStore, AppConfig, ConnectivityMonitor
requester/      RequesterSessionStore, SessionState, RequesterRouter, screens,
                view models, DownloadService, PhotoSaver, PhotoLedger,
                LocalGalleryStore, PushRegistrar
helper/         HelperSessionStore, HelperState, HelperRouter, screens,
                view models, CameraController, ImageCompressor, QRScanner,
                SessionLinkParser, LifecycleWatcher, upload pipeline
```

Rule: background code (Android workers, the iOS relaunch for background sessions) builds `ApiClient`, `TokenStore` and `UploadJobStore` from `AppContainer.forBackgroundWork()`. Nothing in `core/` may reference a view or view model.
