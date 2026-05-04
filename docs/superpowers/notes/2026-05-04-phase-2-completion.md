# Passkey SDK — Phase 2 Completion Notes

**Date:** 2026-05-04
**Status:** Phase 2 (web client + cookie-mode prerequisites) shipped. All 17 tasks of `docs/superpowers/plans/2026-05-04-passkey-sdk-phase-2-web-client.md` complete.
**Branch:** `main` (clean tree, all commits direct to main)

---

## TL;DR for Phase 3 (Swift / iOS client) planning

- **`spec/protocol.md` is still the durable contract.** It now also covers CSRF (double-submit cookie) and the `csrf_required` / `invalid_request` error codes added in Phase 2. Plan Phase 3 against `spec/protocol.md`, not the design specs.
- **`packages/client-web` is the second implementation of that contract.** When the Swift client diverges in shape, prefer the protocol doc; when the protocol is silent, use the web client as the cross-checkable reference (especially for WebAuthn credential JSON shapes and the "two-step ceremony" pattern).
- **Read `Key deviations from the plan` below before designing the Swift client** — several of them encode constraints that will surface again on iOS (RP ID, JSON shapes, exactOptionalPropertyTypes-equivalent tightness in Swift's optionals).
- The web client + the Hono server are exercised end-to-end through a Playwright Chromium virtual-authenticator flow. The Swift client should aim for an analogous `AuthenticationServices`-driven test (XCUITest or unit-level) once it lands.

---

## What's in Phase 2

- **Server (Hono adapter) prerequisites:**
  - `auth.config.session.lifetimeSeconds` is now threaded through to the cookie `Max-Age` (Task 1).
  - Cookie name follows `auth.config.session.cookieName` everywhere (Task 1).
  - `csrfMiddleware` (double-submit cookie) added to `packages/hono/src/csrf.ts` and wired into `mountAuthRoutes` (Tasks 2, 3). Default-on when a cookie name is configured; opt-out via `mountAuthRoutes(app, auth, { csrf: false })`. A non-HttpOnly `csrf` cookie is issued alongside `session` on `/auth/email/verify` and `/auth/passkey/sign-in/finish`, and both are cleared on sign-out.
  - `spec/protocol.md` updated to document CSRF + the new error codes `csrf_required` (403) and `invalid_request` (400) (Task 4).
- **Web client (`@mattsmith/passkey-sdk-client-web`):**
  - ESM-only, ES2022, no runtime deps (Task 5).
  - `AuthClientError` + 13-code `AuthClientErrorCode` union (Task 6).
  - base64url codec (`bufferToBase64url`, `base64urlToBuffer`) — pure functions (Task 7).
  - WebAuthn wrapper — `decodeCreationOptions`, `decodeRequestOptions`, `encodePublicKeyCredential`, `performRegistration`, `performSignIn` — with `NotAllowedError`/`AbortError` mapped to `passkey_cancelled` and missing `navigator.credentials` mapped to `unsupported` (Task 8).
  - `SessionStorage` strategies for cookie + header modes (Task 9).
  - Fetch transport — CSRF read, storage attach, error mapping (Task 10).
  - `createAuthClient` public façade with email/session/passkey/management methods (Tasks 11–13).
- **Examples:**
  - Test-only `/__test/last-otp` endpoint added to `examples/hono-app`, guarded by `NODE_ENV=test` (Task 14).
  - `examples/web-demo` — Vite app exercising every public client method (Task 15).
  - Playwright e2e using Chromium WebDriver-BiDi virtual authenticator covers the full email + passkey ceremony flow (Task 16). Passes in 3.2s when run separately.

---

## Repo layout (as built)

```
packages/
└── client-web/                           # @mattsmith/passkey-sdk-client-web
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts
    ├── vitest.config.ts
    ├── src/
    │   ├── index.ts                      # public exports
    │   ├── client.ts                     # createAuthClient + 9 methods
    │   ├── errors.ts                     # AuthClientError + code union
    │   ├── storage.ts                    # cookie + header SessionStorage
    │   ├── transport.ts                  # fetch wrapper, CSRF read, error mapping
    │   ├── types.ts                      # public result types
    │   └── webauthn.ts                   # base64url codec + ceremony wrapper
    └── tests/
        ├── setup.ts                      # jsdom + storage shim
        ├── smoke.test.ts
        ├── errors.test.ts
        ├── storage.test.ts
        ├── webauthn-codec.test.ts
        ├── webauthn-wrapper.test.ts
        ├── transport.test.ts             # msw-driven
        ├── client-email.test.ts
        ├── client-passkey.test.ts
        └── client-management.test.ts

examples/
└── web-demo/                             # private workspace package "web-demo-example"
    ├── package.json
    ├── index.html
    ├── vite.config.ts                    # proxies /auth and /__test → :3001 (same-origin)
    ├── tsconfig.json
    ├── playwright.config.ts              # spawns hono-app on :3001 + Vite on :5173
    ├── src/
    │   └── main.ts                       # exercises every public method
    └── tests/
        └── e2e.spec.ts                   # virtual authenticator flow
```

**Boundary rules held:** `client-web` has no runtime deps and never imports server code. The Vite example is the only place that wires `client-web` to a running `hono-app`.

---

## What's tested

| Suite | Tests | Covers |
|---|---|---|
| `core/tests/*` | 59 | Phase 1, unchanged |
| `hono/tests/csrf.test.ts` | 8 | CSRF middleware: cookie issuance, header check, mismatched values, exempt methods |
| `hono/tests/routes.test.ts` | 16 | Phase 1 (10) + 6 new CSRF integration cases (cookie issued on verify + sign-in finish, cleared on sign-out) |
| `client-web/tests/smoke.test.ts` | 1 | Package import |
| `client-web/tests/errors.test.ts` | 4 | `AuthClientError` shape + `isAuthClientError` |
| `client-web/tests/storage.test.ts` | 9 | Cookie + header `SessionStorage`, in-memory shim |
| `client-web/tests/webauthn-codec.test.ts` | 6 | base64url round-trip, edge bytes |
| `client-web/tests/webauthn-wrapper.test.ts` | 12 | encode/decode, `NotAllowedError` mapping, `unsupported` mapping |
| `client-web/tests/transport.test.ts` | 11 | CSRF read, storage attach, error code mapping (msw) |
| `client-web/tests/client-email.test.ts` | 6 | `startEmailSignIn`, `verifyEmailOtp`, `getCurrentUser`, `signOut` |
| `client-web/tests/client-passkey.test.ts` | 5 | `registerPasskey`, `signInWithPasskey` (mocked navigator.credentials) |
| `client-web/tests/client-management.test.ts` | 5 | `listSessions`, `listPasskeys`, `deletePasskey` |
| `examples/hono-app/tests/e2e.test.ts` | 3 | Phase 1 OTP flow (1) + 2 cases for the test-only `/__test/last-otp` endpoint |
| `examples/web-demo/tests/e2e.spec.ts` | 1 | Playwright + Chromium virtual authenticator: email start → verify → register passkey → sign-out → sign-in with passkey |

Totals (run from repo root): `pnpm test` runs **142** tests (`core` 59 + `hono` 24 + `client-web` 59); `pnpm --filter hono-app-example test` runs **3** more; the Playwright e2e is run separately and adds **1**.

Run all (excluding Playwright):

```bash
pnpm test
pnpm --filter hono-app-example test
```

Run the Playwright e2e separately (needs port 3001 free; uses `NODE_ENV=test`):

```bash
pnpm --filter web-demo-example test
```

---

## Key deviations from the plan

These deviations are **load-bearing** — Phase 3 needs to know them.

### 1. `tests/setup.ts` Storage shim (Task 9)

jsdom mounts `localStorage` against an opaque origin and throws `SecurityError` on any access; Node 25 ships an experimental WHATWG Storage global that doesn't behave the same. The plan's literal text assumed `localStorage` would just work in jsdom. We added a Map-backed `Storage` polyfill in `packages/client-web/tests/setup.ts` and installed it as `globalThis.localStorage`/`sessionStorage` before vitest collects tests. Every msw-driven test from Task 10 onwards depends on this shim. Phase 3 doesn't inherit this directly (Swift has its own keychain story), but the shape of the abstraction — pluggable storage strategies — is the right pattern to mirror.

### 2. `id: cred.id` in the WebAuthn wrapper (Task 8)

`encodePublicKeyCredential` sets `id: cred.id` rather than the plan's literal `bufferToBase64url(cred.rawId)`. Browsers populate `cred.id` with the base64url string already, and using it directly is more permissive of test fixtures (vitest mocks supplying `cred.id` without a real `rawId`). The on-the-wire JSON contains both `id` and `rawId` (the latter still derived from `cred.rawId`), so the server contract is unaffected. **Swift implication:** mirror this — the `id` field in the JSON sent to `/finish` is the credential ID encoded as base64url, period; don't try to derive it from raw bytes if the platform already gives you a string.

### 3. Conditional-spread for `exactOptionalPropertyTypes`

`tsconfig.base.json` has `exactOptionalPropertyTypes: true`, which forbids `{ key: undefined }` for optional-but-not-undefined properties. `decodeCreationOptions`, `decodeRequestOptions`, `encodePublicKeyCredential`, and the transport options builder use the conditional-spread pattern (`...(x !== undefined ? { x } : {})`) throughout. Phase 3's Swift client doesn't have this exact constraint, but Swift `Optional` + `Codable` will surface analogous "absent vs `null`" decisions when serializing to JSON — favor key absence over explicit `null` for parity with the web client's wire format.

### 4. msw `afterEach(server.resetHandlers())` is mandatory (Task 11+)

The plan didn't mention it, but every test file using msw needs `afterEach(() => server.resetHandlers())` or handler state leaks across tests and one suite's overrides poison the next. This bit us once during Task 11 and got added everywhere. Not Swift-relevant but worth recording.

### 5. `127.0.0.1` is NOT a valid WebAuthn RP ID (Task 16)

Task 15 originally switched the example server's `rpId` and `origins` to `127.0.0.1`. WebAuthn (and Chromium) reject IP-literal RP IDs — they must be valid registrable domains. The fix in Task 16 reverted the example back to `localhost`. **Swift implication:** the iOS demo's `webcredentials:` Associated Domains entry must use `localhost` or a real domain too — `webcredentials:127.0.0.1` won't work. AASA is already served at `/.well-known/apple-app-site-association` for whatever rpId the server is configured with.

### 6. Vite proxy in `web-demo` (Task 16)

`vite.config.ts` proxies `/auth` and `/__test` from the dev server (`:5173`) to the hono-app (`:3001`). This makes the demo and the API same-origin, which (a) eliminates CORS, (b) lets the cookie storage strategy work without `SameSite=None`/`Secure` gymnastics, and (c) keeps the Playwright virtual authenticator happy. **Swift implication:** an iOS demo doesn't have CORS to worry about, but it does need its `webcredentials:` domain to match the rpId, and bearer-token mode is the cleaner path on iOS regardless.

### 7. Playwright uses port 3001 for hono-app (Task 16)

`playwright.config.ts` spawns the hono-app on `:3001` instead of the default `:3000` so it can run alongside a developer's regular dev server on `:3000`. The Vite proxy in `web-demo/vite.config.ts` points at `:3001` to match. If a Phase 3 iOS demo ever spins up its own server in CI, follow the same convention.

### 8. CORS middleware is **not** included in Phase 2's hono-app

The example proxies same-origin in dev/test, so we never needed CORS. Production consumers that run their UI on a different origin will need to add their own `cors()` middleware. The Swift client (Phase 3) won't hit this since iOS apps don't enforce browser CORS, but documenting it here so Phase 3 doesn't accidentally rely on the example as a "production-ready" consumer wiring.

---

## Tech stack additions in Phase 2

Same as Phase 1, plus:

- **Web client build:** tsup → ESM-only `dist/`, ES2022, `.d.ts` emitted.
- **Web client tests:** Vitest 1.6 + jsdom 24 + msw 2.x.
- **Demo:** Vite 5 + Playwright 1.x (Chromium with WebDriver-BiDi virtual authenticator).
- **No new server-side deps.**

---

## Public API surface (for Phase 3 to mirror)

```ts
createAuthClient(config: AuthClientConfig): AuthClient
```

`AuthClientConfig`:
- `baseUrl: string`
- `storage: "cookie" | "header"`
- `fetch?: typeof fetch`
- `storageKey?: string` (header mode only — defaults to `passkey-sdk:session`)
- `csrfCookieName?: string` (cookie mode only — defaults to `csrf`)

`AuthClient` methods (the names the Swift client should mirror where possible):

| Method | Server route | Auth required |
|---|---|---|
| `startEmailSignIn(email: string)` | `POST /auth/email/start` | no |
| `verifyEmailOtp(otpId: string, code: string)` | `POST /auth/email/verify` | no (issues session) |
| `registerPasskey(opts?: { deviceName?: string })` | `POST /auth/passkey/register/{start,finish}` | yes |
| `signInWithPasskey()` | `POST /auth/passkey/sign-in/{start,finish}` | no (issues session) |
| `getCurrentUser()` | `GET /auth/me` | yes |
| `signOut()` | `POST /auth/sign-out` | yes |
| `listSessions()` | `GET /auth/sessions` | yes |
| `listPasskeys()` | `GET /auth/passkeys` | yes |
| `deletePasskey(id: string)` | `DELETE /auth/passkeys/:id` | yes |

The two passkey ceremonies are **two-step** — `start` returns `{ id, options }`, the client runs `navigator.credentials.{create,get}()`, then `finish` posts the encoded credential plus the ceremony id. Swift's `ASAuthorizationController` flow maps onto the same two steps.

---

## WebAuthn JSON shapes (Swift must produce these on the wire)

What the web client posts to `/finish` endpoints:

```json
{
  "id": "<base64url credential id>",
  "rawId": "<base64url credential id, redundant>",
  "type": "public-key",
  "response": {
    "clientDataJSON": "<base64url>",
    "attestationObject": "<base64url, registration only>",
    "authenticatorData": "<base64url, sign-in only>",
    "signature": "<base64url, sign-in only>",
    "userHandle": "<base64url, sign-in only, may be omitted>"
  },
  "clientExtensionResults": { /* optional */ }
}
```

`base64url` here is **unpadded** base64url (RFC 4648 §5 without `=`). The server uses `@simplewebauthn/server` v10 which accepts this shape directly. Swift's `ASAuthorizationPlatformPublicKeyCredentialRegistration`/`...Assertion` need to be JSON-encoded into the same shape; in particular `userHandle` is optional and absent (not `null`) when the assertion doesn't carry one.

---

## How to run things

```bash
# from repo root
pnpm install
pnpm typecheck
pnpm build
pnpm test                                   # core + hono + client-web
pnpm --filter hono-app-example test         # OTP-peek tests
pnpm --filter web-demo-example test         # Playwright (port 3001 must be free)

# Run the demo by hand
( cd examples/hono-app && pnpm migrate )    # creates ./app.db
( cd examples/hono-app && pnpm dev )        # listens on :3000
( cd examples/web-demo && pnpm dev )        # vite on :5173, proxies /auth → :3000

# (Playwright config uses :3001 to avoid colliding with :3000.)
```

---

## Open items / things to revisit in Phase 3+

Carried from Phase 1:
- **Multi-process passkey challenge store** — `pendingRegistrations` / `pendingSignIns` are still in-memory Maps. Replace with a DB-backed store when we run multi-process.
- **`transports` backfill at registration** — still null because we're on `@simplewebauthn/server` v10. The web client *receives* `transports` from the browser; we could opportunistically backfill `auth_passkeys.transports` at registration time without a library upgrade.
- **`requireSession` returns `email: ""`** — unchanged. Clients fetch email from `/auth/me` if they need it.

New in Phase 2:
- **Shared cross-platform contract conformance suite.** Once Swift exists, a shared set of "given a server, run these requests and assert these responses" cases will pay off. Defer until Phase 3 makes it worth the investment.
- **React/Vue adapters.** Phase 4+. Probably thin wrappers around `createAuthClient` + framework-specific reactivity.
- **Postgres / Express adapters.** Later.
- **CORS middleware for cross-origin production deployments.** Not needed by the proxied example, but consumers will want guidance.
- **`examples/hono-app/app.db` accumulates rows across e2e runs.** Not blocking but should be reset (or `:memory:`) before publishing.
- **Cookie parser uses `split("=", 2)`** — truncates `=` in values. Fine for the current opaque-token cookie format, fragile for any future cookie that base64-encodes with padding. Leave as-is; flag if/when the cookie payload changes.

---

## Files Phase 3 (Swift) should read first

1. `Passkey/spec/protocol.md` — the contract (now includes CSRF + `csrf_required` / `invalid_request`).
2. `Passkey/docs/superpowers/specs/2026-05-04-passkey-sdk-phase-2-web-client-design.md` — the design Swift should mirror in spirit (façade shape, error union, two-step ceremonies).
3. `Passkey/packages/client-web/src/index.ts` — public exports as the API surface the Swift client should aim for.
4. `Passkey/packages/client-web/src/webauthn.ts` — base64url codec + ceremony wrapper. Swift's `AuthenticationServices` mapping mirrors this 1:1, including the JSON shape posted to `/finish`.
5. `Passkey/packages/client-web/src/client.ts` — public façade pattern (method names, two-step ceremonies, error mapping).
6. `Passkey/examples/hono-app/src/index.ts` — server the iOS demo will also talk to. (Same example, two clients.)
