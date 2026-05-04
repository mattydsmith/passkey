import Foundation
import AuthenticationServices

// MARK: - Wire types (decoded from server JSON)

struct ServerCreationOptions: Decodable {
    struct RP: Decodable { let id: String?; let name: String }
    struct User: Decodable { let id: String; let name: String; let displayName: String }
    struct PubKeyCredParam: Decodable { let type: String; let alg: Int }
    struct Credential: Decodable {
        let type: String
        let id: String
        let transports: [String]?
    }

    let challenge: String
    let rp: RP
    let user: User
    let pubKeyCredParams: [PubKeyCredParam]
    let excludeCredentials: [Credential]?
    let timeout: Int?
}

struct ServerRequestOptions: Decodable {
    struct Credential: Decodable {
        let type: String
        let id: String
        let transports: [String]?
    }

    let challenge: String
    let rpId: String?
    let allowCredentials: [Credential]?
    let userVerification: String?
    let timeout: Int?
}

// MARK: - Wire types (encoded to server JSON)

public struct PublicKeyCredentialJSON: Encodable, Sendable, Equatable {
    public let id: String
    public let rawId: String
    public let type: String
    public let response: Response

    public struct Response: Encodable, Sendable, Equatable {
        public let clientDataJSON: String
        public let attestationObject: String?
        public let authenticatorData: String?
        public let signature: String?
        public let userHandle: String?
    }
}

extension PublicKeyCredentialJSON {
    /// Produce a `[String: Any]` with nil-valued optional fields removed,
    /// suitable for re-encoding via JSONSerialization to match the web client's
    /// "omit-nil" wire shape.
    func asJSONObject() -> [String: Any] {
        var responseDict: [String: Any] = [
            "clientDataJSON": response.clientDataJSON,
        ]
        if let v = response.attestationObject { responseDict["attestationObject"] = v }
        if let v = response.authenticatorData { responseDict["authenticatorData"] = v }
        if let v = response.signature { responseDict["signature"] = v }
        if let v = response.userHandle { responseDict["userHandle"] = v }
        return [
            "id": id,
            "rawId": rawId,
            "type": type,
            "response": responseDict,
        ]
    }
}

// MARK: - Ceremony orchestrators

struct WebAuthn {
    let rpId: String
    let provider: any AuthenticationServicesProvider

    func performRegistration(opts: ServerCreationOptions) async throws -> PublicKeyCredentialJSON {
        guard let challenge = Data(base64URLEncoded: opts.challenge),
              let userId = Data(base64URLEncoded: opts.user.id) else {
            throw AuthClientError(
                code: .passkeyFailed,
                rawCode: "passkey_failed",
                message: "Server creation options had invalid base64url",
                status: nil,
                underlying: nil
            )
        }

        let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
            .createCredentialRegistrationRequest(challenge: challenge, name: opts.user.name, userID: userId)

        if let exclusions = opts.excludeCredentials, !exclusions.isEmpty {
            request.excludedCredentials = exclusions.compactMap { exclusion in
                guard let id = Data(base64URLEncoded: exclusion.id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: id)
            }
        }

        let authorization: ASAuthorization
        do {
            authorization = try await provider.perform(request)
        } catch {
            throw mapWebAuthnError(error)
        }

        guard let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            throw AuthClientError(
                code: .passkeyFailed,
                rawCode: "passkey_failed",
                message: "Authorization returned an unexpected credential type",
                status: nil,
                underlying: nil
            )
        }

        guard let attestationObject = registration.rawAttestationObject else {
            throw AuthClientError(
                code: .passkeyFailed,
                rawCode: "passkey_failed",
                message: "Registration response missing attestationObject",
                status: nil,
                underlying: nil
            )
        }

        let credentialID = registration.credentialID.base64URLEncodedString()
        return PublicKeyCredentialJSON(
            id: credentialID,
            rawId: credentialID,
            type: "public-key",
            response: .init(
                clientDataJSON: registration.rawClientDataJSON.base64URLEncodedString(),
                attestationObject: attestationObject.base64URLEncodedString(),
                authenticatorData: nil,
                signature: nil,
                userHandle: nil
            )
        )
    }

    func performSignIn(opts: ServerRequestOptions) async throws -> PublicKeyCredentialJSON {
        guard let challenge = Data(base64URLEncoded: opts.challenge) else {
            throw AuthClientError(
                code: .passkeyFailed,
                rawCode: "passkey_failed",
                message: "Server request options had invalid base64url challenge",
                status: nil,
                underlying: nil
            )
        }

        let request = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
            .createCredentialAssertionRequest(challenge: challenge)

        if let allow = opts.allowCredentials, !allow.isEmpty {
            request.allowedCredentials = allow.compactMap { c in
                guard let id = Data(base64URLEncoded: c.id) else { return nil }
                return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: id)
            }
        }

        let authorization: ASAuthorization
        do {
            authorization = try await provider.perform(request)
        } catch {
            throw mapWebAuthnError(error)
        }

        guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw AuthClientError(
                code: .passkeyFailed,
                rawCode: "passkey_failed",
                message: "Authorization returned an unexpected credential type",
                status: nil,
                underlying: nil
            )
        }

        let credentialID = assertion.credentialID.base64URLEncodedString()
        return PublicKeyCredentialJSON(
            id: credentialID,
            rawId: credentialID,
            type: "public-key",
            response: .init(
                clientDataJSON: assertion.rawClientDataJSON.base64URLEncodedString(),
                attestationObject: nil,
                authenticatorData: assertion.rawAuthenticatorData.base64URLEncodedString(),
                signature: assertion.signature.base64URLEncodedString(),
                userHandle: assertion.userID?.base64URLEncodedString()
            )
        )
    }

    private func mapWebAuthnError(_ error: any Error) -> AuthClientError {
        if let asError = error as? ASAuthorizationError {
            switch asError.code {
            case .canceled:
                return AuthClientError(
                    code: .passkeyCancelled,
                    rawCode: "passkey_cancelled",
                    message: "User cancelled or timed out",
                    status: nil,
                    underlying: error
                )
            default:
                return AuthClientError(
                    code: .passkeyFailed,
                    rawCode: "passkey_failed",
                    message: asError.localizedDescription,
                    status: nil,
                    underlying: error
                )
            }
        }
        if let already = error as? AuthClientError {
            return already
        }
        return AuthClientError(
            code: .passkeyFailed,
            rawCode: "passkey_failed",
            message: error.localizedDescription,
            status: nil,
            underlying: error
        )
    }
}
