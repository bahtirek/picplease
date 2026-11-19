import Foundation

// Mirrors the schemas in backend/openapi.json (hand-written, owner decision).
// Unknown fields in responses are ignored by Decodable.

public enum Role: String, Sendable, CaseIterable, Codable {
    case requester
    case helper
}

public enum SessionState: String, Sendable, Codable, CaseIterable {
    case pending, claimed, finished, revoked, expired, closed
}

public struct SessionLimits: Sendable, Equatable, Codable {
    public let maxInFlight: Int
    public let maxPhotoBytes: Int
    public let uploadUrlTtlSeconds: Int
    public let downloadUrlTtlSeconds: Int

    public init(maxInFlight: Int, maxPhotoBytes: Int, uploadUrlTtlSeconds: Int, downloadUrlTtlSeconds: Int) {
        self.maxInFlight = maxInFlight
        self.maxPhotoBytes = maxPhotoBytes
        self.uploadUrlTtlSeconds = uploadUrlTtlSeconds
        self.downloadUrlTtlSeconds = downloadUrlTtlSeconds
    }
}

/// `POST /sessions`. `requesterToken` is a secret: store it in TokenStore, never log it.
public struct CreatedSession: Sendable, Equatable, Decodable {
    public let sessionId: String
    public let link: URL
    public let qrPngBase64: String
    public let requesterToken: String
    public let expiresAt: Date
    public let limits: SessionLimits
}

/// `POST /sessions/:id/claim`. `helperToken` is a secret.
public struct ClaimedSession: Sendable, Equatable, Decodable {
    public let sessionId: String
    public let helperToken: String
    public let limits: SessionLimits
}

/// Status, revoke, finish and resume responses.
public struct SessionStatus: Sendable, Equatable, Decodable {
    public let sessionId: String
    public let state: SessionState
    public let createdAt: Date
    public let expiresAt: Date
    public let claimedAt: Date?
    public let finishedAt: Date?
    public let closedAt: Date?
    public let revokedAt: Date?
}

public struct PendingPhoto: Sendable, Equatable, Decodable {
    public let photoId: String
    public let sizeBytes: Int
    public let uploadedAt: Date
}

/// `GET /sessions/:id/photos`: oldest first.
public struct PendingPhotos: Sendable, Equatable, Decodable {
    public let state: SessionState
    public let photos: [PendingPhoto]
}

/// `GET /photos/:id/download`: signed GET URL, valid for `downloadUrlTtlSeconds`.
public struct DownloadUrl: Sendable, Equatable, Decodable {
    public let photoId: String
    public let url: URL
    public let expiresAt: Date
}

/// `POST /sessions/:id/photos`: send `headers` with the PUT exactly as given.
public struct UploadTicket: Sendable, Equatable, Decodable {
    public let photoId: String
    public let url: URL
    public let headers: [String: String]
    public let expiresAt: Date
}

public enum DevicePlatform: String, Sendable, Encodable {
    case ios, android
}

/// The `{ code, message }` body every API error carries.
struct ErrorBody: Decodable {
    let code: String
}

// Request bodies
struct ClaimBody: Encodable { let secret: String }
struct FinishBody: Encodable { let graceSeconds: Int? }
struct IssueUploadBody: Encodable { let contentType: String }
struct RegisterDeviceBody: Encodable {
    let platform: DevicePlatform
    let pushToken: String
}
