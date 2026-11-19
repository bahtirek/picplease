import Foundation
import Security

/// Bearer tokens per role. Tokens are secrets: never log them.
public protocol TokenStoring: Sendable {
    func save(_ token: String, for role: Role) throws
    func load(_ role: Role) -> String?
    func clear(_ role: Role) throws
    func clearAll() throws
}

public struct KeychainError: Error, Equatable {
    public let status: OSStatus
}

/// Keychain, this device only (no iCloud sync, not in backups restored to another device).
/// Readable after the first unlock so background upload work can use it while the phone is locked.
/// Keychain items survive reinstall: SessionRestorer checks the status on launch and clears stale tokens.
public struct KeychainTokenStore: TokenStoring {
    private let service: String

    public init(service: String = "app.picplease.tokens") {
        self.service = service
    }

    public func save(_ token: String, for role: Role) throws {
        let data = Data(token.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query(role) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query(role)
            add.merge(update) { _, new in new }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func load(_ role: Role) -> String? {
        var q = query(role)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
            let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func clear(_ role: Role) throws {
        try delete(query(role))
    }

    public func clearAll() throws {
        try delete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ])
    }

    private func query(_ role: Role) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: role.rawValue,
            kSecAttrSynchronizable as String: false,
        ]
    }

    private func delete(_ query: [String: Any]) throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}
