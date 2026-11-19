import PicPleaseRequester
import SwiftUI
import UIKit

@main
struct PicPleaseApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate
    @State private var container: AppContainer
    @State private var requester: RequesterSessionStore

    init() {
        let container = AppContainer.live()
        _container = State(initialValue: container)
        _requester = State(initialValue: container.makeRequesterStore())
    }

    var body: some Scene {
        WindowGroup {
            RootView(requester: requester, gallery: container.gallery)
                .environment(container)
                .onAppear { delegate.push = container.push }
                .task { await requester.restore() }
        }
    }
}

/// Forwards the APNs device token to PushRegistrar.
final class AppDelegate: NSObject, UIApplicationDelegate {
    var push: PushRegistrar?

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        push?.tokenReceived(token)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        push?.registrationFailed()
    }
}
