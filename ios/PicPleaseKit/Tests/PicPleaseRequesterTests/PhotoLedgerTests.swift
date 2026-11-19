import Foundation
import Testing

@testable import PicPleaseRequester

/// docs/mobile/tests.md, PhotoLedger (4).
@Suite struct PhotoLedgerTests {
    let file = tempDirectory().appending(path: "ledger.json")

    @Test func statusAfterMarkSaved() throws {
        let ledger = PhotoLedger(fileURL: file)
        #expect(ledger.status("p1") == nil)
        try ledger.markSaved("p1", sessionId: "s1", location: .cameraRoll(assetId: "a1"))
        #expect(ledger.status("p1") == .saved)
        // Written to disk: a new instance (an app restart after a crash) sees it.
        #expect(PhotoLedger(fileURL: file).entry("p1")?.location == .cameraRoll(assetId: "a1"))
    }

    @Test func unacknowledgedList() throws {
        let ledger = PhotoLedger(fileURL: file)
        try ledger.markSaved("p2", sessionId: "s1", location: .gallery(fileName: "p2.jpg"))
        try ledger.markSaved("p1", sessionId: "s1", location: .cameraRoll(assetId: "a1"))
        try ledger.markSaved("p3", sessionId: "other", location: .cameraRoll(assetId: "a3"))
        try ledger.markAcknowledged("p2")
        #expect(ledger.unacknowledged(sessionId: "s1").map(\.photoId) == ["p1"])
    }

    @Test func markAcknowledged() throws {
        let ledger = PhotoLedger(fileURL: file)
        try ledger.markSaved("p1", sessionId: "s1", location: .cameraRoll(assetId: "a1"))
        try ledger.markAcknowledged("p1")
        #expect(ledger.status("p1") == .acknowledged)
        #expect(PhotoLedger(fileURL: file).status("p1") == .acknowledged)
        // Acknowledging an unknown photo changes nothing.
        try ledger.markAcknowledged("nope")
        #expect(ledger.status("nope") == nil)
    }

    @Test func clear() throws {
        let ledger = PhotoLedger(fileURL: file)
        try ledger.markSaved("p1", sessionId: "s1", location: .cameraRoll(assetId: "a1"))
        try ledger.clear()
        #expect(ledger.status("p1") == nil)
        #expect(PhotoLedger(fileURL: file).status("p1") == nil)
    }
}
