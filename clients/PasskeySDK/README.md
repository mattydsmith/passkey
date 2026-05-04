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
