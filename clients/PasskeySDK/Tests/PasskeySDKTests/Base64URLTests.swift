import XCTest
@testable import PasskeySDK

final class Base64URLTests: XCTestCase {
    func testEmptyRoundTrip() {
        let data = Data()
        XCTAssertEqual(data.base64URLEncodedString(), "")
        XCTAssertEqual(Data(base64URLEncoded: "")?.count, 0)
    }

    func testKnownShortBuffer() {
        // bytes [0xff, 0xfe, 0xfd] → "//79" in base64 → "__79" in base64url
        let data = Data([0xff, 0xfe, 0xfd])
        XCTAssertEqual(data.base64URLEncodedString(), "__79")
        let decoded = Data(base64URLEncoded: "__79")
        XCTAssertEqual(decoded?.map { $0 }, [0xff, 0xfe, 0xfd])
    }

    func testStripsPaddingOnEncode() {
        // 1 byte → 2 chars + 2 pad standard, but base64url strips
        XCTAssertEqual(Data([0x4d]).base64URLEncodedString(), "TQ")
    }

    func testAcceptsPaddedInputOnDecode() {
        let decoded = Data(base64URLEncoded: "TQ==")
        XCTAssertEqual(decoded?.map { $0 }, [0x4d])
    }

    func testRandomRoundTrip() {
        var bytes = Data(count: 256)
        bytes.withUnsafeMutableBytes { buffer in
            _ = SecRandomCopyBytes(kSecRandomDefault, 256, buffer.baseAddress!)
        }
        let encoded = bytes.base64URLEncodedString()
        let decoded = Data(base64URLEncoded: encoded)
        XCTAssertEqual(decoded, bytes)
    }

    func testUsesDashAndUnderscore() {
        // Bytes that produce + / in standard base64
        let data = Data([0xfb, 0xff])
        let out = data.base64URLEncodedString()
        XCTAssertFalse(out.contains("+"))
        XCTAssertFalse(out.contains("/"))
        XCTAssertFalse(out.contains("="))
        XCTAssertEqual(out, "-_8")
    }

    func testInvalidInputReturnsNil() {
        // "!" is not a valid base64 character
        XCTAssertNil(Data(base64URLEncoded: "!"))
    }
}
