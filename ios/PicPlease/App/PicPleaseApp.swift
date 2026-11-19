import SwiftUI

@main
struct PicPleaseApp: App {
    @State private var container = AppContainer.live()

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environment(container)
        }
    }
}
