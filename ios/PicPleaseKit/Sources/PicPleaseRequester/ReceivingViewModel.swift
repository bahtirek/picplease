import Foundation
import ImageIO
import Observation
import PicPleaseCore
import UIKit

/// What the session store drives on the receiving side. `ReceivingViewModel` in the app, a fake in tests.
@MainActor
public protocol ReceivingControlling: AnyObject {
    /// A photo is ready on the server (`photo.ready`).
    func photoReady(_ photoId: String)
    /// The pending list from a snapshot or `listPending`.
    func apply(pending: [PendingPhoto])
    /// Fetches the pending list with `listPending` and queues it.
    func syncPending() async
    /// Cancels downloads in progress, lets a photo already being saved finish, discards the rest.
    func stop() async
    var savedCount: Int { get }
}

/// Downloads, saves and acknowledges photos one at a time (docs/mobile/requester.md, processPhoto).
@MainActor
@Observable
public final class ReceivingViewModel: ReceivingControlling {
    public struct ReceivedPhoto: Identifiable, Equatable {
        public let id: String
        public let location: SavedLocation
        public let thumbnail: UIImage?

        public static func == (a: Self, b: Self) -> Bool { a.id == b.id && a.location == b.location }
    }

    enum Stage { case idle, downloading, saving }

    public private(set) var photos: [ReceivedPhoto] = []
    public private(set) var savedCount = 0
    /// True once a photo went to the in-app gallery because photo access is denied.
    public private(set) var savedToGallery = false
    public private(set) var removeFailed = false

    public let sessionId: String
    private let api: RequesterAPI
    private let downloads: DownloadServicing
    private let saver: PhotoSaving
    private let gallery: LocalGalleryStoring
    private let ledger: PhotoLedger
    private let sleep: @Sendable (TimeInterval) async throws -> Void
    private let maxAttempts: Int

    private var queue: [String] = []
    private var known: Set<String> = []
    private var worker: Task<Void, Never>?
    private(set) var stage: Stage = .idle
    private var stopRequested = false

    public init(
        sessionId: String,
        api: RequesterAPI,
        downloads: DownloadServicing,
        saver: PhotoSaving,
        gallery: LocalGalleryStoring,
        ledger: PhotoLedger,
        maxAttempts: Int = 3,
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) }
    ) {
        self.sessionId = sessionId
        self.api = api
        self.downloads = downloads
        self.saver = saver
        self.gallery = gallery
        self.ledger = ledger
        self.maxAttempts = maxAttempts
        self.sleep = sleep
    }

    // MARK: ReceivingControlling

    public func photoReady(_ photoId: String) {
        guard !stopRequested, !known.contains(photoId) else { return }
        known.insert(photoId)
        queue.append(photoId)
        if worker == nil {
            worker = Task { await drain() }
        }
    }

    public func apply(pending: [PendingPhoto]) {
        for photo in pending { photoReady(photo.photoId) }
    }

    public func syncPending() async {
        guard let list = try? await api.listPending(sessionId) else { return }
        apply(pending: list.photos)
    }

    public func stop() async {
        stopRequested = true
        if queue.count > 1 { queue.removeSubrange(1...) }
        if stage == .downloading {
            worker?.cancel()
            downloads.cancelAll()
        }
        await worker?.value
    }

    /// Waits until the queue is empty (tests and the summary count).
    func idle() async {
        await worker?.value
    }

    // MARK: Remove

    /// Deletes the saved photo from the camera roll (iOS asks for full access and confirms) or the gallery.
    public func remove(_ photo: ReceivedPhoto) async {
        removeFailed = false
        do {
            switch photo.location {
            case .cameraRoll(let assetId): try await saver.delete(assetId)
            case .gallery(let fileName): try gallery.remove(fileName)
            }
            photos.removeAll { $0.id == photo.id }
        } catch {
            removeFailed = true
        }
    }

    public func openPhotosApp() {
        saver.openPhotosApp()
    }

    // MARK: Processing

    private func drain() async {
        // stop() trims the queue to the photo in progress, so after it the loop ends.
        while let photoId = queue.first {
            await process(photoId)
            stage = .idle
            if !queue.isEmpty { queue.removeFirst() }
            if stopRequested || Task.isCancelled { break }
        }
        queue.removeAll()
        worker = nil
    }

    private func process(_ photoId: String) async {
        if ledger.status(photoId) == .acknowledged { return }
        if ledger.status(photoId) != .saved {
            var attempt = 0
            while true {
                do {
                    try await downloadAndSave(photoId)
                    break
                } catch {
                    if Task.isCancelled || error is CancellationError { return }
                    if case ApiError.notFound = error { return }
                    if case ApiError.sessionGone = error { return }
                    attempt += 1
                    // Leave it pending on the server; the next sync fetches it again.
                    guard attempt < maxAttempts, !stopRequested else {
                        known.remove(photoId)
                        return
                    }
                    do { try await sleep(Double(attempt)) } catch { return }
                }
            }
        }
        await acknowledge(photoId)
        guard let entry = ledger.entry(photoId), !photos.contains(where: { $0.id == photoId }) else { return }
        photos.append(ReceivedPhoto(id: photoId, location: entry.location, thumbnail: pendingThumbnail))
        pendingThumbnail = nil
        savedCount += 1
    }

    private var pendingThumbnail: UIImage?

    private func downloadAndSave(_ photoId: String) async throws {
        stage = .downloading
        let link = try await api.getDownloadUrl(photoId)
        let file = try await downloads.download(link.url)
        defer { try? FileManager.default.removeItem(at: file) }
        try Task.checkCancellation()
        guard downloads.verify(file) else { throw InvalidImage() }

        // From here on Stop lets the photo finish saving.
        stage = .saving
        let location = try await save(file, photoId: photoId)
        try ledger.markSaved(photoId, sessionId: sessionId, location: location)
        pendingThumbnail = Self.thumbnail(of: file)
    }

    private func save(_ file: URL, photoId: String) async throws -> SavedLocation {
        var permission = saver.permissionStatus()
        if permission == .notDetermined {
            permission = await saver.requestPermission()
        }
        if permission == .granted {
            return .cameraRoll(assetId: try await saver.save(file))
        }
        let name = try gallery.add(file, photoId: photoId)
        savedToGallery = true
        return .gallery(fileName: name)
    }

    /// Retries a failed acknowledge without saving again; a photo still unacknowledged after the last
    /// attempt stays `saved` in the ledger and is acknowledged when the server lists it again.
    private func acknowledge(_ photoId: String) async {
        for attempt in 1...maxAttempts {
            do {
                try await api.acknowledge(photoId)
                try? ledger.markAcknowledged(photoId)
                return
            } catch .notFound {
                try? ledger.markAcknowledged(photoId)
                return
            } catch {
                if attempt == maxAttempts { return }
                try? await sleep(Double(attempt))
            }
        }
    }

    struct InvalidImage: Error {}

    private static func thumbnail(of file: URL) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 400,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}
