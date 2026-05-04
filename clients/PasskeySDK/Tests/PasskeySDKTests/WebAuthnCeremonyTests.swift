import XCTest
import AuthenticationServices
@testable import PasskeySDK

final class WebAuthnCeremonyTests: XCTestCase {
    func testServerCreationOptionsDecodes() throws {
        let opts = try Fixtures.decodedCreationOptions()
        XCTAssertEqual(opts.challenge, "Y2g")
        XCTAssertEqual(opts.rp.id, "example.com")
        XCTAssertEqual(opts.user.id, "dV8x")
    }

    func testServerRequestOptionsDecodes() throws {
        let opts = try Fixtures.decodedRequestOptions()
        XCTAssertEqual(opts.challenge, "Y2g")
        XCTAssertEqual(opts.rpId, "example.com")
        XCTAssertEqual(opts.allowCredentials?.count, 0)
    }

    func testPublicKeyCredentialJSONShape() throws {
        let credential = PublicKeyCredentialJSON(
            id: "abc",
            rawId: "abc",
            type: "public-key",
            response: .init(
                clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
                attestationObject: "Y2JvciBhdHRlc3RhdGlvbg",
                authenticatorData: nil,
                signature: nil,
                userHandle: nil
            )
        )
        let json = try JSONEncoder().encode(credential)
        let dict = try JSONSerialization.jsonObject(with: json) as! [String: Any]
        XCTAssertEqual(dict["id"] as? String, "abc")
        XCTAssertEqual(dict["rawId"] as? String, "abc")
        XCTAssertEqual(dict["type"] as? String, "public-key")
        let response = dict["response"] as! [String: Any]
        XCTAssertEqual(response["clientDataJSON"] as? String, "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0")
        XCTAssertEqual(response["attestationObject"] as? String, "Y2JvciBhdHRlc3RhdGlvbg")
        XCTAssertNil(response["authenticatorData"])
        XCTAssertNil(response["signature"])
        XCTAssertNil(response["userHandle"])
    }

    func testPerformRegistrationCancellationMapsToPasskeyCancelled() async throws {
        let provider = MockAuthenticationServicesProvider()
        provider.nextBehavior = .failure(
            ASAuthorizationError(.canceled)
        )
        let webauthn = WebAuthn(rpId: "example.com", provider: provider)
        let opts = try Fixtures.decodedCreationOptions()

        do {
            _ = try await webauthn.performRegistration(opts: opts)
            XCTFail("expected throw")
        } catch let error as AuthClientError {
            XCTAssertEqual(error.code, .passkeyCancelled)
        }
    }

    func testPerformRegistrationFailureMapsToPasskeyFailed() async throws {
        let provider = MockAuthenticationServicesProvider()
        provider.nextBehavior = .failure(
            ASAuthorizationError(.failed)
        )
        let webauthn = WebAuthn(rpId: "example.com", provider: provider)
        let opts = try Fixtures.decodedCreationOptions()

        do {
            _ = try await webauthn.performRegistration(opts: opts)
            XCTFail("expected throw")
        } catch let error as AuthClientError {
            XCTAssertEqual(error.code, .passkeyFailed)
        }
    }

    func testPerformSignInCancellationMapsToPasskeyCancelled() async throws {
        let provider = MockAuthenticationServicesProvider()
        provider.nextBehavior = .failure(
            ASAuthorizationError(.canceled)
        )
        let webauthn = WebAuthn(rpId: "example.com", provider: provider)
        let opts = try Fixtures.decodedRequestOptions()

        do {
            _ = try await webauthn.performSignIn(opts: opts)
            XCTFail("expected throw")
        } catch let error as AuthClientError {
            XCTAssertEqual(error.code, .passkeyCancelled)
        }
    }

    func testRegistrationRequestUsesProvidedRpId() async throws {
        let provider = MockAuthenticationServicesProvider()
        // Set a failure behavior so we capture the request without needing
        // a real ASAuthorization (the request capture happens before the
        // success/failure decision).
        provider.nextBehavior = .failure(ASAuthorizationError(.canceled))
        let webauthn = WebAuthn(rpId: "real.example", provider: provider)
        let opts = try Fixtures.decodedCreationOptions()

        _ = try? await webauthn.performRegistration(opts: opts)

        let captured = provider.lastRequest as? ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest
        XCTAssertNotNil(captured, "expected a platform registration request")
        XCTAssertEqual(captured?.relyingPartyIdentifier, "real.example")
    }

    func testSignInRequestUsesProvidedRpId() async throws {
        let provider = MockAuthenticationServicesProvider()
        provider.nextBehavior = .failure(ASAuthorizationError(.canceled))
        let webauthn = WebAuthn(rpId: "real.example", provider: provider)
        let opts = try Fixtures.decodedRequestOptions()

        _ = try? await webauthn.performSignIn(opts: opts)

        let captured = provider.lastRequest as? ASAuthorizationPlatformPublicKeyCredentialAssertionRequest
        XCTAssertNotNil(captured, "expected a platform assertion request")
        XCTAssertEqual(captured?.relyingPartyIdentifier, "real.example")
    }
}
