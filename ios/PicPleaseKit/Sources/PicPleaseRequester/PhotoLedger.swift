import Foundation

/// Where a received photo was saved.
public enum SavedLocation: Codable, Sendable, Equatable {
    /// Photos library asset (`PHAsset.localIdentifier`).
    case cameraRoll(assetId: String)
    /// In-app gallery file name (photo access denied).
    case gallery(fileName: String)
}

/// Local record of received photos, written to disk on every change so a crash between saving and
/// acknowledging never saves the same photo twice (docs/mobile/requester.md, step 1 and 6).
public final class PhotoLedger: @unchecked Sendable {
    public enum Status: String, Codable, Sendable {
        case saved
        case acknowledged
    }

    public struct Entry: Codable, Sendable, Equatable {
        public let photoId: String
        public let sessionId: String
        public var status: Status
        public let location: SavedLocation
    }

    private let fileURL: URL
    private let lock = NSLock()
    private var entries: [String: Entry]

    /// - Parameter fileURL: JSON file; created on first write.
    public init(fileURL: URL) {
        self.fileURL = fileURL
        if let data = try? Data(contentsOf: fileURL),
            let stored = try? JSONDecoder().decode([String: Entry].self, from: data)
        {
            entries = stored
        } else {
            entries = [:]
        }
    }

    /// Application Support/PicPlease/photo-ledger.json, excluded from backup.
    public static func live() -> PhotoLedger {
        PhotoLedger(fileURL: StoragePaths.appDirectory.appending(path: "photo-ledger.json"))
    }

    public func status(_ photoId: String) -> Status? {
        lock.withLock { entries[photoId]?.status }
    }

    public func entry(_ photoId: String) -> Entry? {
        lock.withLock { entries[photoId] }
    }

    public func markSaved(_ photoId: String, sessionId: String, location: SavedLocation) throws {
        try mutate {
            $0[photoId] = Entry(photoId: photoId, sessionId: sessionId, status: .saved, location: location)
        }
    }

    public func markAcknowledged(_ photoId: String) throws {
        try mutate { $0[photoId]?.status = .acknowledged }
    }

    /// Saved but not yet acknowledged, for one session.
    public func unacknowledged(sessionId: String) -> [Entry] {
        lock.withLock {
            entries.values.filter { $0.sessionId == sessionId && $0.status == .saved }.sorted {
                $0.photoId < $1.photoId
            }
        }
    }

    public func clear() throws {
        try mutate { $0.removeAll() }
    }

    private func mutate(_ change: (inout [String: Entry]) -> Void) throws {
        try lock.withLock {
            var next = entries
            change(&next)
            let data = try JSONEncoder().encode(next)
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            entries = next
        }
    }
}

enum StoragePaths {
    /// Application Support/PicPlease, excluded from iCloud backup.
    static var appDirectory: URL {
        var url = URL.applicationSupportDirectory.appending(path: "PicPlease", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }
}
