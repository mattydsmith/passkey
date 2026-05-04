import Foundation

public struct AuthClient: Sendable {
    private let transport: Transport
    private let storage: any TokenStorage
    private let webauthn: WebAuthn

    /// Production initializer. Uses the default ASAuthorizationController-backed
    /// authentication services provider.
    public init(config: AuthClientConfig) {
        self.init(config: config, provider: DefaultAuthenticationServicesProvider())
    }

    /// Test/advanced initializer. Inject a custom AuthenticationServicesProvider.
    public init(config: AuthClientConfig, provider: any AuthenticationServicesProvider) {
        self.transport = Transport(
            baseURL: config.baseURL,
            session: config.session,
            storage: config.storage
        )
        self.storage = config.storage
        let rpId = config.rpIDOverride ?? config.baseURL.host ?? ""
        self.webauthn = WebAuthn(rpId: rpId, provider: provider)
    }

    // MARK: - Email OTP

    public func startEmailSignIn(email: String) async throws -> StartEmailSignInResult {
        try await transport.request(
            path: "/email/start",
            method: .post,
            body: ["email": email]
        )
    }

    public func verifyEmailOtp(otpId: String, code: String) async throws -> VerifyEmailOtpResult {
        let wire: VerifyEmailOtpWireResponse = try await transport.request(
            path: "/email/verify",
            method: .post,
            body: ["otpId": otpId, "code": code]
        )
        try storage.save(wire.sessionToken)
        return VerifyEmailOtpResult(user: wire.user)
    }

    // MARK: - Session

    public func getCurrentUser() async throws -> GetCurrentUserResult {
        try await transport.request(path: "/me", method: .get, body: nil)
    }

    public func signOut() async throws {
        let _: EmptyResponse = try await transport.request(path: "/sign-out", method: .post, body: nil)
        try storage.clear()
    }
}

/// Wire-only response shape for endpoints that issue a session token. The
/// public result types strip the token (it goes into TokenStorage instead).
struct VerifyEmailOtpWireResponse: Decodable {
    let sessionToken: String
    let user: AuthUser
}

struct SignInWithPasskeyWireResponse: Decodable {
    let sessionToken: String
    let user: AuthUser
}
