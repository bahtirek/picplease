import Foundation
import PicPleaseCore
import Testing

/// docs/mobile/tests.md, TokenStore (3). Runs against the real Keychain, hosted in the app (host-less tests get errSecMissingEntitlement),
/// each test with its own service name so parallel tests do not collide.
@Suite struct TokenStoreTests {
    let store = KeychainTokenStore(service: "app.picplease.tests.\(UUID().uuidString)")

    @Test func saveThenLoad() throws {
        defer { try? store.clearAll() }
        try store.save("first", for: .requester)
        #expect(store.load(.requester) == "first")
        try store.save("second", for: .requester)
        #expect(store.load(.requester) == "second")
    }

    @Test func rolesStoredSeparately() throws {
        defer { try? store.clearAll() }
        try store.save("req", for: .requester)
        try store.save("help", for: .helper)
        #expect(store.load(.requester) == "req")
        #expect(store.load(.helper) == "help")
        try store.clear(.helper)
        #expect(store.load(.helper) == nil)
        #expect(store.load(.requester) == "req")
    }

    @Test func clearAll() throws {
        try store.save("req", for: .requester)
        try store.save("help", for: .helper)
        try store.clearAll()
        #expect(store.load(.requester) == nil)
        #expect(store.load(.helper) == nil)
        try store.clearAll()
    }
}
