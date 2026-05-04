import XCTest
@testable import PasskeySDK

final class TypesTests: XCTestCase {
    func testAuthUserDecodes() throws {
        let json = #"{"id":"u_1","email":"matt@example.com"}"#.data(using: .utf8)!
        let user = try JSONDecoder().decode(AuthUser.self, from: json)
        XCTAssertEqual(user.id, "u_1")
        XCTAssertEqual(user.email, "matt@example.com")
    }

    func testStartEmailSignInResultDecodes() throws {
        let json = #"{"otpId":"otp_x","expiresInSeconds":600}"#.data(using: .utf8)!
        let r = try JSONDecoder().decode(StartEmailSignInResult.self, from: json)
        XCTAssertEqual(r.otpId, "otp_x")
        XCTAssertEqual(r.expiresInSeconds, 600)
    }

    func testRegisterPasskeyResultDecodes() throws {
        let json = #"{"passkeyId":"abc123"}"#.data(using: .utf8)!
        let r = try JSONDecoder().decode(RegisterPasskeyResult.self, from: json)
        XCTAssertEqual(r.passkeyId, "abc123")
    }

    func testSessionSummaryDecodesWithNullableFields() throws {
        let json = #"""
        {"createdAt":100,"expiresAt":200,"lastSeenAt":150,"userAgent":null,"ip":null}
        """#.data(using: .utf8)!
        let s = try JSONDecoder().decode(SessionSummary.self, from: json)
        XCTAssertEqual(s.createdAt, 100)
        XCTAssertNil(s.userAgent)
        XCTAssertNil(s.ip)
    }

    func testPasskeySummaryDecodesWithNullableFields() throws {
        let json = #"""
        {"id":"p","deviceName":null,"createdAt":1,"lastUsedAt":null,"transports":null}
        """#.data(using: .utf8)!
        let p = try JSONDecoder().decode(PasskeySummary.self, from: json)
        XCTAssertEqual(p.id, "p")
        XCTAssertNil(p.deviceName)
        XCTAssertNil(p.lastUsedAt)
        XCTAssertNil(p.transports)
    }

    func testListPasskeysResultWithMultipleEntries() throws {
        let json = #"""
        {"passkeys":[
          {"id":"p1","deviceName":"MacBook","createdAt":1,"lastUsedAt":2,"transports":["internal"]},
          {"id":"p2","deviceName":null,"createdAt":3,"lastUsedAt":null,"transports":null}
        ]}
        """#.data(using: .utf8)!
        let r = try JSONDecoder().decode(ListPasskeysResult.self, from: json)
        XCTAssertEqual(r.passkeys.count, 2)
        XCTAssertEqual(r.passkeys[0].transports, ["internal"])
    }
}
