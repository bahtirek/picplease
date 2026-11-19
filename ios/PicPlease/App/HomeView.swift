import PicPleaseRequester
import SwiftUI

/// Home while idle, the requester flow otherwise. The shell slice adds "Help someone", deep links
/// and push taps (docs/mobile/shell.md).
struct RootView: View {
    let requester: RequesterSessionStore
    let gallery: LocalGalleryStoring

    var body: some View {
        if requester.state == .idle {
            HomeView(ask: { Task { await requester.startAsking() } })
        } else {
            RequesterFlowView(store: requester, gallery: gallery)
        }
    }
}

struct HomeView: View {
    let ask: () -> Void
    @Environment(AppContainer.self) private var container

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Text("PicPlease").font(.largeTitle.bold())
            Spacer()
            Button(action: ask) {
                Text("Ask someone nearby").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            if container.config.environment != .release {
                Text(container.config.environment.rawValue).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding()
    }
}
