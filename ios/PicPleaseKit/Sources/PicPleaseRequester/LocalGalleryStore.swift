import Foundation

/// In-app gallery, used when photo access is denied. Files live in Application Support/PicPlease/Gallery
/// (excluded from backup) until the user removes them.
public protocol LocalGalleryStoring: Sendable {
    /// Copies the file in; returns the stored file name.
    func add(_ file: URL, photoId: String) throws -> String
    func url(for fileName: String) -> URL
    func list() -> [URL]
    func remove(_ fileName: String) throws
}

public struct LocalGalleryStore: LocalGalleryStoring {
    private let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public static func live() -> LocalGalleryStore {
        LocalGalleryStore(directory: StoragePaths.appDirectory.appending(path: "Gallery", directoryHint: .isDirectory))
    }

    public func add(_ file: URL, photoId: String) throws -> String {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = "\(photoId).jpg"
        let target = url(for: name)
        try? FileManager.default.removeItem(at: target)
        try FileManager.default.copyItem(at: file, to: target)
        return name
    }

    public func url(for fileName: String) -> URL {
        directory.appending(path: fileName)
    }

    /// Newest first.
    public func list() -> [URL] {
        let files =
            (try? FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.creationDateKey])) ?? []
        func created(_ url: URL) -> Date {
            (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
        }
        return files.filter { $0.pathExtension == "jpg" }.sorted { created($0) > created($1) }
    }

    public func remove(_ fileName: String) throws {
        let target = url(for: fileName)
        if FileManager.default.fileExists(atPath: target.path()) {
            try FileManager.default.removeItem(at: target)
        }
    }
}
