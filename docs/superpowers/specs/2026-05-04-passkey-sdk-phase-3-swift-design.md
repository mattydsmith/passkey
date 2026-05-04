# Passkey SDK — Phase 3 (Swift Client) Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-05-04
**Author:** Matt Smith
**Predecessors:**
- `2026-05-03-passkey-sdk-design.md` — overall cross-platform design
- `2026-05-04-passkey-sdk-phase-2-web-client-design.md` — web client design (Phase 3 mirrors its semantics)
- `2026-05-04-phase-1-completion.md` + `2026-05-04-phase-2-completion.md` — handoff context

---

## Overview

Phase 3 ships `PasskeySDK`, a Swift Package that consumes the same HTTP contract at `spec/protocol.md` as the web client. It mirrors the Phase 2 façade in spirit — same nine method names, same two-step ceremonies, same error union — but expressed in Swift idioms (positional args, throwing async, strongly-typed structs, `URLSession`, Keychain, `AuthenticationServices`).

The package is **bearer-token-mode only**. iOS doesn't have first-class browser-cookie semantics, and the protocol's bearer mode bypasses CSRF entirely — both clients are correct, they just take the route that fits their platform.

A SwiftUI demo app (`clients/ios-demo/`) exercises every public method against the existing `examples/hono-app`. Unit tests cover transport / storage / WebAuthn ceremonies via `URLProtocol` HTTP mocks and an `AuthenticationServicesProvider` protocol seam. There is no iOS UI end-to-end test (the value-to-cost ratio is too low compared to the manual demo flow).

## Goals

- A consumer adds `PasskeySDK` as a Swift Package dependency, instantiates `AuthClient(config:)`, and completes email-OTP and passkey flows in roughly the same number of lines as the web client.
- API surface and naming track the web client closely so the mental model carries between platforms.
- Public methods never expose the raw session token. Tokens persist in the Keychain; calls return only `{ user }` etc.
- Errors are exhaustive and mapped: every protocol error code plus client-only `network` / `passkey_*` / `unsupported` codes surface as a discriminable `AuthClientErrorCode`.
- Swift Package builds on macOS, runs in the iOS Simulator, has no third-party runtime dependencies.

## Non-goals (Phase 3)

- Cookie-mode support in the iOS client (bearer is the native pattern).
- visionOS, watchOS, tvOS, UIKit-specific helpers.
- Combine publishers, SwiftUI property wrappers, observable session state.
- iOS UI end-to-end tests (Playwright equivalent). Manual demo + unit tests cover the surface.
- A device-CI pipeline.
- Real-device passkey testing (requires Associated Domains + AASA on a real domain — documented as a follow-up; the simulator-with-localhost path is the default development workflow).
- A shared cross-platform contract conformance suite (same deferral as Phase 2).
- Strict Swift 6 concurrency. Use Swift 5 language mode of the Swift 6 toolchain; revisit when the ecosystem lands consistently on strict concurrency.
- Server changes. The protocol already supports bearer mode and skips CSRF when no session cookie is present.

---

## Architecture

### New top-level directory: `clients/`

```
clients/
├── PasskeySDK/                       # Swift Package — the SDK proper
│   ├── Package.swift                 # platforms: .iOS(.v26), .macOS(.v26); no deps
│   ├── README.md
│   ├── Sources/
│   │   └── PasskeySDK/
│   │       ├── AuthClient.swift                       # public façade
│   │       ├── AuthClientConfig.swift                 # config struct
│   │       ├── AuthClientError.swift                  # error type + code enum
│   │       ├── AuthUser.swift                         # public result types
│   │       ├── Transport.swift                        # URLSession wrapper, error mapping
│   │       ├── KeychainStorage.swift                  # Keychain-backed token persistence
│   │       ├── WebAuthn.swift                         # base64url codec + ceremony orchestrators
│   │       ├── AuthenticationServicesProvider.swift   # protocol seam (DI for testing)
│   │       └── DefaultAuthenticationServicesProvider.swift  # ASAuthorizationController-backed impl
│   └── Tests/
│       └── PasskeySDKTests/
│           ├── TransportTests.swift              # URLProtocol-based HTTP mocks
│           ├── KeychainStorageTests.swift
│           ├── WebAuthnCodecTests.swift          # base64url round-trip
│           ├── WebAuthnCeremonyTests.swift       # provider-mock-driven
│           ├── AuthClientEmailTests.swift
│           ├── AuthClientPasskeyTests.swift
│           └── AuthClientManagementTests.swift
└── ios-demo/                         # SwiftUI demo app
    ├── README.md                     # how to run vs hono-app on :3001; real-device caveats
    ├── ios-demo.xcodeproj/
    └── ios-demo/
        ├── ContentView.swift         # buttons + status pane equivalent to web-demo
        ├── ios_demoApp.swift         # @main App entry
        └── Info.plist                # Associated Domains placeholder for future device runs
```

