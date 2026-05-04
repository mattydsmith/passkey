import Foundation
import Security

public protocol TokenStorage: Sendable {
    func load() throws -> String?
    func save(_ token: String) throws
    func clear() throws
    func attach(to request: inout URLRequest) throws
}

public extension TokenStorage {
    func attach(to request: inout URLRequest) throws {
        if let token = try load() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }
}

/// In-memory storage used by tests. Not for production.
public final class InMemoryTokenStorage: TokenStorage, @unchecked Sendable {
    private var token: String?
    private let lock = NSLock()

    public init() {}

    public func load() throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return token
    }

    public func save(_ token: String) throws {
        lock.lock(); defer { lock.unlock() }
        self.token = token
    }

    public func clear() throws {
        lock.lock(); defer { lock.unlock() }
        token = nil
    }
}

/// Production storage backed by the Keychain. One generic-password entry per
/// (service, account) pair. Not exercised in unit tests — verified manually
/// via the demo app, since headless XCTest hosts have unreliable Keychain access.
public struct KeychainStorage: TokenStorage {
    public let service: String
    public let account: String

    public init(service: String, account: String) {
        self.service = service
        self.account = account
    }

    public func load() throws -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data,
                  let token = String(data: data, encoding: .utf8) else {
                return nil
            }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError(status: status)
        }
    }

    public func save(_ token: String) throws {
        let data = Data(token.utf8)
        var query = baseQuery()
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        // Try update first; fall back to add if not present.
        let updateStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound { throw KeychainError(status: updateStatus) }

        var addQuery = query
        for (k, v) in attrs { addQuery[k] = v }
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus != errSecSuccess { throw KeychainError(status: addStatus) }
    }

    public func clear() throws {
        let query = baseQuery()
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { return }
        throw KeychainError(status: status)
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

public struct KeychainError: Error, CustomStringConvertible {
    public let status: OSStatus

    public var description: String {
        let msg = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error"
        return "\(msg) (\(status))"
    }
}
