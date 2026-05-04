import Foundation

public struct AuthClientConfig: Sendable {
    public var baseURL: URL
    public var session: URLSession
    public var storage: any TokenStorage
    public var rpIDOverride: String?

    /// Production initializer. Defaults to KeychainStorage for token persistence
    /// and URLSession.shared for HTTP.
    public init(
        baseURL: URL,
        session: URLSession = .shared,
        keychainService: String = "PasskeySDK",
        keychainAccount: String = "session-token",
        rpIDOverride: String? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.storage = KeychainStorage(service: keychainService, account: keychainAccount)
        self.rpIDOverride = rpIDOverride
    }

    /// Test/advanced initializer. Lets the caller inject a storage implementation
    /// (e.g. InMemoryTokenStorage) without going through the Keychain.
    public init(
        baseURL: URL,
        session: URLSession,
        storage: any TokenStorage,
        rpIDOverride: String? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.storage = storage
        self.rpIDOverride = rpIDOverride
    }
}
