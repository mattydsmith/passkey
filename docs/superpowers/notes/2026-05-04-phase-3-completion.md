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
| `WebAuthnCeremonyTests` | 8 | ServerCreationOptions/RequestOptions decode, PublicKeyCredentialJSON encode shape, error mapping (cancel + fail), RP ID propagation |
| `TransportTests` | 13 | URL composition, content-type, header attach, success decode, error mapping (known + unknown codes), network failure, malformed JSON, empty body, DELETE |
| `AuthClientEmailTests` | 5 | startEmailSignIn / verifyEmailOtp / getCurrentUser / signOut, token persistence + clearing, error surfacing |
| `AuthClientPasskeyTests` | 3 | register/sign-in flow up to provider seam, unauthenticated short-circuit |
| `AuthClientManagementTests` | 5 | listSessions / listPasskeys / deletePasskey, URL encoding, unknown_credential mapping |
| `SmokeTests` | 1 | package builds |

**Total: 59 XCTest cases.** All pass on macOS via `swift test` and on iOS Simulator via `xcodebuild test -destination "platform=iOS Simulator,OS=26.4.1,name=iPhone 17 Pro"`.

---

## Key deviations from the plan

These deviations are load-bearing — any future Swift work needs to know them.

### 1. WebAuthn happy-path is not unit-tested

Apple's `ASAuthorization*` credential types can't be synthesized in tests outside the framework — there's no public initializer that accepts raw bytes. The plan calls this out explicitly: success-path coverage comes from manual demo runs, not from XCTest. The unit tests verify everything up to the provider seam (input encoding, RP ID propagation, error mapping).

### 2. `KeychainStorage` is not unit-tested

Headless XCTest hosts (`swift test` and `xcodebuild test` against the Simulator without a hosting app) have unreliable Keychain access. The implementation is small (one generic-password entry), the API surface is thin (load/save/clear/attach), and the demo app verifies it manually.

### 3. `AnyJSONObject` exists for nil-omission JSON encoding

Swift's `JSONEncoder` emits `null` for nil-valued optionals, but the web client's `PublicKeyCredentialJSON` encoder omits them entirely. To keep wire-shape parity, `PublicKeyCredentialJSON.asJSONObject()` returns `[String: Any]` and we send it via the `AnyJSONObject` Encodable wrapper that bridges through `JSONSerialization`. See `clients/PasskeySDK/Sources/PasskeySDK/AuthClient.swift`.

### 4. `ASAuthorizationControllerDelegate` continuation requires retain

`ASAuthorizationController` holds its `delegate` weakly. The bridge-based async/await wrapper attaches the delegate to the controller via `objc_setAssociatedObject` to keep it alive for the duration of the call. See `DefaultAuthenticationServicesProvider` in `AuthenticationServicesProvider.swift`. Its `init()` is also marked `nonisolated` — it inherits `@MainActor` from `ASAuthorizationControllerDelegate` on iOS, which the iOS toolchain (but not macOS) flags when called from a nonisolated context.

### 5. `Info.plist` allows local networking

The demo's Info.plist has `NSAllowsLocalNetworking: true` so the Simulator can reach `http://localhost:3001`. Real-device builds should remove this (HTTPS-only) — documented in `clients/ios-demo/README.md`.

### 6. Manifest tools-version bumped from 5.10 → 6.2

The plan suggested `swift-tools-version: 5.10`, but `.iOS(.v26)` and `.macOS(.v26)` require `PackageDescription` 6.2. Bumped accordingly.

### 7. `Transport.composeURL` uses string concatenation, not `URL.appendingPathComponent`

`URL.appendingPathComponent` double-encodes percent escapes (`%2F` → `%252F`), which mangled URL-encoded ids in `deletePasskey`. Replaced with explicit string concatenation that preserves already-encoded segments. The fix landed during Task 11 because the URL-encoding test caught the bug.

### 8. Test count diverged from the plan's prose by 2

The plan said ~45 tests across the suite; running tally said "57 by Task 12." Actual final count is **59** because Task 7's verbatim test code defines 8 cases (plan prose said 7) and Task 8's defines 13 (plan prose said 12). All cases passed; the discrepancy was in the plan's summary arithmetic, not the verbatim test code.

### 9. iOS Simulator destination is `OS=26.4.1`, not `OS=26.0`

The plan's `xcodebuild test` invocation specified `OS=26.0` but only `26.1`, `26.2`, and `26.4.1` simulators are installed locally. Used `OS=26.4.1,name=iPhone 17 Pro`. Future runs may need to match whatever is actually installed.

---

## Tech stack chosen

- **Swift 6.3 toolchain, Swift 5 language mode** (deferred strict concurrency to a future phase).
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

# Run the unit tests on macOS (~59 tests, sub-second)
swift test

# Run the unit tests on iOS Simulator
xcodebuild test -scheme PasskeySDK -destination "platform=iOS Simulator,OS=26.4.1,name=iPhone 17 Pro"
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
