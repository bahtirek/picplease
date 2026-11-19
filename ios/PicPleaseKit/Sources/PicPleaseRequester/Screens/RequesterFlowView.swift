import PicPleaseCore
import SwiftUI

/// Shows the screen for the requester's state. Home (idle) belongs to the app shell.
public struct RequesterFlowView: View {
    let store: RequesterSessionStore
    let gallery: LocalGalleryStoring

    public init(store: RequesterSessionStore, gallery: LocalGalleryStoring) {
        self.store = store
        self.gallery = gallery
    }

    public var body: some View {
        Group {
            switch store.state {
            case .idle, .creating:
                ProgressView()
            case .showingQR(let qr):
                QRScreen(qr: qr) { Task { await store.cancelAsking() } }
            case .nobodyScanned:
                NobodyScannedScreen(
                    tryAgain: { Task { await store.tryAgain() } },
                    cancel: { store.finishAndReset() })
            case .claimed, .receiving, .stopping:
                ReceivingScreen(
                    model: store.receiving as? ReceivingViewModel,
                    waitingForFirst: store.state == .claimed,
                    stopping: store.state == .stopping,
                    stop: { Task { await store.stopReceiving() } })
            case .summary(let received):
                SummaryScreen(
                    received: received, gallery: gallery,
                    openPhotos: { (store.receiving as? ReceivingViewModel)?.openPhotosApp() },
                    done: { store.finishAndReset() })
            case .failed(let error):
                FailedScreen(
                    message: Wording.message(for: error),
                    tryAgain: { Task { await store.tryAgain() } },
                    cancel: { store.finishAndReset() })
            }
        }
        .animation(.default, value: store.state)
    }
}

/// Strings marked proposed are not in docs/mobile/ui-wording.md yet.
enum Wording {
    static let nobodyScanned = "Nobody scanned"
    static let tryAgain = "Try again"
    static let stopQuestion = "Stop receiving? More pics are on the way."
    static let stop = "Stop"
    static let keepWaiting = "Keep waiting"
    static func received(_ n: Int) -> String { n == 1 ? "1 photo received" : "\(n) photos received" }
    // Proposed
    static let showThisCode = "Ask them to scan this code"
    static let cancel = "Cancel"
    static let waitingForPhotos = "They're taking your photos…"
    static let openPhotos = "Open Photos"
    static let done = "Done"
    static let savedInApp = "Photo access is off, so photos are kept in the app."
    static let viewInApp = "View photos kept in the app"
    static let remove = "Remove"
    static let removeFailed = "Couldn't remove that photo."

    static func message(for error: ApiError) -> String {
        switch error {
        case .network: "No connection. Check your internet and try again."
        case .rateLimited: "Too many tries. Wait a minute and try again."
        default: "Something went wrong. Try again."
        }
    }
}

struct QRScreen: View {
    let qr: QRCode
    let cancel: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Text(Wording.showThisCode).font(.title2.bold()).multilineTextAlignment(.center)
            if let image = UIImage(data: qr.png) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 280)
                    .padding()
                    .background(Color.white, in: .rect(cornerRadius: 16))
                    .accessibilityLabel("QR code")
            }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let left = max(0, Int(qr.expiresAt.timeIntervalSince(context.date)))
                Text(String(format: "%d:%02d", left / 60, left % 60))
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Button(Wording.cancel, role: .cancel, action: cancel)
        }
        .padding()
    }
}

struct NobodyScannedScreen: View {
    let tryAgain: () -> Void
    let cancel: () -> Void

    var body: some View {
        Color.clear
            .alert(Wording.nobodyScanned, isPresented: .constant(true)) {
                Button(Wording.tryAgain, action: tryAgain)
                Button(Wording.cancel, role: .cancel, action: cancel)
            }
    }
}

struct FailedScreen: View {
    let message: String
    let tryAgain: () -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(message).multilineTextAlignment(.center)
            Button(Wording.tryAgain, action: tryAgain).buttonStyle(.borderedProminent)
            Button(Wording.cancel, action: cancel)
        }
        .padding()
    }
}
