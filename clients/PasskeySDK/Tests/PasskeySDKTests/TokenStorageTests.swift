import XCTest
@testable import PasskeySDK

final class InMemoryTokenStorageTests: XCTestCase {
    func testInitiallyEmpty() throws {
        let storage = InMemoryTokenStorage()
        XCTAssertNil(try storage.load())
    }

    func testSaveLoadRoundTrip() throws {
        let storage = InMemoryTokenStorage()
        try storage.save("tok_abc")
        XCTAssertEqual(try storage.load(), "tok_abc")
    }

    func testClearRemovesEntry() throws {
        let storage = InMemoryTokenStorage()
        try storage.save("tok_abc")
        try storage.clear()
        XCTAssertNil(try storage.load())
    }

    func testAttachAddsAuthorizationHeader() throws {
        let storage = InMemoryTokenStorage()
        try storage.save("tok_abc")
        var request = URLRequest(url: URL(string: "https://example.test")!)
        try storage.attach(to: &request)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer tok_abc")
    }

    func testAttachWithNoTokenLeavesRequestUnchanged() throws {
        let storage = InMemoryTokenStorage()
        var request = URLRequest(url: URL(string: "https://example.test")!)
        try storage.attach(to: &request)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }
}
