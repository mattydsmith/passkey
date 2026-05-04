# Passkey SDK Phase 3 (Swift Client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `PasskeySDK`, a Swift Package implementing the same nine-method client surface as `@mattsmith/passkey-sdk-client-web`, plus a SwiftUI demo app exercising every method against the existing `examples/hono-app`.

**Architecture:** Bearer-token-only client. `URLSession` for HTTP (mockable via `URLProtocol`), Keychain for token persistence, `AuthenticationServices` for WebAuthn ceremonies (mockable via a small protocol seam). Each public method is one or two transport calls plus, for passkey ceremonies, a call into the seam. Errors map to a single `AuthClientError` whose `code` enum mirrors the web client's union plus `unknown` for forward-compat. No third-party runtime dependencies.

**Tech Stack:** Swift Package Manager, Swift 6 toolchain (Swift 5 language mode), iOS 26 / macOS 26 deployment targets, `XCTest`, `URLSession`, `Security` (Keychain), `AuthenticationServices`. SwiftUI for the demo app.

**Reference reading order before starting:**
1. `Passkey/docs/superpowers/specs/2026-05-04-passkey-sdk-phase-3-swift-design.md` — the design this plan implements
2. `Passkey/spec/protocol.md` — the contract being consumed
3. `Passkey/packages/client-web/src/{client,transport,storage,webauthn,errors,types}.ts` — concrete reference; this plan mirrors these 1:1 in Swift
4. `Passkey/examples/hono-app/src/index.ts` — server the demo and tests run against
5. `Passkey/docs/superpowers/notes/2026-05-04-phase-2-completion.md` — web-client deviations Phase 3 should also be aware of
6. `Passkey/docs/superpowers/notes/2026-05-04-phase-1-completion.md` — server gotchas
7. `Passkey/CLAUDE.md` — repo conventions

**Workflow:** Work directly on `main`. One commit per task. Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). NO `Co-Authored-By` trailer. The Swift Package lives at `clients/PasskeySDK/`; demo at `clients/ios-demo/`.

**Testing:**
- Per-task verification uses `swift test` from `clients/PasskeySDK/` — runs the full XCTest suite on macOS in seconds.
- Final iOS-Simulator verification (Task 14) uses `xcodebuild test -destination "platform=iOS Simulator,OS=26.0"` to confirm the same suite passes on the iOS toolchain.
- The demo app is a manual run target; no automated tests for it.

---

## File structure (locked in before tasks)

### Swift Package: `clients/PasskeySDK/`

| File | Responsibility |
|---|---|
| `Package.swift` | SwiftPM manifest. Platforms `.iOS(.v26)`, `.macOS(.v26)`. Single library product `PasskeySDK`. |
| `README.md` | Package docs (already designed; written in Task 13). |
| `Sources/PasskeySDK/AuthClientConfig.swift` | `AuthClientConfig` struct. |
| `Sources/PasskeySDK/AuthClientError.swift` | `AuthClientError` struct + `AuthClientErrorCode` enum + `WireError` (`{error, message}` decoder). |
| `Sources/PasskeySDK/Types.swift` | `AuthUser`, `StartEmailSignInResult`, `VerifyEmailOtpResult`, `RegisterPasskeyResult`, `SignInWithPasskeyResult`, `GetCurrentUserResult`, `SessionSummary`, `ListSessionsResult`, `PasskeySummary`, `ListPasskeysResult`. |
| `Sources/PasskeySDK/Base64URL.swift` | `Data.base64URLEncodedString()` + `Data(base64URLEncoded:)` extensions. |
| `Sources/PasskeySDK/TokenStorage.swift` | `TokenStorage` protocol + `KeychainStorage` impl + `InMemoryTokenStorage` (used by tests). |
| `Sources/PasskeySDK/AuthenticationServicesProvider.swift` | `AuthenticationServicesProvider` protocol + `DefaultAuthenticationServicesProvider` (wraps `ASAuthorizationController`). |
| `Sources/PasskeySDK/WebAuthn.swift` | `ServerCreationOptions`/`ServerRequestOptions` (decoded from server) → DOM-shaped requests + `PublicKeyCredentialJSON` encoder. `performRegistration(...)` / `performSignIn(...)` orchestrators. |
| `Sources/PasskeySDK/Transport.swift` | URL composition, JSON encode/decode, storage attach, `URLSession.data(for:)`, error mapping. |
| `Sources/PasskeySDK/AuthClient.swift` | Public façade. Composes Transport + storage + provider. Nine public methods. |
| `Tests/PasskeySDKTests/Base64URLTests.swift` | Codec round-trip. |
| `Tests/PasskeySDKTests/TokenStorageTests.swift` | `InMemoryTokenStorage` round-trip + `attach` behavior. |
| `Tests/PasskeySDKTests/AuthenticationServicesProviderTests.swift` | `MockAuthenticationServicesProvider` shape verified. |
| `Tests/PasskeySDKTests/WebAuthnCeremonyTests.swift` | Encode/decode + provider-mocked happy/cancel/fail paths. |
| `Tests/PasskeySDKTests/TransportTests.swift` | URL composition, content-type, header attach, error mapping, network failure, JSON-parse failure. |
| `Tests/PasskeySDKTests/AuthClientEmailTests.swift` | startEmailSignIn / verifyEmailOtp / getCurrentUser / signOut. |
| `Tests/PasskeySDKTests/AuthClientPasskeyTests.swift` | registerPasskey / signInWithPasskey via provider mock. |
| `Tests/PasskeySDKTests/AuthClientManagementTests.swift` | listSessions / listPasskeys / deletePasskey. |
| `Tests/PasskeySDKTests/Helpers/MockURLProtocol.swift` | Test-only `URLProtocol` for HTTP mocking. |
| `Tests/PasskeySDKTests/Helpers/MockAuthenticationServicesProvider.swift` | Test-only provider yielding canned ASAuthorization values. |
| `Tests/PasskeySDKTests/Helpers/Fixtures.swift` | Shared test fixtures (sample server options, fake credential bytes). |

### Demo app: `clients/ios-demo/`

| File | Responsibility |
|---|---|
| `README.md` | How to set up the Xcode project, run vs hono-app on :3001, real-device caveats. |
| `Sources/ContentView.swift` | SwiftUI single screen: buttons + status pane mirroring `examples/web-demo`. |
| `Sources/ios_demoApp.swift` | `@main App` entry. |
| `Sources/Info.plist` | Plist with Associated Domains placeholder + minimal iOS app boilerplate. |

The demo's source files are committed; the `.xcodeproj` is created manually by the user via Xcode (documented in the demo README). This sidesteps committing fragile auto-generated Xcode metadata.

---

## Phase A — Package scaffolding (Task 1)

### Task 1: Scaffold the Swift Package

**Files:**
- Create: `clients/PasskeySDK/Package.swift`
- Create: `clients/PasskeySDK/Sources/PasskeySDK/PasskeySDK.swift` (placeholder, populated in later tasks)
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/SmokeTests.swift`
- Modify: `.gitignore` (add Swift build artifacts)

- [ ] **Step 1: Create `clients/PasskeySDK/Package.swift`**

```swift
// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "PasskeySDK",
    platforms: [
        .iOS(.v26),
        .macOS(.v26),
    ],
    products: [
        .library(
            name: "PasskeySDK",
            targets: ["PasskeySDK"]
        ),
    ],
    targets: [
        .target(
            name: "PasskeySDK",
            path: "Sources/PasskeySDK"
        ),
        .testTarget(
            name: "PasskeySDKTests",
            dependencies: ["PasskeySDK"],
            path: "Tests/PasskeySDKTests"
        ),
    ]
)
```

- [ ] **Step 2: Create the placeholder source file**

`clients/PasskeySDK/Sources/PasskeySDK/PasskeySDK.swift`:

```swift
// PasskeySDK is populated by subsequent tasks.
// This file exists only to give SwiftPM a non-empty source target.
```

- [ ] **Step 3: Create the smoke test**

`clients/PasskeySDK/Tests/PasskeySDKTests/SmokeTests.swift`:

```swift
import XCTest
@testable import PasskeySDK

final class SmokeTests: XCTestCase {
    func testPackageBuilds() {
        XCTAssertTrue(true)
    }
}
```

- [ ] **Step 4: Update `.gitignore`**

Append to `/Users/mattsmith/Documents/Dev/SDKs/Passkey/.gitignore`:

```
# Swift / Xcode
clients/**/.build/
clients/**/.swiftpm/
clients/**/DerivedData/
clients/**/*.xcodeproj/xcuserdata/
clients/**/*.xcworkspace/xcuserdata/
clients/**/Package.resolved
```

If the file doesn't end in a newline, add one before appending.

- [ ] **Step 5: Verify the package builds and tests pass**

Run from `/Users/mattsmith/Documents/Dev/SDKs/Passkey/clients/PasskeySDK`:

```bash
swift build
swift test
```

Expected: build succeeds; smoke test passes (1 test).

If `swift build` fails with a deployment-target error (e.g. iOS 26 not available on this toolchain), the toolchain is older than expected — STOP and report. Do not silently downgrade the deployment target.

- [ ] **Step 6: Commit**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
git add clients/PasskeySDK .gitignore
git commit -m "feat(swift): scaffold PasskeySDK Swift Package

iOS 26 / macOS 26 deployment targets, single PasskeySDK library
product, no runtime deps. Smoke test verifies the package builds."
```

NO `Co-Authored-By` trailer.

---

