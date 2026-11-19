import Foundation
import ImageIO

/// Downloads photo bytes straight from the signed R2 URL (never through the API).
public protocol DownloadServicing: Sendable {
    /// Downloads to a temp file the caller owns. Cancelled with the calling task or `cancelAll()`.
    func download(_ url: URL) async throws -> URL
    /// The file must decode as an image.
    func verify(_ file: URL) -> Bool
    func cancelAll()
}

public struct DownloadFailed: Error, Equatable {
    public let status: Int?
}

public final class DownloadService: DownloadServicing, @unchecked Sendable {
    private let session: URLSession

    public init(timeout: TimeInterval = 60) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = timeout
        config.urlCache = nil
        session = URLSession(configuration: config)
    }

    public func download(_ url: URL) async throws -> URL {
        let (temp, response) = try await session.download(from: url)
        let status = (response as? HTTPURLResponse)?.statusCode
        guard status == 200 else {
            try? FileManager.default.removeItem(at: temp)
            throw DownloadFailed(status: status)
        }
        // The system deletes `temp` when this call returns; keep our own copy.
        let kept = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).jpg")
        try FileManager.default.moveItem(at: temp, to: kept)
        return kept
    }

    public func verify(_ file: URL) -> Bool {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
            CGImageSourceGetCount(source) > 0
        else { return false }
        return CGImageSourceCreateImageAtIndex(source, 0, nil) != nil
    }

    public func cancelAll() {
        session.getAllTasks { tasks in
            for task in tasks { task.cancel() }
        }
    }
}
