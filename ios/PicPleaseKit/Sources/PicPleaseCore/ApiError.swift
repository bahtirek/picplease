import Foundation

/// What screens react to. Never a raw status number (docs/mobile/core.md).
public enum ApiError: Error, Sendable, Equatable {
    /// No connection, timeout, DNS, TLS and similar transport failures.
    case network
    /// 401 `UNAUTHORIZED`, or no stored token for the role the call needs.
    case unauthorized
    /// 404 `NOT_FOUND` (also a wrong pairing secret).
    case notFound
    /// 409 `ALREADY_CLAIMED`.
    case alreadyClaimed
    /// 409 `SESSION_FINISHED`.
    case sessionFinished
    /// 410 `SESSION_GONE`: revoked, expired or closed.
    case sessionGone
    /// 429 `UPLOAD_LIMIT_REACHED`: the in-flight limit is full.
    case uploadLimitReached
    /// 429 `RATE_LIMITED`, or any other 429.
    case rateLimited
    /// 400 `INVALID_REQUEST`, and other 4xx answers.
    case invalidRequest
    /// 5xx.
    case server
    /// A 2xx body that does not decode.
    case malformed

    /// Maps an error answer. The `code` wins; the status is the fallback when the body has none.
    static func from(status: Int, body: Data) -> ApiError {
        let code = try? JSONDecoder().decode(ErrorBody.self, from: body).code
        switch code {
        case "UNAUTHORIZED": return .unauthorized
        case "NOT_FOUND": return .notFound
        case "ALREADY_CLAIMED": return .alreadyClaimed
        case "SESSION_FINISHED": return .sessionFinished
        case "SESSION_GONE": return .sessionGone
        case "UPLOAD_LIMIT_REACHED": return .uploadLimitReached
        case "RATE_LIMITED": return .rateLimited
        case "INVALID_REQUEST": return .invalidRequest
        case "INTERNAL_ERROR": return .server
        default: break
        }
        switch status {
        case 401: return .unauthorized
        case 404: return .notFound
        case 410: return .sessionGone
        case 429: return .rateLimited
        case 400..<500: return .invalidRequest
        default: return .server
        }
    }
}
