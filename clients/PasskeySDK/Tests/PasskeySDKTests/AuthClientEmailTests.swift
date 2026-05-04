import XCTest
@testable import PasskeySDK

final class AuthClientEmailTests: XCTestCase {
    let baseURL = URL(string: "https://api.example.test/auth")!

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    private func makeClient(storage: any TokenStorage = InMemoryTokenStorage()) -> AuthClient {
        let config = AuthClientConfig(
            baseURL: baseURL,
            session: MockURLProtocol.session(),
            storage: storage
        )
        return AuthClient(config: config, provider: MockAuthenticationServicesProvider())
    }

    func testStartEmailSignInReturnsResult() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"otpId":"otp_x","expiresInSeconds":600}"#.utf8), response)
        }
        let client = makeClient()
        let r = try await client.startEmailSignIn(email: "matt@example.com")
        XCTAssertEqual(r.otpId, "otp_x")
        XCTAssertEqual(r.expiresInSeconds, 600)

        let bodyString = String(data: MockURLProtocol.lastRequest?.httpBody ?? Data(), encoding: .utf8)
        XCTAssertEqual(bodyString, #"{"email":"matt@example.com"}"#)
    }

    func testVerifyEmailOtpStripsTokenAndPersistsIt() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = Data(#"{"sessionToken":"tok_abc","user":{"id":"u_1","email":"matt@example.com"}}"#.utf8)
            return (body, response)
        }
        let storage = InMemoryTokenStorage()
        let client = makeClient(storage: storage)
        let r = try await client.verifyEmailOtp(otpId: "otp_x", code: "123456")
        XCTAssertEqual(r.user.id, "u_1")
        XCTAssertEqual(r.user.email, "matt@example.com")
        XCTAssertEqual(try storage.load(), "tok_abc")
    }

    func testGetCurrentUserUsesPersistedToken() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"user":{"id":"u_1","email":""}}"#.utf8), response)
        }
        let storage = InMemoryTokenStorage()
        try storage.save("tok_abc")
        let client = makeClient(storage: storage)
        let r = try await client.getCurrentUser()
        XCTAssertEqual(r.user.id, "u_1")
        XCTAssertEqual(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
    }

    func testSignOutClearsToken() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"ok":true}"#.utf8), response)
        }
        let storage = InMemoryTokenStorage()
        try storage.save("tok_abc")
        let client = makeClient(storage: storage)
        try await client.signOut()
        XCTAssertNil(try storage.load())
    }

    func testVerifyEmailOtpSurfacesInvalidOtp() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"error":"invalid_otp","message":"wrong"}"#.utf8), response)
        }
        let storage = InMemoryTokenStorage()
        let client = makeClient(storage: storage)
        do {
            _ = try await client.verifyEmailOtp(otpId: "x", code: "000000")
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .invalidOtp)
            XCTAssertNil(try storage.load(), "must not persist on error")
        }
    }
}
