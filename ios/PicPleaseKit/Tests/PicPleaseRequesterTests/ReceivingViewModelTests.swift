import Foundation
import Testing

@testable import PicPleaseCore
@testable import PicPleaseRequester

/// docs/mobile/tests.md, ReceivingViewModel (9).
@MainActor
@Suite struct ReceivingViewModelTests {
    let log = EventLog()
    let dir = tempDirectory()
    let api: FakeRequesterAPI
    let downloads: FakeDownloads
    let saver: FakeSaver
    let gallery: LocalGalleryStore
    let ledger: PhotoLedger

    init() {
        api = FakeRequesterAPI(log: log)
        downloads = FakeDownloads(log: log, directory: dir)
        saver = FakeSaver(log: log)
        gallery = LocalGalleryStore(directory: dir.appending(path: "Gallery"))
        ledger = PhotoLedger(fileURL: dir.appending(path: "ledger.json"))
    }

    func model(downloads: FakeDownloads? = nil, saver: FakeSaver? = nil) -> ReceivingViewModel {
        ReceivingViewModel(
            sessionId: "s1", api: api, downloads: downloads ?? self.downloads, saver: saver ?? self.saver,
            gallery: gallery, ledger: ledger, sleep: { _ in await Task.yield() })
    }

    @Test func downloadSaveAcknowledgeInOrder() async {
        let vm = model()
        vm.photoReady("p1")
        await vm.idle()
        #expect(log.items == ["url p1", "download p1", "save p1", "saved p1", "ack p1"])
        #expect(ledger.status("p1") == .acknowledged)
        #expect(vm.photos.map(\.id) == ["p1"])
        #expect(vm.photos.first?.location == .cameraRoll(assetId: "asset-p1"))
        #expect(vm.savedCount == 1)
    }

    @Test func alreadySavedOnlyAcknowledged() async throws {
        try ledger.markSaved("p1", sessionId: "s1", location: .cameraRoll(assetId: "a1"))
        let vm = model()
        vm.apply(pending: [PendingPhoto(photoId: "p1", sizeBytes: 1, uploadedAt: .now)])
        await vm.idle()
        #expect(log.items == ["ack p1"])
        #expect(ledger.status("p1") == .acknowledged)
        #expect(vm.photos.map(\.id) == ["p1"])
    }

    @Test func downloadFailureRetries() async {
        let flaky = FakeDownloads(log: log, failures: 2, directory: dir)
        let vm = model(downloads: flaky)
        vm.photoReady("p1")
        await vm.idle()
        #expect(log.count("download p1") == 3)
        #expect(log.count("save p1") == 1)
        #expect(ledger.status("p1") == .acknowledged)
    }

    @Test func downloadFailingEveryTimeStaysPendingForNextSync() async {
        let broken = FakeDownloads(log: log, failures: 3, directory: dir)
        let vm = model(downloads: broken)
        vm.photoReady("p1")
        await vm.idle()
        #expect(log.count("download p1") == 3)
        #expect(log.count("ack") == 0)
        #expect(ledger.status("p1") == nil)
        // The next catch-up fetches it again.
        vm.photoReady("p1")
        await vm.idle()
        #expect(ledger.status("p1") == .acknowledged)
    }

    @Test func acknowledgeFailureRetriesWithoutSavingTwice() async {
        api.fail("ack", with: .network, .server)
        let vm = model()
        vm.photoReady("p1")
        await vm.idle()
        #expect(log.count("ack p1") == 3)
        #expect(log.count("save p1") == 1)
        #expect(ledger.status("p1") == .acknowledged)

        // All attempts failing: stays saved; the next listing only acknowledges.
        api.fail("ack", with: .network, .network, .network)
        vm.photoReady("p2")
        await vm.idle()
        #expect(ledger.status("p2") == .saved)
        let second = model()
        second.photoReady("p2")
        await second.idle()
        #expect(log.count("save p2") == 1)
        #expect(ledger.status("p2") == .acknowledged)
    }

    @Test func permissionDeniedRoutesToGallery() async {
        let denied = FakeSaver(log: log, permission: .notDetermined, grantOnRequest: false)
        let vm = model(saver: denied)
        vm.photoReady("p1")
        await vm.idle()
        #expect(log.count("permission") == 1)
        #expect(log.count("save") == 0)
        #expect(vm.savedToGallery)
        #expect(vm.photos.first?.location == .gallery(fileName: "p1.jpg"))
        #expect(gallery.list().map(\.lastPathComponent) == ["p1.jpg"])
        #expect(ledger.status("p1") == .acknowledged)
    }

    @Test func oneAtATime() async {
        let vm = model()
        for id in ["p1", "p2", "p3"] { vm.photoReady(id) }
        vm.photoReady("p2")  // duplicate event
        await vm.idle()
        #expect(downloads.maxActive == 1)
        #expect(log.items.filter { $0.hasPrefix("download") } == ["download p1", "download p2", "download p3"])
        #expect(vm.savedCount == 3)
    }

    @Test func removeDeletesFromCameraRollAndList() async throws {
        let vm = model()
        vm.photoReady("p1")
        vm.photoReady("p2")
        await vm.idle()
        let first = try #require(vm.photos.first)
        await vm.remove(first)
        #expect(saver.deleted == ["asset-p1"])
        #expect(vm.photos.map(\.id) == ["p2"])
    }

    @Test func stopCancelsDownloadsLetsSavingFinishAndDiscardsTheRest() async {
        // Mid-save: the photo finishes saving and is acknowledged; queued photos are dropped.
        let saveGate = SleepGate()
        let slowSaver = FakeSaver(log: log)
        slowSaver.gate = saveGate
        let vm = model(saver: slowSaver)
        for id in ["p1", "p2", "p3"] { vm.photoReady(id) }
        #expect(await eventually { saveGate.waiting == 1 })
        let stopping = Task { await vm.stop() }
        await Task.yield()
        saveGate.fire()
        await stopping.value
        #expect(log.count("saved p1") == 1)
        #expect(ledger.status("p1") == .acknowledged)
        #expect(log.count("download p2") == 0)
        #expect(log.count("download p3") == 0)

        // Mid-download: cancelled, nothing saved.
        let downloadGate = SleepGate()
        let slow = FakeDownloads(log: log, directory: dir)
        slow.gate = downloadGate
        let vm2 = model(downloads: slow)
        vm2.photoReady("p9")
        #expect(await eventually { downloadGate.waiting == 1 })
        await vm2.stop()
        #expect(slow.cancelAllCalls == 1)
        #expect(log.count("save p9") == 0)
        #expect(ledger.status("p9") == nil)
        #expect(vm2.savedCount == 0)
    }
}