## Phase B — Internals bottom-up (TDD)

### Task 2: `AuthClientError` + `AuthClientErrorCode` + `WireError`

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/AuthClientError.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientErrorTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientErrorTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey/clients/PasskeySDK
swift test
```

Expected: build error — `AuthClientError`, `AuthClientErrorCode`, `WireError` do not exist.

- [ ] **Step 3: Implement `AuthClientError.swift`**

Create `clients/PasskeySDK/Sources/PasskeySDK/AuthClientError.swift`:

```swift
import Foundation

public enum AuthClientErrorCode: String, Sendable, Equatable {
    case invalidOtp = "invalid_otp"
    case otpAttemptsExceeded = "otp_attempts_exceeded"
    case otpExpired = "otp_expired"
    case invalidCredential = "invalid_credential"
    case unknownCredential = "unknown_credential"
    case unauthenticated
    case rateLimited = "rate_limited"
    case csrfRequired = "csrf_required"
    case invalidRequest = "invalid_request"
    case internalError = "internal_error"
    case network
    case passkeyCancelled = "passkey_cancelled"
    case passkeyFailed = "passkey_failed"
    case unsupported
    case unknown

    /// Parse a wire-format error code into the enum, falling through to `.unknown`.
    public init(rawString: String) {
        self = AuthClientErrorCode(rawValue: rawString) ?? .unknown
    }
}

public struct AuthClientError: Error, Sendable {
    public let code: AuthClientErrorCode
    public let rawCode: String
    public let message: String
    public let status: Int?
    public let underlying: (any Error)?

    public init(
        code: AuthClientErrorCode,
        rawCode: String,
        message: String,
        status: Int?,
        underlying: (any Error)?
    ) {
        self.code = code
        self.rawCode = rawCode
        self.message = message
        self.status = status
        self.underlying = underlying
    }
}

/// Internal: shape the server returns on non-2xx responses.
struct WireError: Decodable {
    let error: String
    let message: String?
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
swift test
```

Expected: all 6 tests in `AuthClientErrorTests` pass plus the smoke test.

- [ ] **Step 5: Commit**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
git add clients/PasskeySDK/Sources/PasskeySDK/AuthClientError.swift clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientErrorTests.swift
git commit -m "feat(swift): AuthClientError + code union + WireError

Single error type with discriminated AuthClientErrorCode enum (every
protocol code plus client-only network/passkey/unsupported/unknown).
rawCode preserves the verbatim server string for forward-compat with
new server codes. WireError is the internal {error, message} decoder."
```

---

### Task 3: Public types (`AuthUser`, result types)

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/Types.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/TypesTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/TypesTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — types do not exist.

- [ ] **Step 3: Implement `Types.swift`**

Create `clients/PasskeySDK/Sources/PasskeySDK/Types.swift`:

```swift
import Foundation

public struct AuthUser: Sendable, Decodable, Equatable {
    public let id: String
    public let email: String

    public init(id: String, email: String) {
        self.id = id
        self.email = email
    }
}

public struct StartEmailSignInResult: Sendable, Decodable, Equatable {
    public let otpId: String
    public let expiresInSeconds: Int
}

public struct VerifyEmailOtpResult: Sendable, Equatable {
    public let user: AuthUser
}

public struct RegisterPasskeyResult: Sendable, Decodable, Equatable {
    public let passkeyId: String
}

public struct SignInWithPasskeyResult: Sendable, Equatable {
    public let user: AuthUser
}

public struct GetCurrentUserResult: Sendable, Decodable, Equatable {
    public let user: AuthUser
}

public struct SessionSummary: Sendable, Decodable, Equatable {
    public let createdAt: Int
    public let expiresAt: Int
    public let lastSeenAt: Int
    public let userAgent: String?
    public let ip: String?
}

public struct ListSessionsResult: Sendable, Decodable, Equatable {
    public let sessions: [SessionSummary]
}

public struct PasskeySummary: Sendable, Decodable, Equatable {
    public let id: String
    public let deviceName: String?
    public let createdAt: Int
    public let lastUsedAt: Int?
    public let transports: [String]?
}

public struct ListPasskeysResult: Sendable, Decodable, Equatable {
    public let passkeys: [PasskeySummary]
}
```

`VerifyEmailOtpResult` and `SignInWithPasskeyResult` are not `Decodable` — they're constructed from a wire response that includes `sessionToken`, which the public type strips out. The wire-decoder lives in `AuthClient.swift` (Task 9 / 10).

- [ ] **Step 4: Run tests to verify they pass**

```bash
swift test
```

Expected: 6 new tests pass; everything from Task 2 still passes.

- [ ] **Step 5: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/Types.swift clients/PasskeySDK/Tests/PasskeySDKTests/TypesTests.swift
git commit -m "feat(swift): public result types (AuthUser, *Result, summaries)

Mirrors @mattsmith/passkey-sdk-client-web's types.ts. All Sendable.
Decodable types match the wire JSON; VerifyEmailOtpResult and
SignInWithPasskeyResult are pure-Swift (the sessionToken is stripped
from the wire response before construction)."
```

---

### Task 4: Base64URL codec

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/Base64URL.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/Base64URLTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/Base64URLTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — `base64URLEncodedString()` and `Data(base64URLEncoded:)` do not exist.

- [ ] **Step 3: Implement `Base64URL.swift`**

Create `clients/PasskeySDK/Sources/PasskeySDK/Base64URL.swift`:

```swift
import Foundation

extension Data {
    /// Encode as base64url: standard base64 with `-` for `+`, `_` for `/`,
    /// and trailing `=` padding stripped.
    public func base64URLEncodedString() -> String {
        let standard = base64EncodedString()
        var out = standard.replacingOccurrences(of: "+", with: "-")
        out = out.replacingOccurrences(of: "/", with: "_")
        out = out.replacingOccurrences(of: "=", with: "")
        return out
    }

    /// Decode a base64url string. Accepts both padded and unpadded inputs.
    /// Returns nil if the input contains characters outside the base64url alphabet.
    public init?(base64URLEncoded: String) {
        var standard = base64URLEncoded.replacingOccurrences(of: "-", with: "+")
        standard = standard.replacingOccurrences(of: "_", with: "/")
        let padding = (4 - standard.count % 4) % 4
        standard.append(String(repeating: "=", count: padding))
        guard let data = Data(base64Encoded: standard) else { return nil }
        self = data
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
swift test
```

Expected: 7 new codec tests pass; earlier tests still pass.

- [ ] **Step 5: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/Base64URL.swift clients/PasskeySDK/Tests/PasskeySDKTests/Base64URLTests.swift
git commit -m "feat(swift): base64url codec on Data"
```

---

### Task 5: `TokenStorage` protocol + `InMemoryTokenStorage` + `KeychainStorage`

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/TokenStorage.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/TokenStorageTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/TokenStorageTests.swift`:

```swift
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
```

(`KeychainStorage` is harder to test in headless `swift test` — the iOS Simulator and macOS test hosts have unreliable Keychain support outside an entitled app context. We verify it via the demo app manually. The protocol is the unit of test here.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — types do not exist.

- [ ] **Step 3: Implement `TokenStorage.swift`**

Create `clients/PasskeySDK/Sources/PasskeySDK/TokenStorage.swift`:

```swift
import Foundation
import Security

public protocol TokenStorage: Sendable {
    func load() throws -> String?
    func save(_ token: String) throws
    func clear() throws
    func attach(to request: inout URLRequest) throws
}

public extension TokenStorage {
    func attach(to request: inout URLRequest) throws {
        if let token = try load() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }
}

/// In-memory storage used by tests. Not for production.
public final class InMemoryTokenStorage: TokenStorage, @unchecked Sendable {
    private var token: String?
    private let lock = NSLock()

    public init() {}

    public func load() throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return token
    }

    public func save(_ token: String) throws {
        lock.lock(); defer { lock.unlock() }
        self.token = token
    }

    public func clear() throws {
        lock.lock(); defer { lock.unlock() }
        token = nil
    }
}

/// Production storage backed by the Keychain. One generic-password entry per
/// (service, account) pair. Not exercised in unit tests — verified manually
/// via the demo app, since headless XCTest hosts have unreliable Keychain access.
public struct KeychainStorage: TokenStorage {
    public let service: String
    public let account: String

    public init(service: String, account: String) {
        self.service = service
        self.account = account
    }

    public func load() throws -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data,
                  let token = String(data: data, encoding: .utf8) else {
                return nil
            }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError(status: status)
        }
    }

    public func save(_ token: String) throws {
        let data = Data(token.utf8)
        var query = baseQuery()
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        // Try update first; fall back to add if not present.
        let updateStatus = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound { throw KeychainError(status: updateStatus) }

        var addQuery = query
        for (k, v) in attrs { addQuery[k] = v }
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus != errSecSuccess { throw KeychainError(status: addStatus) }
    }