`clients/` lives at the repo root, sibling to `packages/`. The pnpm workspace is JS/TS-only (`packages/*` and `examples/*`); Swift sits beside it. The Phase 1+2 design's `packages/client-swift/` reference was misleading — `clients/PasskeySDK/` is the corrected path.

### Boundary rules (held)

- The Swift Package has no runtime dependencies — only Foundation, `Security` (Keychain), and `AuthenticationServices`. Standard Apple frameworks.
- Tests have no third-party deps either; `URLProtocol` and `XCTest` are the only mocking tools.
- The demo app imports `PasskeySDK` via a local Swift Package reference. Nothing else in the repo imports the iOS demo.

---

## Public API

```swift
import PasskeySDK
import Foundation

let client = AuthClient(config: AuthClientConfig(
    baseURL: URL(string: "http://localhost:3001/auth")!
))

// Email OTP
let start = try await client.startEmailSignIn(email: "matt@example.com")
let verified = try await client.verifyEmailOtp(otpId: start.otpId, code: "482917")
print(verified.user.id, verified.user.email)

// Passkey
let registered = try await client.registerPasskey(deviceName: "iPhone 15")
let signedIn = try await client.signInWithPasskey()

// Session
let me = try await client.getCurrentUser()
try await client.signOut()
let sessions = try await client.listSessions()
let passkeys = try await client.listPasskeys()
try await client.deletePasskey(id: registered.passkeyId)
```

Method names track the web client where they make sense. `registerPasskey(deviceName:)` takes `deviceName: String? = nil`; pass `nil` (or omit) to skip the field on the wire. Errors are thrown — no `Result` wrapper.

### Configuration

```swift
public struct AuthClientConfig: Sendable {
    public var baseURL: URL
    public var session: URLSession
    public var keychainService: String      // default: "PasskeySDK"
    public var keychainAccount: String      // default: "session-token"
    public var rpIDOverride: String?        // default: nil — derived from baseURL.host

    public init(
        baseURL: URL,
        session: URLSession = .shared,
        keychainService: String = "PasskeySDK",
        keychainAccount: String = "session-token",
        rpIDOverride: String? = nil
    )
}
```

`session` is overridable for tests (we install a `URLProtocol` and pass a configured session). `rpIDOverride` is the iOS-specific knob: WebAuthn ceremonies need the RP ID, which by default we derive from `baseURL.host`. For real-device runs against a deployed server the RP ID typically equals the apex domain rather than the API host — `rpIDOverride` lets the consumer point at it explicitly.

### Result types (mirroring the web client)

```swift
public struct AuthUser: Sendable, Decodable, Equatable {
    public let id: String
    public let email: String
}

public struct StartEmailSignInResult: Sendable, Decodable {
    public let otpId: String
    public let expiresInSeconds: Int
}
public struct VerifyEmailOtpResult: Sendable { public let user: AuthUser }
public struct RegisterPasskeyResult: Sendable, Decodable { public let passkeyId: String }
public struct SignInWithPasskeyResult: Sendable { public let user: AuthUser }
public struct GetCurrentUserResult: Sendable, Decodable { public let user: AuthUser }

public struct SessionSummary: Sendable, Decodable {
    public let createdAt: Int
    public let expiresAt: Int
    public let lastSeenAt: Int
    public let userAgent: String?
    public let ip: String?
}
public struct ListSessionsResult: Sendable, Decodable { public let sessions: [SessionSummary] }

public struct PasskeySummary: Sendable, Decodable {
    public let id: String
    public let deviceName: String?
    public let createdAt: Int
    public let lastUsedAt: Int?
    public let transports: [String]?
}
public struct ListPasskeysResult: Sendable, Decodable { public let passkeys: [PasskeySummary] }
```

Verify and sign-in **don't** expose `sessionToken` — the transport reads it off the response, persists it via `KeychainStorage`, and strips it before returning.

---

## Internals

### `KeychainStorage`

