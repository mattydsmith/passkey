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

    // MARK: - Passkey

    public func registerPasskey(deviceName: String? = nil) async throws -> RegisterPasskeyResult {
        struct StartResponse: Decodable {
            let registrationId: String
            let options: ServerCreationOptions
        }
        let start: StartResponse = try await transport.request(
            path: "/passkey/register/start",
            method: .post,
            body: nil
        )
        let credential = try await webauthn.performRegistration(opts: start.options)

        var body: [String: Any] = [
            "registrationId": start.registrationId,
            "credential": credential.asJSONObject(),
        ]
        if let deviceName {
            body["deviceName"] = deviceName
        }
        return try await transport.request(
            path: "/passkey/register/finish",
            method: .post,
            body: AnyJSONObject(body)
        )
    }

    public func signInWithPasskey() async throws -> SignInWithPasskeyResult {
        struct StartResponse: Decodable {
            let signInId: String
            let options: ServerRequestOptions
        }
        let start: StartResponse = try await transport.request(
            path: "/passkey/sign-in/start",
            method: .post,
            body: nil
        )
        let credential = try await webauthn.performSignIn(opts: start.options)

        let body: [String: Any] = [
            "signInId": start.signInId,
            "credential": credential.asJSONObject(),
        ]
        let wire: SignInWithPasskeyWireResponse = try await transport.request(
            path: "/passkey/sign-in/finish",
            method: .post,
            body: AnyJSONObject(body)
        )
        try storage.save(wire.sessionToken)
        return SignInWithPasskeyResult(user: wire.user)
    }

    // MARK: - Management

    public func listSessions() async throws -> ListSessionsResult {
        try await transport.request(path: "/sessions", method: .get, body: nil)
    }

    public func listPasskeys() async throws -> ListPasskeysResult {
        try await transport.request(path: "/passkeys", method: .get, body: nil)
    }

    public func deletePasskey(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(.init(charactersIn: "/+="))) ?? id
        let _: EmptyResponse = try await transport.request(
            path: "/passkeys/\(encoded)",
            method: .delete,
            body: nil
        )
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

/// Encodable wrapper for [String: Any] that uses JSONSerialization to
/// preserve nil-omission behavior. Only allows JSON-compatible values.
struct AnyJSONObject: Encodable {
    let object: [String: Any]

    init(_ object: [String: Any]) {
        self.object = object
    }

    func encode(to encoder: Encoder) throws {
        // Bridge through JSONSerialization to handle [String: Any] which
        // standard Encodable can't.
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        // Re-decode into a generic JSON value tree and re-encode through the
        // standard Encoder so JSONEncoder's keyEncoding / dateEncoding (none
        // configured here) apply consistently.
        let json = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        try AnyJSONValue(value: json).encode(to: encoder)
    }
}

private struct AnyJSONValue: Encodable {
    let value: Any

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let v as String: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as Bool: try container.encode(v)
        case let v as [Any]:
            try container.encode(v.map { AnyJSONValue(value: $0) })
        case let v as [String: Any]:
            try container.encode(v.mapValues { AnyJSONValue(value: $0) })
        case is NSNull:
            try container.encodeNil()
        default:
            throw EncodingError.invalidValue(
                value,
                EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "Unsupported JSON value")
            )
        }
    }
}
