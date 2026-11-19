import Foundation

/// Server messages on the WebSocket (docs/backend/protocol-and-events.md). Messages are `{ type, data }`.
public enum WireEvent: Sendable, Equatable {
    /// Sent first after auth and after every reconnect.
    case snapshot(Snapshot)
    /// To the requester: the helper claimed.
    case sessionClaimed
    /// To the requester: a photo was uploaded and confirmed.
    case photoReady(photoId: String)
    /// To the requester: nobody scanned in time.
    case sessionExpired
    /// To the requester: delivery window closed.
    case windowClosed(delivered: Int)
    /// To the helper: the requester stopped.
    case sessionEnded
    /// To the helper: finished by the idle rule or the grace timer.
    case sessionFinished

    public struct Snapshot: Sendable, Equatable, Decodable {
        public let role: Role
        public let session: SessionStatus
        /// Requester only.
        public let pendingPhotos: [PendingPhoto]?
    }

    /// Decodes one text message. Unknown types and malformed data give nil and are ignored.
    public static func decode(_ text: String) -> WireEvent? {
        let data = Data(text.utf8)
        guard let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { return nil }
        let decoder = ApiClient.decoder
        switch envelope.type {
        case "snapshot":
            return (try? decoder.decode(Message<Snapshot>.self, from: data)).map { .snapshot($0.data) }
        case "session.claimed": return .sessionClaimed
        case "photo.ready":
            return (try? decoder.decode(Message<PhotoData>.self, from: data)).map {
                .photoReady(photoId: $0.data.photoId)
            }
        case "session.expired": return .sessionExpired
        case "window.closed":
            return (try? decoder.decode(Message<WindowData>.self, from: data)).map {
                .windowClosed(delivered: $0.data.delivered)
            }
        case "session.ended": return .sessionEnded
        case "session.finished": return .sessionFinished
        default: return nil
        }
    }

    private struct Envelope: Decodable { let type: String }
    private struct Message<T: Decodable>: Decodable { let data: T }
    private struct PhotoData: Decodable { let photoId: String }
    private struct WindowData: Decodable { let delivered: Int }
}
