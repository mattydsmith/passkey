import XCTest
@testable import PasskeySDK

final class AuthClientErrorTests: XCTestCase {
    func testCodeFromKnownString() {
        XCTAssertEqual(AuthClientErrorCode(rawString: "invalid_otp"), .invalidOtp)
        XCTAssertEqual(AuthClientErrorCode(rawString: "csrf_required"), .csrfRequired)
        XCTAssertEqual(AuthClientErrorCode(rawString: "internal_error"), .internalError)
        XCTAssertEqual(AuthClientErrorCode(rawString: "passkey_cancelled"), .passkeyCancelled)
    }

    func testCodeFromUnknownString() {
        XCTAssertEqual(AuthClientErrorCode(rawString: "future_code"), .unknown)
    }

    func testErrorPreservesRawCode() {
        let error = AuthClientError(
            code: .unknown,
            rawCode: "future_code",
            message: "msg",
            status: 418,
            underlying: nil
        )
        XCTAssertEqual(error.rawCode, "future_code")
        XCTAssertEqual(error.status, 418)
        XCTAssertEqual(error.message, "msg")
    }

    func testErrorIsThrowable() {
        let error = AuthClientError(
            code: .unauthenticated,
            rawCode: "unauthenticated",
            message: "no session",
            status: 401,
            underlying: nil
        )
        XCTAssertThrowsError(try { throw error }()) { thrown in
            guard let e = thrown as? AuthClientError else {
                XCTFail("wrong type")
                return
            }
            XCTAssertEqual(e.code, .unauthenticated)
        }
    }

    func testWireErrorDecodes() throws {
        let json = #"{"error": "invalid_otp", "message": "wrong code"}"#.data(using: .utf8)!
        let wire = try JSONDecoder().decode(WireError.self, from: json)
        XCTAssertEqual(wire.error, "invalid_otp")
        XCTAssertEqual(wire.message, "wrong code")
    }

    func testWireErrorDecodesWithMissingMessage() throws {
        let json = #"{"error": "internal_error"}"#.data(using: .utf8)!
        let wire = try JSONDecoder().decode(WireError.self, from: json)
        XCTAssertEqual(wire.error, "internal_error")
        XCTAssertNil(wire.message)
    }
}
