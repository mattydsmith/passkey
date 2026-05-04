import XCTest
@testable import PasskeySDK

final class TransportTests: XCTestCase {
    let baseURL = URL(string: "https://api.example.test/auth")!

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    private func makeTransport(storage: any TokenStorage = InMemoryTokenStorage()) -> Transport {
        Transport(
            baseURL: baseURL,
            session: MockURLProtocol.session(),
            storage: storage
        )
    }

    private func ok(_ data: Data) -> MockURLProtocol.Handler {
        return { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (data, response)
        }
    }

    func testComposesURL() async throws {
        MockURLProtocol.handler = ok(Data("{}".utf8))
        let t = makeTransport()
        struct Empty: Decodable {}
        _ = try await t.request(path: "/email/start", method: .post, body: ["email": "a@b.c"]) as Empty
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.absoluteString, "https://api.example.test/auth/email/start")
    }

    func testNormalizesLeadingSlashOnPath() async throws {
        MockURLProtocol.handler = ok(Data("{}".utf8))
        let t = makeTransport()
        struct Empty: Decodable {}
        _ = try await t.request(path: "email/start", method: .post, body: ["email": "a@b.c"]) as Empty
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.absoluteString, "https://api.example.test/auth/email/start")
    }

    func testSetsContentTypeForJSONBody() async throws {
        MockURLProtocol.handler = ok(Data("{}".utf8))
        let t = makeTransport()
        struct Empty: Decodable {}
        _ = try await t.request(path: "/email/start", method: .post, body: ["email": "a@b.c"]) as Empty
        XCTAssertEqual(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testNoContentTypeForBodylessRequest() async throws {
        MockURLProtocol.handler = ok(Data(#"{"user":{"id":"u","email":""}}"#.utf8))
        let t = makeTransport()
        _ = try await t.request(path: "/me", method: .get, body: nil) as GetCurrentUserResult
        XCTAssertNil(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Content-Type"))
    }

    func testAttachesAuthorizationHeader() async throws {
        MockURLProtocol.handler = ok(Data(#"{"user":{"id":"u","email":""}}"#.utf8))
        let storage = InMemoryTokenStorage()
        try storage.save("tok_abc")
        let t = makeTransport(storage: storage)
        _ = try await t.request(path: "/me", method: .get, body: nil) as GetCurrentUserResult
        XCTAssertEqual(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
    }

    func testNoAuthorizationWhenStorageEmpty() async throws {
        MockURLProtocol.handler = ok(Data(#"{"user":{"id":"u","email":""}}"#.utf8))
        let t = makeTransport()
        _ = try await t.request(path: "/me", method: .get, body: nil) as GetCurrentUserResult
        XCTAssertNil(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"))
    }

    func testParsesSuccessfulJSON() async throws {
        MockURLProtocol.handler = ok(Data(#"{"otpId":"otp_x","expiresInSeconds":600}"#.utf8))
        let t = makeTransport()
        let r: StartEmailSignInResult = try await t.request(path: "/email/start", method: .post, body: ["email": "a@b.c"])
        XCTAssertEqual(r.otpId, "otp_x")
        XCTAssertEqual(r.expiresInSeconds, 600)
    }

    func testNon2xxWithKnownErrorCodeMapsToAuthClientError() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
            let body = Data(#"{"error":"invalid_otp","message":"wrong"}"#.utf8)
            return (body, response)
        }
        let t = makeTransport()
        struct Empty: Decodable {}
        do {
            _ = try await t.request(path: "/email/verify", method: .post, body: ["otpId": "x", "code": "000000"]) as Empty
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .invalidOtp)
            XCTAssertEqual(e.rawCode, "invalid_otp")
            XCTAssertEqual(e.status, 401)
            XCTAssertEqual(e.message, "wrong")
        }
    }

    func testNon2xxWithUnknownErrorCodeFallsThroughToUnknown() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: nil, headerFields: nil)!
            let body = Data(#"{"error":"future_code","message":"new"}"#.utf8)
            return (body, response)
        }
        let t = makeTransport()
        struct Empty: Decodable {}
        do {
            _ = try await t.request(path: "/x", method: .post, body: nil) as Empty
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .unknown)
            XCTAssertEqual(e.rawCode, "future_code")
            XCTAssertEqual(e.status, 503)
        }
    }

    func testNetworkFailureMapsToNetwork() async throws {
        MockURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        let t = makeTransport()
        struct Empty: Decodable {}
        do {
            _ = try await t.request(path: "/x", method: .post, body: nil) as Empty
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .network)
        }
    }

    func testMalformedJSONOnSuccessMapsToNetwork() async throws {
        MockURLProtocol.handler = ok(Data("not-json".utf8))
        let t = makeTransport()
        struct Empty: Decodable {}
        do {
            _ = try await t.request(path: "/x", method: .post, body: nil) as Empty
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .network)
        }
    }

    func testEmptyBodyOn2xxReturnsEmptyDecodable() async throws {
        // For a 200 with no body, the transport should decode `EmptyResponse`.
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(), response)
        }
        let t = makeTransport()
        let r: EmptyResponse = try await t.request(path: "/sign-out", method: .post, body: nil)
        XCTAssertEqual(r, EmptyResponse())
    }

    func testDeleteMethodComposesCorrectly() async throws {
        MockURLProtocol.handler = ok(Data(#"{"ok":true}"#.utf8))
        let t = makeTransport()
        struct OK: Decodable { let ok: Bool }
        _ = try await t.request(path: "/passkeys/abc", method: .delete, body: nil) as OK
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "DELETE")
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.absoluteString, "https://api.example.test/auth/passkeys/abc")
    }
}
