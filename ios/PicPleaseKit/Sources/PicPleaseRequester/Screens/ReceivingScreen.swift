import SwiftUI

/// Claimed and Receiving. Stop is available at all times; Remove stays on each photo while this shows.
struct ReceivingScreen: View {
    let model: ReceivingViewModel?
    let waitingForFirst: Bool
    let stopping: Bool
    let stop: () -> Void

    @State private var confirmStop = false

    var body: some View {
        VStack(spacing: 16) {
            if waitingForFirst || model?.photos.isEmpty != false {
                Spacer()
                ProgressView()
                Text(Wording.waitingForPhotos).font(.title3)
                Spacer()
            } else if let model {
                Text(Wording.received(model.savedCount)).font(.headline)
                PhotoGrid(model: model)
                if model.savedToGallery {
                    Text(Wording.savedInApp).font(.footnote).foregroundStyle(.secondary)
                }
                if model.removeFailed {
                    Text(Wording.removeFailed).font(.footnote).foregroundStyle(.red)
                }
            }
            Button(Wording.stop, role: .destructive) { confirmStop = true }
                .buttonStyle(.bordered)
                .disabled(stopping)
        }
        .padding()
        .overlay { if stopping { ProgressView() } }
        .confirmationDialog(Wording.stopQuestion, isPresented: $confirmStop, titleVisibility: .visible) {
            Button(Wording.stop, role: .destructive, action: stop)
            Button(Wording.keepWaiting, role: .cancel) {}
        }
    }
}

struct PhotoGrid: View {
    let model: ReceivingViewModel

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 4)], spacing: 4) {
                ForEach(model.photos.reversed()) { photo in
                    thumbnail(photo)
                        .contextMenu {
                            Button(Wording.remove, systemImage: "trash", role: .destructive) {
                                Task { await model.remove(photo) }
                            }
                        }
                }
            }
        }
    }

    @ViewBuilder
    private func thumbnail(_ photo: ReceivingViewModel.ReceivedPhoto) -> some View {
        Color.secondary.opacity(0.15)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image = photo.thumbnail {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: "photo")
                }
            }
            .clipped()
    }
}
