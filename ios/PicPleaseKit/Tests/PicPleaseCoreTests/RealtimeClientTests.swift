import Foundation
import Testing

@testable import PicPleaseCore

/// docs/mobile/tests.md, RealtimeClient (6).
@Suite struct RealtimeClientTests {
    static let sessionId = "0b6f2a4e-5d3c-4c1a-9f0e-1a2b3c4d5e6f"
    static let snapshot = """
        {"type":"snapshot","data":{"role":"requester","session":{"sessionId":"\(sessionId)","state":"claimed",
         "createdAt":"2026-11-18T10:00:00.000Z","expiresAt":"2026-11-18T10:05:00.000Z",
         "claimedAt":"2026-11-18T10:01:00.000Z","finishedAt":null,"closedAt":null,"revokedAt":null},
         "pendingPhotos":[{"photoId":"p1","sizeBytes":1000,"uploadedAt":"2026-11-18T10:02:00.000Z"}]}}
        """

    let tokens = InMemoryTokenStore([.requester: "req.token"])
    let sleeper = RecordingSleeper()

    func client(_ connector: FakeConnector, heartbeat: Duration? = nil) -> RealtimeClient {
        RealtimeClient(
            config: .make(.debug), role: .requester, tokens: tokens, connector: connector,
            heartbeatInterval: heartbeat, sleep: { [sleeper] in try await sleeper.sleep($0) }, jitter: { 1 })
    }

    @Test func tokenSentFirst() async throws {
        let conn = FakeConnection()
        let connector = FakeConnector([conn])
        var events = client(connector).events().makeAsyncIterator()
        conn.server(Self.snapshot)

        guard case .message(.snapshot(let snap)) = await events.next() else {
            Issue.record("expected snapshot")
            return
        }
        #expect(snap.pendingPhotos?.first?.photoId == "p1")
        let first = try #require(conn.sent.first)
        let auth = try JSONSerialization.jsonObject(with: Data(first.utf8)) as? [String: String]
        #expect(auth == ["type": "auth", "token": "req.token"])
        #expect(connector.urls.first == URL(string: "ws://localhost:3000/ws"))
    }

    @Test func reconnectWithGrowingDelay() async {
        let drops = (0..<6).map { _ in FakeConnection() }
        for drop in drops { drop.serverClose(1006) }
        let connector = FakeConnector(drops)
        let stream = client(connector).events()
        var disconnects = 0
        for await event in stream where event == .disconnected {
            disconnects += 1
            if disconnects == 6 { break }
        }
        #expect(sleeper.delays.prefix(6) == [1, 2, 4, 8, 16, 30])
    }

    @Test func noReconnectAfterSessionGoneClose() async {
        let conn = FakeConnection()
        conn.serverClose(4410)
        let connector = FakeConnector([conn])
        var received: [RealtimeEvent] = []
        for await event in client(connector).events() { received.append(event) }
        #expect(received == [.sessionGone])
        #expect(connector.connectCount == 1)
        #expect(sleeper.delays.isEmpty)
    }

    @Test func missedHeartbeatReconnects() async {
        let silent = FakeConnection(pingFails: true)
        let next = FakeConnection()
        let connector = FakeConnector([silent, next])
        var events = client(connector, heartbeat: .milliseconds(10)).events().makeAsyncIterator()

        #expect(await events.next() == .disconnected)
        #expect(silent.pings >= 1)
        #expect(await eventually { connector.connectCount == 2 })
        #expect(await eventually { next.sent.count == 1 })
    }

    @Test func unknownMessagesIgnored() async {
        let conn = FakeConnection()
        let connector = FakeConnector([conn])
        var events = client(connector).events().makeAsyncIterator()
        conn.server(#"{"type":"something.new","data":{"x":1}}"#)
        conn.server("not json")
        conn.server(#"{"type":"photo.ready","data":{}}"#)
        conn.server(#"{"type":"photo.ready","data":{"sessionId":"s","photoId":"p9"}}"#)

        #expect(await events.next() == .message(.photoReady(photoId: "p9")))
    }

    @Test func snapshotAfterEveryReconnect() async {
        let first = FakeConnection()
        let second = FakeConnection()
        let connector = FakeConnector([first, second])
        var events = client(connector).events().makeAsyncIterator()

        first.server(Self.snapshot)
        guard case .message(.snapshot) = await events.next() else {
            Issue.record("first snapshot")
            return
        }
        first.serverClose(1001)
        #expect(await events.next() == .disconnected)

        second.server(Self.snapshot)
        guard case .message(.snapshot) = await events.next() else {
            Issue.record("second snapshot")
            return
        }
        #expect(second.sent.count == 1)

        // A snapshot resets the backoff: the next drop waits the first delay again.
        second.serverClose(1001)
        #expect(await events.next() == .disconnected)
        #expect(await eventually { sleeper.delays == [1, 1] })
    }

    // Extra

    @Test func noTokenEndsWithSessionGone() async {
        let connector = FakeConnector([])
        let realtime = RealtimeClient(
            config: .make(.debug), role: .helper, tokens: tokens, connector: connector, heartbeatInterval: nil)
        var received: [RealtimeEvent] = []
        for await event in realtime.events() { received.append(event) }
        #expect(received == [.sessionGone])
        #expect(connector.connectCount == 0)
    }

    @Test func jitterScalesDelay() async {
        let conn = FakeConnection()
        conn.serverClose(1006)
        let realtime = RealtimeClient(
            config: .make(.debug), role: .requester, tokens: tokens, connector: FakeConnector([conn]),
            heartbeatInterval: nil, sleep: { [sleeper] in try await sleeper.sleep($0) }, jitter: { 0.5 })
        var events = realtime.events().makeAsyncIterator()
        #expect(await events.next() == .disconnected)
        #expect(await eventually { sleeper.delays == [0.5] })
    }
}

@Suite struct WireEventsTests {
    @Test func decodesTheSevenTypes() {
        #expect(WireEvent.decode(#"{"type":"session.claimed","data":{"sessionId":"s"}}"#) == .sessionClaimed)
        #expect(WireEvent.decode(#"{"type":"session.expired","data":{"sessionId":"s"}}"#) == .sessionExpired)
        #expect(WireEvent.decode(#"{"type":"session.ended","data":{"sessionId":"s"}}"#) == .sessionEnded)
        #expect(WireEvent.decode(#"{"type":"session.finished","data":{"sessionId":"s"}}"#) == .sessionFinished)
        #expect(
            WireEvent.decode(#"{"type":"window.closed","data":{"sessionId":"s","delivered":3}}"#)
                == .windowClosed(delivered: 3))
        #expect(
            WireEvent.decode(#"{"type":"photo.ready","data":{"sessionId":"s","photoId":"p"}}"#)
                == .photoReady(photoId: "p"))
        guard case .snapshot(let snap) = WireEvent.decode(RealtimeClientTests.snapshot) else {
            Issue.record("snapshot")
            return
        }
        #expect(snap.role == .requester)
        #expect(snap.session.state == .claimed)
    }

    @Test func helperSnapshotHasNoPendingPhotos() {
        let text = """
            {"type":"snapshot","data":{"role":"helper","session":{"sessionId":"s","state":"finished",
             "createdAt":"2026-11-18T10:00:00Z","expiresAt":"2026-11-18T10:05:00Z","claimedAt":null,
             "finishedAt":null,"closedAt":null,"revokedAt":null}}}
            """
        guard case .snapshot(let snap) = WireEvent.decode(text) else {
            Issue.record("snapshot")
            return
        }
        #expect(snap.pendingPhotos == nil)
        #expect(snap.session.state == .finished)
    }
}
