import XCTest
@testable import PasskeySDK

final class AuthClientManagementTests: XCTestCase {
    let baseURL = URL(string: "https://api.example.test/auth")!

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
    }

    override func tearDown() {
        MockURLProtocol.reset()
        super.tearDown()
    }

    private func makeClient() -> AuthClient {
        let config = AuthClientConfig(
            baseURL: baseURL,
            session: MockURLProtocol.session(),
            storage: InMemoryTokenStorage()
        )
        return AuthClient(config: config, provider: MockAuthenticationServicesProvider())
    }

    func testListSessionsReturnsArray() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"""
            {"sessions":[
              {"createdAt":100,"expiresAt":200,"lastSeenAt":150,"userAgent":"ua","ip":"1.2.3.4"}
            ]}
            """#
            return (Data(body.utf8), response)
        }
        let r = try await makeClient().listSessions()
        XCTAssertEqual(r.sessions.count, 1)
        XCTAssertEqual(r.sessions[0].userAgent, "ua")
    }

    func testListPasskeysReturnsArray() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            let body = #"""
            {"passkeys":[
              {"id":"abc123","deviceName":"MacBook","createdAt":1,"lastUsedAt":2,"transports":["internal"]}
            ]}
            """#
            return (Data(body.utf8), response)
        }
        let r = try await makeClient().listPasskeys()
        XCTAssertEqual(r.passkeys[0].id, "abc123")
        XCTAssertEqual(r.passkeys[0].transports, ["internal"])
    }

    func testDeletePasskeyComposesURL() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"ok":true}"#.utf8), response)
        }
        try await makeClient().deletePasskey(id: "abc123")
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.absoluteString, "https://api.example.test/auth/passkeys/abc123")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "DELETE")
    }

    func testDeletePasskeyURLEncodesId() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(#"{"ok":true}"#.utf8), response)
        }
        try await makeClient().deletePasskey(id: "a/b+c")
        let url = MockURLProtocol.lastRequest?.url?.absoluteString ?? ""
        XCTAssertFalse(url.contains("/auth/passkeys/a/b+c"))
        XCTAssertTrue(url.contains("a%2Fb%2Bc"))
    }

    func testDeletePasskeySurfacesUnknownCredential() async throws {
        MockURLProtocol.handler = { request in
            let response = HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!
            let body = #"{"error":"unknown_credential","message":"Not yours"}"#
            return (Data(body.utf8), response)
        }
        do {
            try await makeClient().deletePasskey(id: "pk_other")
            XCTFail("expected throw")
        } catch let e as AuthClientError {
            XCTAssertEqual(e.code, .unknownCredential)
        }
    }
}
