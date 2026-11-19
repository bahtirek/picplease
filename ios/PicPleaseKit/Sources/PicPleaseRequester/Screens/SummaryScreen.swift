import SwiftUI

struct SummaryScreen: View {
    let received: Int
    let gallery: LocalGalleryStoring
    let openPhotos: () -> Void
    let done: () -> Void

    @State private var showGallery = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "checkmark.circle.fill").font(.system(size: 56)).foregroundStyle(.green)
            Text(Wording.received(received)).font(.title2.bold())
            Button(Wording.openPhotos, action: openPhotos)
            if !gallery.list().isEmpty {
                Button(Wording.viewInApp) { showGallery = true }
            }
            Spacer()
            Button(Wording.done, action: done).buttonStyle(.borderedProminent)
        }
        .padding()
        .sheet(isPresented: $showGallery) { GalleryScreen(gallery: gallery) }
    }
}

/// In-app gallery for photos kept when photo access is denied. Share lets the user save them anyway.
public struct GalleryScreen: View {
    let gallery: LocalGalleryStoring
    @State private var files: [URL] = []

    public init(gallery: LocalGalleryStoring) {
        self.gallery = gallery
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 4)], spacing: 4) {
                    ForEach(files, id: \.self) { file in
                        let image = UIImage(contentsOfFile: file.path())
                        Color.secondary.opacity(0.15)
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                if let image { Image(uiImage: image).resizable().scaledToFill() }
                            }
                            .clipped()
                            .contextMenu {
                                ShareLink(item: file)
                                Button(Wording.remove, systemImage: "trash", role: .destructive) {
                                    try? gallery.remove(file.lastPathComponent)
                                    files = gallery.list()
                                }
                            }
                    }
                }
            }
            .navigationTitle("Photos")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear { files = gallery.list() }
    }
}