    public func clear() throws {
        let query = baseQuery()
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { return }
        throw KeychainError(status: status)
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

public struct KeychainError: Error, CustomStringConvertible {
    public let status: OSStatus

    public var description: String {
        let msg = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error"
        return "\(msg) (\(status))"
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
swift test
```

Expected: 5 new InMemoryTokenStorage tests pass; everything from earlier tasks still passes.

- [ ] **Step 5: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/TokenStorage.swift clients/PasskeySDK/Tests/PasskeySDKTests/TokenStorageTests.swift
git commit -m "feat(swift): TokenStorage protocol + Keychain + in-memory impls

TokenStorage abstracts session-token persistence. KeychainStorage is
production (one generic-password entry per service+account, accessible
after first unlock). InMemoryTokenStorage is the test fake. The
shared attach(to:) extension adds Authorization: Bearer <token> when
a token is present."
```

---

### Task 6: `AuthenticationServicesProvider` protocol + default implementation

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/AuthenticationServicesProvider.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/MockAuthenticationServicesProvider.swift`

The protocol is small and hard to unit-test in isolation (the only meaningful behavior is "delegate to ASAuthorizationController"). We verify it indirectly via Task 7's WebAuthn ceremony tests, which use the mock provider this task introduces.

- [ ] **Step 1: Implement the protocol + default impl**

Create `clients/PasskeySDK/Sources/PasskeySDK/AuthenticationServicesProvider.swift`:

```swift
import Foundation
import AuthenticationServices

/// Test seam for AuthenticationServices. The default implementation delegates
/// to ASAuthorizationController; tests substitute a mock that returns canned
/// authorizations or throws specific ASAuthorizationError values.
public protocol AuthenticationServicesProvider: Sendable {
    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization
}

/// Production implementation. Wraps ASAuthorizationController in async/await.
public final class DefaultAuthenticationServicesProvider: NSObject, AuthenticationServicesProvider, ASAuthorizationControllerDelegate, @unchecked Sendable {
    public override init() {
        super.init()
    }

    public func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            let controller = ASAuthorizationController(authorizationRequests: [request])
            let bridge = Bridge(continuation: continuation)
            controller.delegate = bridge
            // Retain bridge for the lifetime of the controller call.
            // ASAuthorizationController holds delegate weakly, so we attach
            // the bridge to the continuation closure scope by capturing it
            // in the continuation's resume path.
            objc_setAssociatedObject(controller, &Bridge.key, bridge, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            controller.performRequests()
        }
    }

    private final class Bridge: NSObject, ASAuthorizationControllerDelegate {
        static var key: UInt8 = 0
        let continuation: CheckedContinuation<ASAuthorization, any Error>
        private var resumed = false

        init(continuation: CheckedContinuation<ASAuthorization, any Error>) {
            self.continuation = continuation
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
            guard !resumed else { return }
            resumed = true
            continuation.resume(returning: authorization)
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: any Error) {
            guard !resumed else { return }
            resumed = true
            continuation.resume(throwing: error)
        }
    }
}
```

- [ ] **Step 2: Implement the test mock**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/MockAuthenticationServicesProvider.swift`:

```swift
import Foundation
import AuthenticationServices
@testable import PasskeySDK

/// A test provider that returns a canned ASAuthorization or throws a canned
/// error. Tests pre-load the result before invoking the SDK call.
final class MockAuthenticationServicesProvider: AuthenticationServicesProvider, @unchecked Sendable {
    enum Behavior {
        case success(ASAuthorization)
        case failure(any Error)
    }

    var nextBehavior: Behavior?
    private(set) var lastRequest: ASAuthorizationRequest?

    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        lastRequest = request
        guard let behavior = nextBehavior else {
            XCTFailure("MockAuthenticationServicesProvider invoked without a configured behavior")
        }
        nextBehavior = nil
        switch behavior {
        case .success(let authorization):
            return authorization
        case .failure(let error):
            throw error
        }
    }
}

import XCTest

func XCTFailure(_ message: String) -> Never {
    XCTFail(message)
    fatalError(message)
}
```

- [ ] **Step 3: Build to verify it compiles**

```bash
swift build
```

Expected: clean build. No new tests yet — the provider's behavior is exercised in Task 7.

- [ ] **Step 4: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/AuthenticationServicesProvider.swift clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/MockAuthenticationServicesProvider.swift
git commit -m "feat(swift): AuthenticationServicesProvider seam + default impl

Protocol abstracts AuthenticationServices for testing. The default
implementation bridges ASAuthorizationController to async/await via
a checked continuation and a retained delegate. Tests use the mock
in Helpers/ which yields canned ASAuthorization or throws on demand."
```

---

### Task 7: WebAuthn ceremony orchestrators

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/WebAuthn.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/WebAuthnCeremonyTests.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/Fixtures.swift`

- [ ] **Step 1: Create shared fixtures**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/Fixtures.swift`:

```swift
import Foundation
@testable import PasskeySDK

enum Fixtures {
    /// Sample server creation options as JSON the server would send.
    static let creationOptionsJSON = #"""
    {
      "challenge": "Y2g",
      "rp": { "id": "example.com", "name": "example" },
      "user": { "id": "dV8x", "name": "matt@example.com", "displayName": "matt@example.com" },
      "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
      "excludeCredentials": [],
      "authenticatorSelection": { "userVerification": "preferred" },
      "timeout": 60000
    }
    """#.data(using: .utf8)!

    /// Sample server request options as JSON.
    static let requestOptionsJSON = #"""
    {
      "challenge": "Y2g",
      "rpId": "example.com",
      "allowCredentials": [],
      "userVerification": "preferred",
      "timeout": 60000
    }
    """#.data(using: .utf8)!

    static func decodedCreationOptions() throws -> ServerCreationOptions {
        try JSONDecoder().decode(ServerCreationOptions.self, from: creationOptionsJSON)
    }

    static func decodedRequestOptions() throws -> ServerRequestOptions {
        try JSONDecoder().decode(ServerRequestOptions.self, from: requestOptionsJSON)
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/WebAuthnCeremonyTests.swift`:

```swift
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
```

(The "happy path" of registration is hard to mock at the `ASAuthorization` level — the credential types are constrained by Apple's APIs. We test what we can: input encoding, error mapping, request shape. The real happy path is exercised manually via the demo app.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — `WebAuthn`, `ServerCreationOptions`, `ServerRequestOptions`, `PublicKeyCredentialJSON` do not exist.

- [ ] **Step 4: Implement `WebAuthn.swift`**

Create `clients/PasskeySDK/Sources/PasskeySDK/WebAuthn.swift`:

```swift
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

    func encodeForCustomKeyStrategy() {} // documentation marker; no implementation needed
}

extension JSONEncoder {
    /// Default encoding produces null for nil optional fields. We want them
    /// omitted to match the web client. Use this encoder when serializing
    /// PublicKeyCredentialJSON.
    static let omittingNils: JSONEncoder = {
        let e = JSONEncoder()
        // Encodable's default is to emit null for nil; we filter nils by
        // re-encoding the dictionary through JSONSerialization. See
        // PublicKeyCredentialJSON.encodedAsJSONObject().
        return e
    }()
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
swift test
```

Expected: 7 new ceremony tests pass; all earlier tests still pass.

- [ ] **Step 6: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/WebAuthn.swift clients/PasskeySDK/Tests/PasskeySDKTests/WebAuthnCeremonyTests.swift clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/Fixtures.swift
git commit -m "feat(swift): WebAuthn ceremony orchestrators

ServerCreationOptions / ServerRequestOptions decode the wire JSON.
performRegistration / performSignIn build platform-public-key requests,
delegate to AuthenticationServicesProvider (mockable), and encode the
returned ASAuthorization into PublicKeyCredentialJSON matching the web
client's wire shape exactly. ASAuthorizationError.canceled maps to
passkey_cancelled; other errors map to passkey_failed with the
underlying error attached."
```

---

### Task 8: `Transport`

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/Transport.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/MockURLProtocol.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/TransportTests.swift`

- [ ] **Step 1: Create the URLProtocol mock**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/MockURLProtocol.swift`:

```swift
import Foundation

/// URLProtocol subclass used by tests to intercept URLSession requests.
/// Tests register a handler that returns canned (Data, HTTPURLResponse, Error?)
/// for each request URL.
final class MockURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> (Data, HTTPURLResponse)

    static let lock = NSLock()
    private static var _handler: Handler?
    static var handler: Handler? {
        get { lock.lock(); defer { lock.unlock() }; return _handler }
        set { lock.lock(); defer { lock.unlock() }; _handler = newValue }
    }

    /// Last request that arrived at the mock — useful for assertions.
    private static var _lastRequest: URLRequest?
    static var lastRequest: URLRequest? {
        get { lock.lock(); defer { lock.unlock() }; return _lastRequest }
        set { lock.lock(); defer { lock.unlock() }; _lastRequest = newValue }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // Capture the body, since URLProtocol doesn't include it on the request
        // by default for streamed bodies.
        var captured = request
        if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let read = stream.read(buffer, maxLength: 4096)
                if read <= 0 { break }
                data.append(buffer, count: read)
            }
            stream.close()
            captured.httpBody = data
        }
        MockURLProtocol.lastRequest = captured

        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (data, response) = try handler(captured)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    /// Build a configured URLSession that routes through this protocol.
    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    static func reset() {
        handler = nil
        lastRequest = nil
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/TransportTests.swift`:

```swift
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — `Transport`, `EmptyResponse`, `HTTPMethod` do not exist.

- [ ] **Step 4: Implement `Transport.swift`**

Create `clients/PasskeySDK/Sources/PasskeySDK/Transport.swift`:

```swift
import Foundation

enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case delete = "DELETE"
}

/// Empty response type for endpoints whose body the client doesn't read.
public struct EmptyResponse: Decodable, Sendable, Equatable {
    public init() {}
}

struct Transport: Sendable {
    let baseURL: URL
    let session: URLSession
    let storage: any TokenStorage

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()

    func request<T: Decodable>(path: String, method: HTTPMethod, body: (any Encodable)?) async throws -> T {
        let url = composeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        try storage.attach(to: &request)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw AuthClientError(
                code: .network,
                rawCode: "network",
                message: "Network request failed: \(error.localizedDescription)",
                status: nil,
                underlying: error
            )
        }

        guard let http = response as? HTTPURLResponse else {
            throw AuthClientError(
                code: .network,
                rawCode: "network",
                message: "Response was not HTTP",
                status: nil,
                underlying: nil
            )
        }

        if !(200..<300).contains(http.statusCode) {
            // Try to decode {error, message}; fall back to a synthesized message.
            let wire = try? decoder.decode(WireError.self, from: data)
            let rawCode = wire?.error ?? "network"
            let message = wire?.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw AuthClientError(
                code: AuthClientErrorCode(rawString: rawCode),
                rawCode: rawCode,
                message: message,
                status: http.statusCode,
                underlying: nil
            )
        }

        if data.isEmpty, let empty = EmptyResponse() as? T {
            return empty
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw AuthClientError(
                code: .network,
                rawCode: "network",
                message: "Response was not valid JSON",
                status: http.statusCode,
                underlying: error
            )
        }
    }

    private func composeURL(path: String) -> URL {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        // baseURL might or might not have a trailing slash; appendingPathComponent handles that.
        return baseURL.appendingPathComponent(trimmed)
    }
}

/// Type-erasing wrapper that lets us encode any `Encodable` value through JSONEncoder.
private struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void
    init(_ wrapped: any Encodable) {
        self._encode = wrapped.encode
    }
    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
swift test
```

Expected: 12 new transport tests pass; everything from earlier tasks still passes.

- [ ] **Step 6: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/Transport.swift clients/PasskeySDK/Tests/PasskeySDKTests/Helpers/MockURLProtocol.swift clients/PasskeySDK/Tests/PasskeySDKTests/TransportTests.swift
git commit -m "feat(swift): Transport (URLSession wrapper, error mapping)

Composes baseURL + path, sets Content-Type for JSON bodies, calls
storage.attach to add Authorization: Bearer when present, parses 2xx
JSON, maps non-2xx to AuthClientError using the WireError shape, maps
URLError + DecodingError to AuthClientError(.network). MockURLProtocol
gives tests a fake session without standing up a real server."
```

---

## Phase C — Public façade

### Task 9: `AuthClient` email + session methods

**Files:**
- Create: `clients/PasskeySDK/Sources/PasskeySDK/AuthClientConfig.swift`
- Create: `clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientEmailTests.swift`
- Modify: `clients/PasskeySDK/Sources/PasskeySDK/PasskeySDK.swift` (delete the placeholder, since real public API is now in place)

- [ ] **Step 1: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientEmailTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — `AuthClient`, `AuthClientConfig` do not exist.

- [ ] **Step 3: Implement `AuthClientConfig.swift`**

Create `clients/PasskeySDK/Sources/PasskeySDK/AuthClientConfig.swift`:

```swift
import Foundation

public struct AuthClientConfig: Sendable {
    public var baseURL: URL
    public var session: URLSession
    public var storage: any TokenStorage
    public var rpIDOverride: String?

    /// Production initializer. Defaults to KeychainStorage for token persistence
    /// and URLSession.shared for HTTP.
    public init(
        baseURL: URL,
        session: URLSession = .shared,
        keychainService: String = "PasskeySDK",
        keychainAccount: String = "session-token",
        rpIDOverride: String? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.storage = KeychainStorage(service: keychainService, account: keychainAccount)
        self.rpIDOverride = rpIDOverride
    }

    /// Test/advanced initializer. Lets the caller inject a storage implementation
    /// (e.g. InMemoryTokenStorage) without going through the Keychain.
    public init(
        baseURL: URL,
        session: URLSession,
        storage: any TokenStorage,
        rpIDOverride: String? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.storage = storage
        self.rpIDOverride = rpIDOverride
    }
}
```

- [ ] **Step 4: Implement `AuthClient.swift` (email + session methods only)**

Create `clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift`:

```swift
import Foundation

public struct AuthClient: Sendable {
    private let transport: Transport
    private let storage: any TokenStorage
    private let webauthn: WebAuthn

    /// Production initializer. Uses the default ASAuthorizationController-backed
    /// authentication services provider.
    public init(config: AuthClientConfig) {
        self.init(config: config, provider: DefaultAuthenticationServicesProvider())
    }

    /// Test/advanced initializer. Inject a custom AuthenticationServicesProvider.
    public init(config: AuthClientConfig, provider: any AuthenticationServicesProvider) {
        self.transport = Transport(
            baseURL: config.baseURL,
            session: config.session,
            storage: config.storage
        )
        self.storage = config.storage
        let rpId = config.rpIDOverride ?? config.baseURL.host ?? ""
        self.webauthn = WebAuthn(rpId: rpId, provider: provider)
    }

    // MARK: - Email OTP

    public func startEmailSignIn(email: String) async throws -> StartEmailSignInResult {
        try await transport.request(
            path: "/email/start",
            method: .post,
            body: ["email": email]
        )
    }

    public func verifyEmailOtp(otpId: String, code: String) async throws -> VerifyEmailOtpResult {
        let wire: VerifyEmailOtpWireResponse = try await transport.request(
            path: "/email/verify",
            method: .post,
            body: ["otpId": otpId, "code": code]
        )
        try storage.save(wire.sessionToken)
        return VerifyEmailOtpResult(user: wire.user)
    }

    // MARK: - Session

    public func getCurrentUser() async throws -> GetCurrentUserResult {
        try await transport.request(path: "/me", method: .get, body: nil)
    }

    public func signOut() async throws {
        let _: EmptyResponse = try await transport.request(path: "/sign-out", method: .post, body: nil)
        try storage.clear()
    }
}

/// Wire-only response shape for endpoints that issue a session token. The
/// public result types strip the token (it goes into TokenStorage instead).
struct VerifyEmailOtpWireResponse: Decodable {
    let sessionToken: String
    let user: AuthUser
}

struct SignInWithPasskeyWireResponse: Decodable {
    let sessionToken: String
    let user: AuthUser
}
```

- [ ] **Step 5: Delete the placeholder file**

```bash
rm /Users/mattsmith/Documents/Dev/SDKs/Passkey/clients/PasskeySDK/Sources/PasskeySDK/PasskeySDK.swift
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
swift test
```

Expected: 5 new email tests pass; everything from earlier tasks still passes.

- [ ] **Step 7: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift clients/PasskeySDK/Sources/PasskeySDK/AuthClientConfig.swift clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientEmailTests.swift
git rm clients/PasskeySDK/Sources/PasskeySDK/PasskeySDK.swift
git commit -m "feat(swift): AuthClient email + session methods

Public façade composing Transport + storage + WebAuthn. startEmailSignIn,
verifyEmailOtp, getCurrentUser, signOut. The session token from
verifyEmailOtp is stripped from the public result and persisted via
TokenStorage. signOut clears storage after the server call returns
successfully."
```

---

### Task 10: `AuthClient` passkey methods

**Files:**
- Modify: `clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientPasskeyTests.swift`

The test file uses the existing `MockAuthenticationServicesProvider`. Since the iOS `ASAuthorization*` types can't be instantiated directly outside of Apple's framework, the "happy path" tests inject the mock provider with a `.failure` behavior (returning a known `AuthClientError`) — this verifies that the wiring from `AuthClient.registerPasskey` through `WebAuthn.performRegistration` to the provider seam is correct, even though we can't synthesize a real `ASAuthorizationPlatformPublicKeyCredentialRegistration` to test the success path. The success path is exercised manually via the demo app and is incidentally covered by Task 7's encoding tests.

- [ ] **Step 1: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientPasskeyTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — `registerPasskey`, `signInWithPasskey` do not exist on `AuthClient`.

- [ ] **Step 3: Add passkey methods to `AuthClient.swift`**

Edit `clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift`. Add the methods inside the `AuthClient` struct, after `signOut()`:

```swift
    // MARK: - Passkey

    public func registerPasskey(deviceName: String? = nil) async throws -> RegisterPasskeyResult {
        struct StartResponse: Decodable {
            let registrationId: String
            let options: ServerCreationOptions
        }
        let start: StartResponse = try await transport.request(
            path: "/passkey/register/start",
            method: .post,
            body: nil
        )
        let credential = try await webauthn.performRegistration(opts: start.options)

        var body: [String: Any] = [
            "registrationId": start.registrationId,
            "credential": credential.asJSONObject(),
        ]
        if let deviceName {
            body["deviceName"] = deviceName
        }
        return try await transport.request(
            path: "/passkey/register/finish",
            method: .post,
            body: AnyJSONObject(body)
        )
    }

    public func signInWithPasskey() async throws -> SignInWithPasskeyResult {
        struct StartResponse: Decodable {
            let signInId: String
            let options: ServerRequestOptions
        }
        let start: StartResponse = try await transport.request(
            path: "/passkey/sign-in/start",
            method: .post,
            body: nil
        )
        let credential = try await webauthn.performSignIn(opts: start.options)

        let body: [String: Any] = [
            "signInId": start.signInId,
            "credential": credential.asJSONObject(),
        ]
        let wire: SignInWithPasskeyWireResponse = try await transport.request(
            path: "/passkey/sign-in/finish",
            method: .post,
            body: AnyJSONObject(body)
        )
        try storage.save(wire.sessionToken)
        return SignInWithPasskeyResult(user: wire.user)
    }
```

Then, at the bottom of the same file, add the helper that lets `Transport` send a `[String: Any]` body (we need this because `PublicKeyCredentialJSON.asJSONObject()` returns `[String: Any]` to match the web client's nil-omission behavior):

```swift
/// Encodable wrapper for [String: Any] that uses JSONSerialization to
/// preserve nil-omission behavior. Only allows JSON-compatible values.
struct AnyJSONObject: Encodable {
    let object: [String: Any]

    init(_ object: [String: Any]) {
        self.object = object
    }

    func encode(to encoder: Encoder) throws {
        // Bridge through JSONSerialization to handle [String: Any] which
        // standard Encodable can't.
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        // Re-decode into a generic JSON value tree and re-encode through the
        // standard Encoder so JSONEncoder's keyEncoding / dateEncoding (none
        // configured here) apply consistently.
        let json = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        try AnyJSONValue(value: json).encode(to: encoder)
    }
}

private struct AnyJSONValue: Encodable {
    let value: Any

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let v as String: try container.encode(v)
        case let v as Int: try container.encode(v)
        case let v as Double: try container.encode(v)
        case let v as Bool: try container.encode(v)
        case let v as [Any]:
            try container.encode(v.map { AnyJSONValue(value: $0) })
        case let v as [String: Any]:
            try container.encode(v.mapValues { AnyJSONValue(value: $0) })
        case is NSNull:
            try container.encodeNil()
        default:
            throw EncodingError.invalidValue(
                value,
                EncodingError.Context(codingPath: encoder.codingPath, debugDescription: "Unsupported JSON value")
            )
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
swift test
```

Expected: 3 new passkey tests pass; everything from earlier tasks still passes.

- [ ] **Step 5: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientPasskeyTests.swift
git commit -m "feat(swift): AuthClient passkey methods

registerPasskey + signInWithPasskey orchestrate start → provider call
→ finish. AnyJSONObject lets Transport send the [String: Any] body
that PublicKeyCredentialJSON.asJSONObject() produces (matches the web
client's nil-omission wire shape). Tests verify the wiring up to the
provider seam — the success path requires real ASAuthorization values
which Apple's framework doesn't let us synthesize, so it's covered
manually via the demo app."
```

---

### Task 11: `AuthClient` management methods

**Files:**
- Modify: `clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift`
- Create: `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientManagementTests.swift`

- [ ] **Step 1: Write the failing tests**

Create `clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientManagementTests.swift`:

```swift
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
swift test
```

Expected: build error — `listSessions`, `listPasskeys`, `deletePasskey` do not exist.

- [ ] **Step 3: Add management methods to `AuthClient.swift`**

Append inside the `AuthClient` struct, after the passkey methods:

```swift
    // MARK: - Management

    public func listSessions() async throws -> ListSessionsResult {
        try await transport.request(path: "/sessions", method: .get, body: nil)
    }

    public func listPasskeys() async throws -> ListPasskeysResult {
        try await transport.request(path: "/passkeys", method: .get, body: nil)
    }

    public func deletePasskey(id: String) async throws {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(.init(charactersIn: "/+="))) ?? id
        let _: EmptyResponse = try await transport.request(
            path: "/passkeys/\(encoded)",
            method: .delete,
            body: nil
        )
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
swift test
```

Expected: 5 new management tests pass; everything from earlier tasks still passes.

- [ ] **Step 5: Build the package as a final smoke check**

```bash
swift build
```

Expected: clean build, no warnings beyond expected ones.

- [ ] **Step 6: Commit**

```bash
git add clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift clients/PasskeySDK/Tests/PasskeySDKTests/AuthClientManagementTests.swift
git commit -m "feat(swift): AuthClient listSessions, listPasskeys, deletePasskey

Round out the public surface. deletePasskey URL-encodes the id (mirrors
the web client) — defensive, since current base64url ids don't include
special chars but a future format change shouldn't break the route."
```

---

## Phase D — Demo app

### Task 12: Create demo source files + README

The demo's `.xcodeproj` is created manually by the user via Xcode (documented in the README). We commit only the Swift source + Info.plist so future contributors can drop them into a fresh project.

**Files:**
- Create: `clients/ios-demo/README.md`
- Create: `clients/ios-demo/Sources/ios_demoApp.swift`
- Create: `clients/ios-demo/Sources/ContentView.swift`
- Create: `clients/ios-demo/Sources/Info.plist`

- [ ] **Step 1: Create the demo's `README.md`**

Create `clients/ios-demo/README.md`:

```markdown
# ios-demo

Reference SwiftUI app exercising every public method on `PasskeySDK` against the local `examples/hono-app`. Manual run target — there are no automated tests.

## Run against the simulator

1. **Start the server.** From the repo root:
   ```bash
   PORT=3001 NODE_ENV=test pnpm --filter hono-app-example dev
   ```
   The app starts on `http://localhost:3001`. `NODE_ENV=test` mounts the `/__test/last-otp` peek endpoint — handy for grabbing the OTP without checking the server logs.

2. **Open the demo in Xcode.** No `.xcodeproj` is committed (auto-generated metadata is brittle to share across machines). Create one once:
   - File → New → Project → iOS → App.
   - Product Name: `ios-demo`. Interface: SwiftUI. Language: Swift.
   - Save it inside `clients/ios-demo/` (or anywhere — the `.xcodeproj` is gitignored).
   - Delete the auto-generated `ContentView.swift`, `<name>App.swift`, and `Info.plist` from the project.
   - Drag in `Sources/ContentView.swift`, `Sources/ios_demoApp.swift`, and `Sources/Info.plist` from this directory.
   - Add the local Swift Package: File → Add Package Dependencies… → Add Local… → select `../PasskeySDK`.
   - Set the target's deployment target to iOS 26.

3. **Build and run** in any iOS 26 Simulator. The demo's `baseURL` points at `http://localhost:3001/auth`, which the simulator can reach over the host's loopback.

4. **Walk through the buttons** in any order. The status pane shows the latest result or error.

## Real-device runs

Real devices need:
- A real domain with HTTPS (e.g. `https://auth.example.com/auth`). Local-tunnel tools like Cloudflared work for development.
- An AASA file at `https://<apex>/.well-known/apple-app-site-association` (the SDK's `auth.appleAppSiteAssociation` helper produces it).
- An `Associated Domains` capability in Xcode → Signing & Capabilities, with entries `webcredentials:<apex>` and `applinks:<apex>`.
- `AuthClientConfig.rpIDOverride` set to `<apex>` so the RP ID matches what the AASA file declares.

Real-device testing is **not** part of Phase 3 acceptance — the simulator path is the default. This section is here for users who want to take the demo further.

## What's wired up

Every public `AuthClient` method has a button:

- **Email OTP**: Send OTP, Verify OTP (uses the `/__test/last-otp` peek endpoint to pre-fill the code field — saves a copy/paste).
- **Passkey**: Register, Sign In, Delete.
- **Session**: Get Current User, Sign Out, List Sessions, List Passkeys.

Errors are formatted as `ERROR <code>: <message>` in the status pane.
```

- [ ] **Step 2: Create `Sources/ios_demoApp.swift`**

Create `clients/ios-demo/Sources/ios_demoApp.swift`:

```swift
import SwiftUI

@main
struct ios_demoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

- [ ] **Step 3: Create `Sources/ContentView.swift`**

Create `clients/ios-demo/Sources/ContentView.swift`:

```swift
import SwiftUI
import PasskeySDK

struct ContentView: View {
    @State private var email = ""
    @State private var otp = ""
    @State private var status = "(no output yet)"
    @State private var pendingOtpId: String?
    @State private var pendingPasskeyId: String?

    private let client: AuthClient = {
        AuthClient(config: AuthClientConfig(
            baseURL: URL(string: "http://localhost:3001/auth")!
        ))
    }()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                section("Email OTP") {
                    TextField("you@example.com", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Button("Send OTP") { Task { await sendOTP() } }
                        Button("Peek OTP") { Task { await peekOTP() } }
                            .disabled(email.isEmpty)
                    }
                    TextField("6-digit code", text: $otp)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                    Button("Verify OTP") { Task { await verifyOTP() } }
                }

                section("Passkey") {
                    Button("Register Passkey") { Task { await registerPasskey() } }
                    Button("Sign in with Passkey") { Task { await signInWithPasskey() } }
                    Button("Delete Passkey") { Task { await deletePasskey() } }
                        .disabled(pendingPasskeyId == nil)
                }

                section("Session") {
                    Button("Get Current User") { Task { await getCurrentUser() } }
                    Button("Sign Out") { Task { await signOut() } }
                    Button("List Sessions") { Task { await listSessions() } }
                    Button("List Passkeys") { Task { await listPasskeys() } }
                }

                section("Status") {
                    Text(status)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background(Color.gray.opacity(0.1))
                        .cornerRadius(4)
                }
            }
            .padding()
        }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content()
        }
        .padding(12)
        .background(Color.gray.opacity(0.05))
        .cornerRadius(8)
    }

    // MARK: - Actions

    private func sendOTP() async {
        do {
            let r = try await client.startEmailSignIn(email: email)
            pendingOtpId = r.otpId
            show("startEmailSignIn", "otpId=\(r.otpId), expiresInSeconds=\(r.expiresInSeconds)")
        } catch { show("startEmailSignIn", error) }
    }

    private func peekOTP() async {
        do {
            guard !email.isEmpty else { return }
            let url = URL(string: "http://localhost:3001/__test/last-otp?email=\(email.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? email)")!
            let (data, _) = try await URLSession.shared.data(from: url)
            struct PeekResponse: Decodable { let code: String }
            let response = try JSONDecoder().decode(PeekResponse.self, from: data)
            otp = response.code
            show("peekOTP", "filled otp=\(response.code)")
        } catch {
            show("peekOTP", error)
        }
    }

    private func verifyOTP() async {
        do {
            guard let otpId = pendingOtpId else {
                show("verifyEmailOtp", "no pending otpId")
                return
            }
            let r = try await client.verifyEmailOtp(otpId: otpId, code: otp)
            show("verifyEmailOtp", "user=\(r.user.id) email=\(r.user.email)")
        } catch { show("verifyEmailOtp", error) }
    }

    private func registerPasskey() async {
        do {
            let r = try await client.registerPasskey(deviceName: "iPhone Simulator")
            pendingPasskeyId = r.passkeyId
            show("registerPasskey", "passkeyId=\(r.passkeyId)")
        } catch { show("registerPasskey", error) }
    }

    private func signInWithPasskey() async {
        do {
            let r = try await client.signInWithPasskey()
            show("signInWithPasskey", "user=\(r.user.id)")
        } catch { show("signInWithPasskey", error) }
    }

    private func deletePasskey() async {
        do {
            guard let id = pendingPasskeyId else {
                show("deletePasskey", "no pending passkeyId")
                return
            }
            try await client.deletePasskey(id: id)
            show("deletePasskey", "ok (\(id))")
            pendingPasskeyId = nil
        } catch { show("deletePasskey", error) }
    }

    private func getCurrentUser() async {
        do {
            let r = try await client.getCurrentUser()
            show("getCurrentUser", "user=\(r.user.id) email=\(r.user.email)")
        } catch { show("getCurrentUser", error) }
    }

    private func signOut() async {
        do {
            try await client.signOut()
            show("signOut", "ok")
        } catch { show("signOut", error) }
    }

    private func listSessions() async {
        do {
            let r = try await client.listSessions()
            show("listSessions", "\(r.sessions.count) session(s)")
        } catch { show("listSessions", error) }
    }

    private func listPasskeys() async {
        do {
            let r = try await client.listPasskeys()
            show("listPasskeys", r.passkeys.map { "\($0.id) \($0.deviceName ?? "?")" }.joined(separator: "\n"))
        } catch { show("listPasskeys", error) }
    }

    // MARK: - Status helpers

    private func show(_ label: String, _ payload: String) {
        status = "[\(label)] \(payload)"
    }

    private func show(_ label: String, _ error: any Error) {
        if let e = error as? AuthClientError {
            status = "[\(label)] ERROR \(e.rawCode): \(e.message)"
        } else {
            status = "[\(label)] ERROR \(error.localizedDescription)"
        }
    }
}

#Preview {
    ContentView()
}
```

- [ ] **Step 4: Create `Sources/Info.plist`**

Create `clients/ios-demo/Sources/Info.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>$(DEVELOPMENT_LANGUAGE)</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>UIApplicationSceneManifest</key>
    <dict>
        <key>UIApplicationSupportsMultipleScenes</key>
        <false/>
    </dict>
    <key>UILaunchScreen</key>
    <dict/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <!-- Allow http://localhost in Simulator dev runs. Real devices use HTTPS only. -->
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
    <!-- For real-device runs, add com.apple.developer.associated-domains in
         the entitlements file (not here): webcredentials:<apex>, applinks:<apex>. -->
</dict>
</plist>
```

- [ ] **Step 5: Verify the package still builds (no impact from demo files)**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey/clients/PasskeySDK
swift test
```

Expected: all PasskeySDK tests still pass; the demo files don't affect the package.

- [ ] **Step 6: Commit**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
git add clients/ios-demo
git commit -m "feat(clients): ios-demo SwiftUI app + setup README

Reference consumer of PasskeySDK exercising every public method
against examples/hono-app on localhost:3001 in the iOS Simulator.
The .xcodeproj is created manually by the user (auto-generated
Xcode metadata is brittle to share); README.md walks through the
one-time setup. Source files mirror examples/web-demo's flow."
```

---

## Phase E — iOS Simulator verification + wrap-up

### Task 13: Run the test suite on the iOS Simulator

`swift test` runs the suite on macOS. We also need to verify it passes on the iOS toolchain, since the package targets iOS 26 and uses `AuthenticationServices` (which has slightly different surface across Apple platforms).

**Files:** None modified — this is a verification task.

- [ ] **Step 1: List available iOS Simulator destinations**

```bash
xcrun simctl list devices available | head -40
```

If no iOS 26 Simulator is available, install one via Xcode → Settings → Components, then retry. If `xcrun` itself is missing, Xcode isn't installed — STOP and report.

- [ ] **Step 2: Run the test suite on iOS Simulator**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey/clients/PasskeySDK
xcodebuild test \
    -scheme PasskeySDK \
    -destination "platform=iOS Simulator,OS=26.0" \
    | tee /tmp/passkey-sdk-ios-test.log
```

Expected: TEST SUCCEEDED. All ~45 tests pass on the iOS Simulator just as they do on macOS.

If `-scheme PasskeySDK` is unrecognized (SwiftPM packages auto-generate a scheme named after the package), try `-scheme PasskeySDK-Package` or run `xcodebuild -list` from the package directory to see the available schemes.

If the suite passes on macOS but fails on the iOS Simulator, the difference is likely an availability annotation we missed. Read the failing test's output and report — do not silently downgrade.

- [ ] **Step 3: No commit**

This task is a verification gate. Only proceed if the suite passes on iOS.

---

### Task 14: Update root README + write completion notes + update memory

**Files:**
- Modify: `/Users/mattsmith/Documents/Dev/SDKs/Passkey/README.md`
- Create: `/Users/mattsmith/Documents/Dev/SDKs/Passkey/clients/PasskeySDK/README.md`
- Create: `/Users/mattsmith/Documents/Dev/SDKs/Passkey/docs/superpowers/notes/2026-05-04-phase-3-completion.md`
- Modify: `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/passkey-sdk-phase-1.md`
- Modify: `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/MEMORY.md`

- [ ] **Step 1: Update root `README.md`**

Edit `/Users/mattsmith/Documents/Dev/SDKs/Passkey/README.md`. Find the Status section:

```markdown
## Status

- **Phase 1 — TypeScript server:** shipped (`packages/core`, `packages/hono`, `packages/cli`).
- **Phase 2 — Web client:** shipped (`packages/client-web`) plus cookie-mode prerequisites on the server (CSRF middleware, `Secure` cookies, threaded `Max-Age`).
- **Phase 3 — Swift / iOS client:** planned.
```

Replace with:

```markdown
## Status

- **Phase 1 — TypeScript server:** shipped (`packages/core`, `packages/hono`, `packages/cli`).
- **Phase 2 — Web client:** shipped (`packages/client-web`) plus cookie-mode prerequisites on the server (CSRF middleware, `Secure` cookies, threaded `Max-Age`).
- **Phase 3 — Swift / iOS client:** shipped (`clients/PasskeySDK`) plus a SwiftUI demo (`clients/ios-demo`).
```

Find the Packages table and add a row at the bottom:

Existing table ends with:
```markdown
| [`@mattsmith/passkey-sdk-client-web`](packages/client-web) | Browser client: `fetch` + `navigator.credentials` wrapper, typed errors, cookie/header session modes. |
```

Add below:
```markdown
| [`PasskeySDK`](clients/PasskeySDK) (Swift) | Native iOS / macOS client: `URLSession` + `AuthenticationServices` + Keychain. Bearer-mode only. |
```

Find the Examples table and add:
```markdown
| [`clients/ios-demo`](clients/ios-demo) | SwiftUI app exercising every public method of `PasskeySDK`. Manual run target. |
```

Find the Repository layout block and update it to:

```
Passkey/
├── spec/protocol.md              # The HTTP contract — source of truth
├── packages/
│   ├── core/                     # Server: pure functions, no HTTP
│   ├── hono/                     # Server: Hono adapter
│   ├── cli/                      # Server: migration CLI
│   └── client-web/               # Browser client
├── clients/
│   ├── PasskeySDK/               # Swift Package — native iOS / macOS client
│   └── ios-demo/                 # SwiftUI demo
├── examples/
│   ├── hono-app/                 # Reference server
│   └── web-demo/                 # Reference web client + Playwright e2e
└── docs/superpowers/
    ├── specs/                    # Design specs
    ├── plans/                    # Implementation plans
    └── notes/                    # Per-phase completion notes
```

- [ ] **Step 2: Create the package's `README.md`**

Create `clients/PasskeySDK/README.md`:

```markdown
# PasskeySDK

Native Swift client for the Passkey SDK. Wraps `URLSession` for HTTP, `AuthenticationServices` for WebAuthn ceremonies, and Keychain for session-token persistence. Bearer-mode only — iOS apps don't have first-class browser-cookie semantics, and the server's bearer mode bypasses CSRF entirely.

The HTTP contract is documented in [`../../spec/protocol.md`](../../spec/protocol.md).

## Install

In your `Package.swift`:

```swift
.package(url: "https://github.com/<your-org>/Passkey", from: "0.0.0"),
// or as a local path:
.package(path: "../path/to/Passkey/clients/PasskeySDK"),
```

Or via Xcode: File → Add Package Dependencies… → Add Local… and pick this directory.

No third-party runtime dependencies — only Foundation, Security, and AuthenticationServices.

## Usage

```swift
import PasskeySDK

let client = AuthClient(config: AuthClientConfig(
    baseURL: URL(string: "https://api.example.com/auth")!
))

// Email OTP
let start = try await client.startEmailSignIn(email: "matt@example.com")
let verified = try await client.verifyEmailOtp(otpId: start.otpId, code: "482917")

// Passkey
let registered = try await client.registerPasskey(deviceName: "iPhone 15")
let signedIn = try await client.signInWithPasskey()

// Session + management
let me = try await client.getCurrentUser()
let sessions = try await client.listSessions()
let passkeys = try await client.listPasskeys()
try await client.deletePasskey(id: registered.passkeyId)
try await client.signOut()
```

## Configuration

```swift
public struct AuthClientConfig {
    public init(
        baseURL: URL,
        session: URLSession = .shared,
        keychainService: String = "PasskeySDK",
        keychainAccount: String = "session-token",
        rpIDOverride: String? = nil
    )
}
```

`rpIDOverride` is the iOS-specific knob. By default the SDK derives the WebAuthn RP ID from `baseURL.host`. Real-device deployments often diverge the API host from the RP ID (e.g. `api.example.com` for fetches, `example.com` for the RP ID — the apex declared in the AASA file); `rpIDOverride` lets the caller name it explicitly.

## Errors

Every method can throw `AuthClientError`:

```swift
do {
    let r = try await client.verifyEmailOtp(otpId: otpId, code: code)
} catch let e as AuthClientError {
    switch e.code {
    case .invalidOtp:           // wrong code
    case .otpAttemptsExceeded:  // too many tries
    case .otpExpired:           // 10-min window passed
    case .passkeyCancelled:     // user dismissed prompt / aborted
    case .network:              // URLSession failed / non-JSON response
    case .unsupported:          // running on a platform without AuthenticationServices
    // … etc.
    default: break
    }
}
```

The full set: every server protocol code (see [`../../spec/protocol.md`](../../spec/protocol.md)) plus client-only `network`, `passkeyCancelled`, `passkeyFailed`, `unsupported`, and `unknown` (for forward-compat with new server codes — `rawCode` carries the verbatim string).

## Tests

```bash
cd clients/PasskeySDK
swift test
# or for iOS Simulator:
xcodebuild test -scheme PasskeySDK -destination "platform=iOS Simulator,OS=26.0"
```

`URLProtocol` mocks the HTTP layer; an `AuthenticationServicesProvider` protocol seam mocks the WebAuthn ceremony. `KeychainStorage` is verified manually via the demo app — headless XCTest hosts have unreliable Keychain access.
```

- [ ] **Step 3: Write Phase 3 completion notes**

Create `docs/superpowers/notes/2026-05-04-phase-3-completion.md`:

```markdown
# Passkey SDK — Phase 3 Completion Notes

**Date:** 2026-05-04
**Status:** Phase 3 (Swift / iOS client) shipped. All 14 tasks of `docs/superpowers/plans/2026-05-04-passkey-sdk-phase-3-swift.md` complete.
**Branch:** `main` (clean tree, all commits direct to main)

---

## TL;DR for future phases

The HTTP contract from `spec/protocol.md` now has two reference client implementations:

- `packages/client-web` — TypeScript / browser, both cookie and header modes.
- `clients/PasskeySDK` — Swift / iOS / macOS, header (bearer) mode only.

Both consume identical wire shapes for passkey ceremonies. Future client implementations (Android, Go, etc.) should mirror the same façade pattern: 9 methods, two-step ceremonies, `AuthClientError` with the same code union, opaque session-token storage stripped from public results.

The cross-platform contract conformance suite (deferred from Phase 2 and 3) would now actually pay off — two clients agreeing on every wire shape would catch drift if a third lands. Still optional.

---

## What's in Phase 3

- **`clients/PasskeySDK`** — Swift Package, iOS 26 / macOS 26 deployment targets, no third-party runtime deps. Public surface: `AuthClient`, `AuthClientConfig`, `AuthClientError` + `AuthClientErrorCode`, `AuthUser`, all `*Result` types, `TokenStorage` protocol + `KeychainStorage` + `InMemoryTokenStorage`, `AuthenticationServicesProvider` (the test seam).
- **`clients/ios-demo`** — SwiftUI single-screen reference app exercising every public method against `examples/hono-app` on `localhost:3001`. The `.xcodeproj` is user-generated; only sources are committed.
- **Server changes:** none. The server's bearer mode + protocol error codes were already complete after Phase 2.1.

---

## Test counts (verified)

| Suite | Tests | Covers |
|---|---|---|
| `Base64URLTests` | 7 | round-trip, padding, URL-safe alphabet |
| `AuthClientErrorTests` | 6 | code parsing, raw code preservation, throwability, WireError decode |
| `TypesTests` | 6 | every Decodable result type, nullable fields |
| `TokenStorageTests` | 5 | InMemoryTokenStorage CRUD + attach |
| `WebAuthnCeremonyTests` | 7 | ServerCreationOptions/RequestOptions decode, PublicKeyCredentialJSON encode shape, error mapping (cancel + fail), RP ID propagation |
| `TransportTests` | 12 | URL composition, content-type, header attach, success decode, error mapping (known + unknown codes), network failure, malformed JSON, empty body, DELETE |
| `AuthClientEmailTests` | 5 | startEmailSignIn / verifyEmailOtp / getCurrentUser / signOut, token persistence + clearing, error surfacing |
| `AuthClientPasskeyTests` | 3 | register/sign-in flow up to provider seam, unauthenticated short-circuit |
| `AuthClientManagementTests` | 5 | listSessions / listPasskeys / deletePasskey, URL encoding, unknown_credential mapping |
| `SmokeTests` | 1 | package builds |

**Total: 57 XCTest cases.** All pass on macOS via `swift test` and on iOS Simulator via `xcodebuild test`.

---

## Key deviations from the plan

These deviations are load-bearing — any future Swift work needs to know them.

### 1. WebAuthn happy-path is not unit-tested

Apple's `ASAuthorization*` credential types can't be synthesized in tests outside the framework — there's no public initializer that accepts raw bytes. The plan calls this out explicitly: success-path coverage comes from manual demo runs, not from XCTest. The unit tests verify everything up to the provider seam (input encoding, RP ID propagation, error mapping).

If someone wants automated success-path coverage in the future, the path would be a UI test with an actual virtual authenticator (analogous to Playwright's WebDriver-BiDi virtual authenticator) — but iOS has no equivalent today.

### 2. `KeychainStorage` is not unit-tested

Headless XCTest hosts (`swift test` and `xcodebuild test` against the Simulator without a hosting app) have unreliable Keychain access. The implementation is small (one generic-password entry), the API surface is thin (load/save/clear/attach), and the demo app verifies it manually. If real Keychain coverage is needed later, the path is to host the tests in a small XCUITest target.

### 3. `AnyJSONObject` exists for nil-omission JSON encoding

Swift's `JSONEncoder` emits `null` for nil-valued optionals, but the web client's `PublicKeyCredentialJSON` encoder omits them entirely. To keep wire-shape parity (server's `@simplewebauthn/server` v10 is fine with both, but parity matters for the cross-platform conformance story), `PublicKeyCredentialJSON.asJSONObject()` returns `[String: Any]` and we send it via the `AnyJSONObject` Encodable wrapper that bridges through `JSONSerialization`. See `clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift` for the helper.

### 4. `ASAuthorizationControllerDelegate` continuation requires retain

`ASAuthorizationController` holds its `delegate` weakly. The bridge-based async/await wrapper attaches the delegate to the controller via `objc_setAssociatedObject` to keep it alive for the duration of the call. See `DefaultAuthenticationServicesProvider` in `AuthenticationServicesProvider.swift`.

### 5. `Info.plist` allows local networking

The demo's Info.plist has `NSAllowsLocalNetworking: true` so the Simulator can reach `http://localhost:3001`. Real-device builds should remove this (HTTPS-only) — documented in `clients/ios-demo/README.md`.

---

## Tech stack chosen

- **Swift 6 toolchain, Swift 5 language mode** (deferred strict concurrency to a future phase per the design spec).
- **SwiftPM** — single library product, no third-party deps. Test target `PasskeySDKTests`.
- **`URLSession` + `URLProtocol`** for HTTP and HTTP mocking.
- **`AuthenticationServices`** for WebAuthn. `ASAuthorizationPlatformPublicKeyCredentialProvider` registration + assertion requests.
- **`Security`** for Keychain (generic-password class, accessible-after-first-unlock).
- **SwiftUI** for the demo (state held with `@State`, async actions in `Task { ... }`).

---

## Public API surface (the durable contract)

```swift
public struct AuthClient {
    public init(config: AuthClientConfig)
    public func startEmailSignIn(email: String) async throws -> StartEmailSignInResult
    public func verifyEmailOtp(otpId: String, code: String) async throws -> VerifyEmailOtpResult
    public func registerPasskey(deviceName: String? = nil) async throws -> RegisterPasskeyResult
    public func signInWithPasskey() async throws -> SignInWithPasskeyResult
    public func getCurrentUser() async throws -> GetCurrentUserResult
    public func signOut() async throws
    public func listSessions() async throws -> ListSessionsResult
    public func listPasskeys() async throws -> ListPasskeysResult
    public func deletePasskey(id: String) async throws
}
```

Method names track `@mattsmith/passkey-sdk-client-web` exactly. Argument shapes use Swift idioms (positional with defaults, throwing async). Errors are `AuthClientError` whose `code` mirrors the web client's union.

---

## How to run things

```bash
# Build the Swift Package
cd clients/PasskeySDK
swift build

# Run the unit tests on macOS (~57 tests, sub-second)
swift test

# Run the unit tests on iOS Simulator
xcodebuild test -scheme PasskeySDK -destination "platform=iOS Simulator,OS=26.0"
```

Run the demo:

```bash
# In one terminal:
PORT=3001 NODE_ENV=test pnpm --filter hono-app-example dev

# In another: open clients/ios-demo/ in Xcode, follow the demo README,
# build the Simulator target, walk through the buttons.
```

---

## Open items / things to revisit later

- Real-device testing (AASA + Associated Domains + a real apex domain). Documented in the demo README; not part of acceptance.
- App-Group Keychain sharing (multi-target apps wanting one shared session).
- Multi-account support (single `AuthClient` is single-account; second account = second `AuthClient` with a different `keychainAccount`). YAGNI for v0.
- Strict Swift 6 concurrency. All public types are `Sendable` so adopting strict concurrency later should be mechanical.
- A SwiftPM-hosted XCUITest target to automate Keychain + Authentication Services coverage if anyone wants it badly enough.
- The shared cross-platform conformance suite that's been deferred since Phase 2. With two clients now, it would actually pay off.
- A future Android / Go / Rust client mirroring the same façade. The protocol contract supports it; nothing in Phase 3 closes that door.

---

## Files future phases should read first

1. `Passkey/spec/protocol.md` — the contract.
2. `Passkey/clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift` — the public façade pattern, now established in two languages.
3. `Passkey/clients/PasskeySDK/Sources/PasskeySDK/WebAuthn.swift` — the wire-shape encoder for `PublicKeyCredentialJSON`. New clients on other platforms must produce the same shape.
4. `Passkey/packages/client-web/src/client.ts` — TypeScript counterpart of the same façade. Use as cross-reference.
5. `Passkey/docs/superpowers/notes/2026-05-04-phase-2-completion.md` + `…-phase-1-completion.md` — server gotchas + web client deviations, all still relevant.
6. `Passkey/CLAUDE.md` — repo conventions.
```

- [ ] **Step 4: Update memory file**

Replace contents of `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/passkey-sdk-phase-1.md`:

```markdown
---
name: Passkey SDK Phase 3 status
description: Phase 3 (Swift / iOS client) of the Passkey SDK shipped 2026-05-04; pointers to the contract doc, completion notes, and entry points for future client implementations
type: project
---
The Passkey SDK at `/Users/mattsmith/Documents/Dev/SDKs/Passkey` shipped Phase 3 on 2026-05-04. Three phases are now on `main` with a clean tree:

- Phase 1: TypeScript server (`packages/{core,hono,cli}`).
- Phase 2: Web client (`packages/client-web`) + cookie-mode prerequisites + Phase 2.1 follow-ups.
- Phase 3: Swift / iOS client (`clients/PasskeySDK`) + SwiftUI demo (`clients/ios-demo`).

**Why:** Two reference client implementations of the same HTTP contract now exist. A future Phase 4 (Android, Go, Rust, conformance suite, …) is open but not scheduled.

**How to apply:** Before starting any future client work or modifying the contract, read these in order (paths relative to `/Users/mattsmith/Documents/Dev/SDKs/`):
1. `Passkey/docs/superpowers/notes/2026-05-04-phase-3-completion.md` — most recent state, Swift-side gotchas
2. `Passkey/docs/superpowers/notes/2026-05-04-phase-2-completion.md` — web-client deviations
3. `Passkey/docs/superpowers/notes/2026-05-04-phase-1-completion.md` — server-side gotchas
4. `Passkey/spec/protocol.md` — the durable HTTP contract
5. `Passkey/clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift` and `Passkey/packages/client-web/src/client.ts` — paired references for the public façade

**Workflow:** Working directly on `main` is the convention (single-dev personal repo, user authorized). Apply the same pattern unless told otherwise.
```

- [ ] **Step 5: Update `MEMORY.md`**

Edit `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/MEMORY.md`. Find the line:

```markdown
- [Passkey SDK Phase 2 status](passkey-sdk-phase-1.md) — Phase 2 web client + cookie-mode prereqs shipped 2026-05-04; read completion notes before starting Phase 3 (Swift)
```

Replace with:

```markdown
- [Passkey SDK Phase 3 status](passkey-sdk-phase-1.md) — Phase 3 Swift / iOS client shipped 2026-05-04; two reference clients of the HTTP contract now exist; future client work should mirror the same façade
```

(Filename in the link stays stable.)

- [ ] **Step 6: Final all-green verification**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
pnpm typecheck
pnpm test
pnpm --filter hono-app-example test
cd clients/PasskeySDK
swift build
swift test
```

Expected: every command succeeds. The Playwright e2e and the iOS Simulator test (Task 13) were verified earlier; no need to re-run unless something changed.

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
git status --short
```

Expected: clean working tree (memory files are outside the repo and not in git).

- [ ] **Step 7: Commit**

```bash
git add README.md clients/PasskeySDK/README.md docs/superpowers/notes/2026-05-04-phase-3-completion.md
git commit -m "docs: phase-3 completion notes + README updates

Top-level README marks Phase 3 as shipped and documents the new
clients/ tree. clients/PasskeySDK gets its own README with install,
usage, configuration, and error-handling guidance. The phase-3
completion notes capture the test-count breakdown, deviations from
the plan (no WebAuthn happy-path unit tests, no Keychain unit tests,
the AnyJSONObject helper, the ASAuthorizationController delegate
retain), and the open items left for future phases."
```

- [ ] **Step 8: Done**

Phase 3 is complete. Project memory points future client phases at the right artifacts. Two reference client implementations of the HTTP contract now exist on `main` with a clean tree.

---

## Self-Review (executed during plan write)

**Spec coverage:**

| Spec section | Implemented in |
|---|---|
| Repo additions: `clients/PasskeySDK` package | Tasks 1–11 |
| Repo additions: `clients/ios-demo` SwiftUI app | Task 12 |
| Public API (9 methods + types) | Tasks 9 (email + session), 10 (passkey), 11 (management) |
| `AuthClientConfig` struct | Task 9 |
| `AuthClientError` + code enum + `WireError` | Task 2 |
| Result types (`AuthUser`, etc.) | Task 3 |
| Base64URL codec | Task 4 |
| `TokenStorage` protocol + `KeychainStorage` + `InMemoryTokenStorage` | Task 5 |
| `AuthenticationServicesProvider` + default impl | Task 6 |
| WebAuthn ceremony orchestrators + `PublicKeyCredentialJSON` | Task 7 |
| `Transport` (URLSession + error mapping) | Task 8 |
| Test strategy (URLProtocol + provider mock + ~45 tests) | Tasks 4–11 (~57 tests total) |
| Demo app | Task 12 |
| iOS Simulator verification | Task 13 |
| README + completion notes + memory update | Task 14 |
| Acceptance criteria | Tasks 11 (build), 13 (iOS sim), 14 (memory + notes) |

All spec sections have a corresponding task. Test count is 57 (the spec said ~45) — the codec and types tasks have a couple more cases each than the spec sketched, which is fine.

**Placeholder scan:** No "TBD", "TODO", "implement later", "Add appropriate error handling", or "Similar to Task N" appears in this plan. The complete file contents are present in every step that creates a Swift file. Conditional language ("if `xcrun` is missing, STOP and report") is a documented escape hatch, not a placeholder.

**Type consistency:**

- `AuthClient` introduced in Task 9, extended in Tasks 10 and 11 — no rename or signature change.
- `AuthClientConfig` introduced in Task 9, used unchanged thereafter.
- `AuthClientError`/`AuthClientErrorCode` from Task 2, consumed by every subsequent task. Codes used in tests match the enum (`.invalidOtp`, `.unauthenticated`, `.unknownCredential`, `.passkeyCancelled`, `.passkeyFailed`, `.network`, `.unknown`). All present in Task 2's enum.
- `TokenStorage` from Task 5, conformed to by `InMemoryTokenStorage` (Task 5) and `KeychainStorage` (Task 5). `AuthClientConfig.storage` references the protocol existentially. Consistent.
- `AuthenticationServicesProvider` from Task 6, consumed by `WebAuthn` (Task 7) and `AuthClient.init(config:provider:)` (Task 9). Mock from Task 6 used in Tasks 7, 10, 11.
- `Transport` from Task 8, used by `AuthClient` (Tasks 9–11). `Transport.request<T>(path:method:body:)` signature consistent across uses. `HTTPMethod` enum stays `.get/.post/.delete` throughout.
- `WebAuthn.performRegistration` / `.performSignIn` from Task 7, called by `AuthClient.registerPasskey` / `.signInWithPasskey` in Task 10. Argument labels match.
- `PublicKeyCredentialJSON.asJSONObject()` from Task 7, called by `AuthClient.registerPasskey` and `.signInWithPasskey` in Task 10. Method name consistent.
- `EmptyResponse` from Task 8, used in Task 9 (`signOut`) and Task 11 (`deletePasskey`). Consistent.
- `Base64URL` extensions (`Data.base64URLEncodedString()`, `Data(base64URLEncoded:)`) from Task 4, used in Task 7 (WebAuthn). Consistent.

No type-or-name drift across tasks.
