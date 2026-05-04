import XCTest
import AuthenticationServices
@testable import PasskeySDK

final class AuthClientPasskeyTests: XCTestCase {
    let baseURL = URL(string: "https://api.example.test/auth")!

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    private func makeClient(
        provider: any AuthenticationServicesProvider,
        storage: any TokenStorage = InMemoryTokenStorage()
    ) -> AuthClient {
        let config = AuthClientConfig(
            baseURL: baseURL,
            session: MockURLProtocol.session(),
            storage: storage,
            rpIDOverride: "example.com"
        )
        return AuthClient(config: config, provider: provider)
    }

    /// Verify that registerPasskey calls the start endpoint, then the provider seam,
    /// then surfaces the provider's error mapped through WebAuthn.
    func testRegisterPasskeyCallsStartThenProvider() async throws {
        let optsJSON = #"""
        {
          "registrationId": "reg_x",
          "options": {
            "challenge": "Y2g",
            "rp": { "id": "example.com", "name": "example" },
            "user": { "id": "dV8x", "name": "m@x.y", "displayName": "m@x.y" },
            "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
            "excludeCredentials": [],
            "timeout": 60000
          }
        }
        """#

        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(optsJSON.utf8), response)
        }

        // Provider raises canceled — we use this to stop the flow before the
        // un-mockable ASAuthorization stage and to verify the seam was invoked.
        let provider = MockAuthenticationServicesProvider()
        provider.nextBehavior = .failure(ASAuthorizationError(.canceled))
        let client = makeClient(provider: provider)
        try await Task.sleep(nanoseconds: 0) // satisfy concurrency-warning lint where applicable

        do {
            _ = try await client.registerPasskey(deviceName: "MacBook")
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .passkeyCancelled)
        }

        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/auth/passkey/register/start")
        XCTAssertNotNil(provider.lastRequest, "provider seam was invoked")
    }

    func testRegisterPasskeySurfacesUnauthenticatedFromStart() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"error":"unauthenticated","message":"sign in"}"#.utf8), response)
        }
        let provider = MockAuthenticationServicesProvider()
        let client = makeClient(provider: provider)

        do {
            _ = try await client.registerPasskey(deviceName: "MacBook")
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .unauthenticated)
            XCTAssertNil(provider.lastRequest, "provider seam should not have been invoked")
        }
    }

    func testSignInWithPasskeyCallsStartThenProvider() async throws {
        let optsJSON = #"""
        {
          "signInId": "auth_x",
          "options": {
            "challenge": "Y2g",
            "rpId": "example.com",
            "allowCredentials": [],
            "userVerification": "preferred",
            "timeout": 60000
          }
        }
        """#

        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(optsJSON.utf8), response)
        }
        let provider = MockAuthenticationServicesProvider()
        provider.nextBehavior = .failure(ASAuthorizationError(.canceled))
        let client = makeClient(provider: provider)

        do {
            _ = try await client.signInWithPasskey()
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .passkeyCancelled)
        }

        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/auth/passkey/sign-in/start")
        XCTAssertNotNil(provider.lastRequest)
    }
}
