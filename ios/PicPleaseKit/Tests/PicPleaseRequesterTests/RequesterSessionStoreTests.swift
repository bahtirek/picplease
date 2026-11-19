import Foundation
import Testing

@testable import PicPleaseCore
@testable import PicPleaseRequester

/// docs/mobile/tests.md, Requester store (11).
@MainActor
@Suite struct RequesterSessionStoreTests {
    let log = EventLog()
    let api: FakeRequesterAPI
    let tokens = InMemoryTokenStore()
    let gate = SleepGate()
    let ledger = PhotoLedger(fileURL: tempDirectory().appending(path: "ledger.json"))
    let realtime = AsyncStream<RealtimeEvent>.makeStream()
    let receivingBox = ReceivingBox()

    @MainActor final class ReceivingBox {
        var made: [String: FakeReceiving] = [:]
    }

    init() {
        api = FakeRequesterAPI(log: log)
    }

    func makeStore() -> RequesterSessionStore {
        let stream = realtime.stream
        let box = receivingBox
        return RequesterSessionStore(
            api: api, tokens: tokens, push: FakePush(log: log), ledger: ledger,
            realtime: { stream },
            makeReceiving: { id in
                let fake = FakeReceiving()
                box.made[id] = fake
                return fake
            },
            now: { Samples.date }, sleep: { [gate] in try await gate.sleep($0) })
    }

    func showingQR(_ id: String = "s1") async -> RequesterSessionStore {
        api.queueCreate(.success(Samples.created(id)))
        let store = makeStore()
        await store.startAsking()
        return store
    }

    @Test func createToShowingQR() async throws {
        let store = await showingQR()
        guard case .showingQR(let qr) = store.state else {
            Issue.record("state \(store.state)")
            return
        }
        #expect(qr.sessionId == "s1")
        #expect(qr.png == Data("png".utf8))
        #expect(tokens.load(.requester) == "s1.random")
        #expect(await eventually { gate.requested == [300] })  // countdown to expiresAt
        #expect(await eventually { log.items.contains("push s1") })
    }

    @Test func failedCreate() async {
        api.queueCreate(.failure(.rateLimited))
        let store = makeStore()
        await store.startAsking()
        #expect(store.state == .failed(.rateLimited))
        #expect(tokens.load(.requester) == nil)
    }

    @Test func claimEvent() async {
        let store = await showingQR()
        await store.handleEvent(.message(.sessionClaimed))
        #expect(store.state == .claimed)
    }

    @Test func firstPhotoToReceiving() async {
        let store = await showingQR()
        await store.handleEvent(.message(.sessionClaimed))
        await store.handleEvent(.message(.photoReady(photoId: "p1")))
        #expect(store.state == .receiving)
        #expect(receivingBox.made["s1"]?.ready == ["p1"])
    }

    @Test func expiryShowsNobodyScanned() async {
        let store = await showingQR()
        await store.handleEvent(.message(.sessionExpired))
        #expect(store.state == .nobodyScanned)
        #expect(tokens.load(.requester) == nil)
    }

    @Test func countdownAtZeroTriggersStatusCheck() async {
        let store = await showingQR()
        api.statusResult = .success(Samples.status("s1", .expired))
        #expect(await eventually { gate.waiting == 1 })
        gate.fire()
        #expect(await eventually { store.state == .nobodyScanned })
        #expect(log.items.contains("status s1"))
    }

    @Test func tryAgainMakesFreshSession() async {
        let store = await showingQR("s1")
        await store.handleEvent(.message(.sessionExpired))
        api.queueCreate(.success(Samples.created("s2")))
        await store.tryAgain()
        guard case .showingQR(let qr) = store.state else {
            Issue.record("state \(store.state)")
            return
        }
        #expect(qr.sessionId == "s2")
        #expect(log.count("create") == 2)
        #expect(tokens.load(.requester) == "s2.random")
    }

    @Test func stopToSummaryAndTokenCleared() async {
        let store = await showingQR()
        await store.handleEvent(.message(.photoReady(photoId: "p1")))
        receivingBox.made["s1"]?.savedCount = 4
        await store.stopReceiving()
        #expect(store.state == .summary(received: 4))
        #expect(receivingBox.made["s1"]?.stopped == true)
        #expect(log.items.contains("revoke s1"))
        #expect(tokens.load(.requester) == nil)
    }

    @Test func windowClosedToSummary() async {
        let store = await showingQR()
        await store.handleEvent(.message(.photoReady(photoId: "p1")))
        receivingBox.made["s1"]?.savedCount = 1
        await store.handleEvent(.message(.windowClosed(delivered: 1)))
        #expect(store.state == .summary(received: 1))
        #expect(tokens.load(.requester) == nil)
        store.finishAndReset()
        #expect(store.state == .idle)
    }

    @Test func snapshotResync() async {
        let store = await showingQR()
        // Missed the claim and two photos while disconnected.
        await store.applySnapshot(Samples.snapshot("s1", .claimed, pending: ["p1", "p2"]))
        #expect(store.state == .receiving)
        #expect(receivingBox.made["s1"]?.applied == [["p1", "p2"]])

        let quiet = await showingQR("s2")
        await quiet.applySnapshot(Samples.snapshot("s2", .claimed))
        #expect(quiet.state == .claimed)
    }

    @Test func restoreWithGoneTokenReturnsToIdle() async throws {
        tokens.save("s1.random", for: .requester)
        try ledger.markSaved("p1", sessionId: "s1", location: .cameraRoll(assetId: "a1"))
        api.statusResult = .failure(.unauthorized)
        let store = makeStore()
        await store.restore()
        #expect(store.state == .idle)
        #expect(tokens.load(.requester) == nil)
        #expect(ledger.status("p1") == nil)

        // A live one resumes receiving and listens for the snapshot.
        tokens.save("s3.random", for: .requester)
        api.statusResult = .success(Samples.status("s3", .claimed))
        await store.restore()
        #expect(store.state == .claimed)
        realtime.continuation.yield(.message(.snapshot(Samples.snapshot("s3", .claimed, pending: ["p7"]))))
        #expect(await eventually { store.state == .receiving })
    }
}