One-entry Keychain wrapper. Two operations: `load() throws -> String?`, `save(_ token: String) throws`, `clear() throws`. Plus `attach(to: inout URLRequest) throws` which adds `Authorization: Bearer <token>` when a token is present.

Service + account come from `AuthClientConfig`. Default attributes: `kSecClassGenericPassword`, `kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock`. No `kSecAttrAccessGroup` — single-app entry. Tests inject a fake storage rather than touching the real Keychain (which the simulator doesn't fully support in headless test runs).

### `Transport`

```swift
struct Transport: Sendable {
    let baseURL: URL
    let session: URLSession
    let storage: any TokenStorage   // protocol; KeychainStorage conforms

    func request<T: Decodable>(
        path: String,
        method: HTTPMethod,
        body: (any Encodable)? = nil
    ) async throws -> T
}
```

Behavior:
- Compose URL with `baseURL.appendingPathComponent(path.trimmingPrefix("/"))` — and yes, normalize leading slashes the same way the web client does.
- Encode body via `JSONEncoder` with `keyEncodingStrategy: .useDefaultKeys` (we use camelCase on the wire deliberately to match the server).
- Set `Content-Type: application/json` only when there's a body.
- Call `try storage.attach(to: &request)` to add `Authorization: Bearer <token>` if persisted.
- Hand off to `session.data(for: request)`.
- Decode 2xx as `T` via `JSONDecoder().decode(T.self, from: data)`.
- Decode non-2xx as `{ error, message }`. Build `AuthClientError` from those + `response.statusCode`. Fallback: `code = .network`, `message = HTTPURLResponse.localizedString(forStatusCode:)`.
- `URLError` from `session.data` → `AuthClientError(.network, …, underlying: URLError)`.
- `DecodingError` after a 2xx → `AuthClientError(.network, …, underlying: DecodingError)` (server returned malformed JSON).

`HTTPMethod` is an internal enum with `.get`, `.post`, `.delete` — same set the web client supports.

### `WebAuthn`

Two pieces, mirroring `packages/client-web/src/webauthn.ts`:

**Codec** — pure functions on `Data`:
- `Data.base64URLEncodedString() -> String` and `init?(base64URLEncoded:)` extensions. Implementation: `Data.base64EncodedString()` then `+→-`, `/→_`, strip `=` padding; reverse for decode.

**Ceremony orchestrators** — `performRegistration(serverOptions:provider:) async throws -> PublicKeyCredentialJSON` and `performSignIn(serverOptions:provider:) async throws -> PublicKeyCredentialJSON`.

`PublicKeyCredentialJSON` mirrors the web client's wire shape exactly:

```swift
public struct PublicKeyCredentialJSON: Encodable, Sendable {
    public let id: String           // base64url credential id
    public let rawId: String        // same; redundant per WebAuthn spec
    public let type: String         // always "public-key"
    public let response: Response

    public struct Response: Encodable, Sendable {
        public let clientDataJSON: String
        public let attestationObject: String?     // registration only
        public let authenticatorData: String?     // sign-in only
        public let signature: String?             // sign-in only
        public let userHandle: String?            // sign-in only, may be omitted
    }
}
```

The orchestrators:
1. Decode server `ServerCreationOptions` / `ServerRequestOptions` (internal `Decodable` types matching the wire JSON).
2. Build the appropriate `ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest` or `…AssertionRequest`. RP ID comes from `config.rpIDOverride ?? config.baseURL.host`. Challenge / userID / excludeCredentials.IDs / allowCredentials.IDs are decoded from base64url to `Data`.
3. Run via `provider.perform(requests: [request])` (the seam — see below).
4. Cast the resulting `ASAuthorization.credential` to `ASAuthorizationPlatformPublicKeyCredentialRegistration` or `…Assertion`. Extract `rawClientDataJSON`, `rawAttestationObject` (or `rawAuthenticatorData` + `signature` + `userID`).
5. Encode each `Data` field back to base64url and assemble `PublicKeyCredentialJSON`.

Errors:
- `ASAuthorizationError.canceled` → `passkey_cancelled`
- `ASAuthorizationError.failed`, `.notHandled`, `.notInteractive`, `.unknown`, `.invalidResponse` → `passkey_failed` (with the underlying error attached)
- iOS version below 26 at runtime → `unsupported` (defensive — we set the deployment target at 26 but check anyway)

### `AuthenticationServicesProvider`

Test seam. The default implementation wraps `ASAuthorizationController`; the test implementation captures the request and yields a fake credential.

```swift
public protocol AuthenticationServicesProvider: Sendable {
    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization
}
```

`AuthClientConfig` doesn't expose this directly — it's an `AuthClient` initializer overload used only in tests:

```swift
extension AuthClient {
    init(config: AuthClientConfig, provider: any AuthenticationServicesProvider)
}
```

Production callers use the public `init(config:)` which hard-codes the default provider.

### `AuthClient` façade

Composes `Transport` + `KeychainStorage` + `WebAuthn` + `provider`. Each method is one or two transport calls plus, for passkey ceremonies, the WebAuthn orchestrator. Persists the token after `verifyEmailOtp` and `signInWithPasskey`. Clears the token after `signOut`.

URL-encodes the id in `deletePasskey(id:)` — same as the web client (defensive against future format changes; current base64url tokens have no special characters).

### Error type

```swift
public struct AuthClientError: Error, Sendable {
    public let code: AuthClientErrorCode
    public let rawCode: String      // verbatim from the server, for forward-compat
    public let message: String
    public let status: Int?
    public let underlying: (any Error)?
}

public enum AuthClientErrorCode: String, Sendable {
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
}
```

`rawCode` carries the literal string from the server; `code` is the parsed enum (falls through to `.unknown` on unrecognized codes). Apps that want exhaustive switching get `code`; apps that want forward-compat with new server codes can read `rawCode`.

---

## Wire-protocol fidelity

Phase 3 produces the same wire shapes the web client produces, byte-for-byte:

- Passkey register → POST `/auth/passkey/register/finish` with `{ "registrationId": String, "credential": { id, rawId, type: "public-key", response: { clientDataJSON, attestationObject } }, "deviceName": String? }`.
- Passkey sign-in → POST `/auth/passkey/sign-in/finish` with `{ "signInId": String, "credential": { id, rawId, type: "public-key", response: { clientDataJSON, authenticatorData, signature, userHandle? } } }`.

The server's `@simplewebauthn/server` v10 setup parses both shapes identically — the web client e2e is the witness.

---

## Testing strategy

### Unit tests via `URLProtocol` + provider mock

`URLProtocol` registration installs a fake on a configured `URLSession`. Each test sets up the responses it expects, runs the SDK call, and asserts on what URLs/headers/bodies were issued. Same approach as msw in the web client.

`AuthenticationServicesProvider` mock yields canned `ASAuthorization` results or throws specific `ASAuthorizationError` values to exercise each error mapping.

### Test counts (target)

| Suite | Tests |
|---|---|
| `TransportTests` | 8–10 |
| `KeychainStorageTests` | 4 |
| `WebAuthnCodecTests` | 6 |
| `WebAuthnCeremonyTests` | 8 |
| `AuthClientEmailTests` | 6 |
| `AuthClientPasskeyTests` | 5 |
| `AuthClientManagementTests` | 6 |

~45 tests total. `swift test` runs them all on macOS; `xcodebuild test -destination "platform=iOS Simulator,OS=26.0"` runs them on the simulator.

### What we deliberately don't test

- Real `Keychain` operations — replaced with a fake `TokenStorage` in tests. The Keychain implementation has its own minimal coverage; production behavior is verified manually via the demo app.
- Real `ASAuthorizationController` — provider seam handles this. The default provider has no behavior beyond delegating to Apple's API.
- iOS UI end-to-end. The Playwright equivalent for iOS (via XCUITest + a virtual authenticator) doesn't exist out of the box. Manual demo testing fills the gap; we'll revisit if Phase 3 ever moves to App Store-tier maturity.

---

## Demo app

`clients/ios-demo/` — minimal SwiftUI single-screen app. Buttons for every public method. Status pane shows the latest result or error, formatted like `web-demo`.

```
[Email OTP]
( email field )  [Send OTP]
( otp field )    [Verify OTP]

[Passkey]
[Register Passkey]  [Sign in with Passkey]  [Delete Passkey]

[Session]
[Get Current User]  [Sign Out]  [List Sessions]  [List Passkeys]

[Status]
<pre-formatted output>
```

Talks to `examples/hono-app` running at `http://localhost:3001/auth` (started via `pnpm --filter hono-app-example dev` with `PORT=3001 NODE_ENV=test`). The simulator can reach the Mac's `localhost`.

For real-device testing, the demo's `README.md` documents:
1. Deploying `examples/hono-app` to a real domain (e.g. `auth.example.com`) over HTTPS.
2. Setting up Associated Domains in `Info.plist`: `webcredentials:auth.example.com`, `applinks:auth.example.com`.
3. Serving an AASA file at `https://auth.example.com/.well-known/apple-app-site-association` (the server provides the helper).
4. Setting `rpIDOverride` on `AuthClientConfig` to the apex domain (`example.com`).

Real-device runs are **not part of Phase 3 acceptance** — they're documented for users who want to take the demo further.

---

## Server changes

**None.** The protocol already supports bearer mode; CSRF auto-bypasses when no session cookie is present; `Secure` cookie attribute applies to cookie mode only. The iOS client posts `Authorization: Bearer <token>` and reads JSON responses.

If implementation reveals a server gap (unlikely but possible — e.g. an `Accept-Language` quirk, a header iOS adds that the server rejects), we'll fold a small server fix into Phase 3 and document it as a deviation. Default expectation: zero server changes.

---

## Configuration and defaults

| Setting | Default | Configurable | Reasoning |
|---|---|---|---|
| `baseURL` | (required) | Yes | Project-specific |
| `session` | `URLSession.shared` | Yes | Tests inject a configured session with a `URLProtocol` |
| `keychainService` | `"PasskeySDK"` | Yes | Avoid collision with other apps' Keychain entries |
| `keychainAccount` | `"session-token"` | Yes | Single entry per app; configurable for multi-account scenarios |
| `rpIDOverride` | `nil` (use `baseURL.host`) | Yes | Real-device deployments often diverge API host from RP ID |
| Session lifetime | (server-controlled) | No | Keychain entry persists until `signOut()` or explicit `clear`; the server's expires_at is the source of truth |
| WebAuthn `userVerification` | `.preferred` | No (in v0) | Best UX, won't fail on devices without biometrics; matches Phase 1 server default |

---

## Open questions and explicit deferrals

1. **Real-device testing path.** Documented in the demo README; not blocking Phase 3 acceptance. Picks up if anyone actually deploys a Passkey-SDK-backed iOS app.
2. **Push notifications / silent sign-in flows.** Not in scope. The SDK is request-driven, just like the web client.
3. **Multiple-account support.** A single `AuthClient` instance is a single-account thing (one Keychain entry). Multi-account would require either (a) multiple `AuthClient` instances with different `keychainAccount` values, or (b) a future `AuthClient.switchAccount(_)` method. (a) works today and is YAGNI for v0.
4. **App Group Keychain sharing.** Not in v0. Single-app Keychain only.
5. **Refresh tokens / silent reauthentication.** Not in v0. The server's session lifetime is sliding; clients re-authenticate when sessions expire. Same as the web client.
6. **Strict Swift 6 concurrency.** Defer until ecosystem stabilizes. All public types are `Sendable`-correct so adopting strict concurrency later should be mechanical.

---

## Files Phase 3's plan should reference first

1. `Passkey/spec/protocol.md` — the contract being implemented.
2. `Passkey/packages/client-web/src/{client,transport,storage,webauthn,errors,types}.ts` — concrete reference; Phase 3 mirrors these 1:1 in Swift.
3. `Passkey/examples/hono-app/src/index.ts` — server the demo and tests run against.
4. `Passkey/docs/superpowers/notes/2026-05-04-phase-2-completion.md` — most recent state, web-client deviations Phase 3 should also be aware of.
5. `Passkey/docs/superpowers/notes/2026-05-04-phase-1-completion.md` — server gotchas (passkeyId is bare base64url, requireSession returns email "", etc.).
6. `Passkey/CLAUDE.md` — repo conventions (work on `main`, no `Co-Authored-By`, test patterns).

---

## Acceptance

Phase 3 is complete when:

- `clients/PasskeySDK/Package.swift` builds (`swift build`) on macOS 26.
- `swift test` passes in the package directory (~45 tests).
- `xcodebuild test -scheme PasskeySDK -destination "platform=iOS Simulator,OS=26.0"` passes against an iOS 26 Simulator.
- `clients/ios-demo/` builds in Xcode and runs through the full flow against `examples/hono-app` (`PORT=3001 NODE_ENV=test pnpm --filter hono-app-example dev`).
- `docs/superpowers/notes/2026-05-04-phase-3-completion.md` committed.
- `MEMORY.md` and the project memory file updated to reflect Phase 3 status.
- `README.md` status section updated: Phase 3 → "shipped".
