import SwiftUI

/// Placeholder until the requester slice adds the Home screen (docs/mobile/requester.md).
struct HomeView: View {
    @Environment(AppContainer.self) private var container

    var body: some View {
        VStack(spacing: 12) {
            Text("PicPlease").font(.largeTitle.bold())
            Text(container.config.environment.rawValue).font(.footnote).foregroundStyle(.secondary)
        }
    }
}
