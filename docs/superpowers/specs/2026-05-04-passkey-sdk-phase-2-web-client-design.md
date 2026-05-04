# Passkey SDK — Phase 2 (Web Client) Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-05-04
**Author:** Matt Smith
**Predecessor:** `2026-05-03-passkey-sdk-design.md` (overall design), `2026-05-03-passkey-sdk-phase-1-server.md` (Phase 1 plan), `2026-05-04-phase-1-completion.md` (Phase 1 handoff)

---

## Overview

Phase 2 ships the JavaScript/TypeScript web client (`@mattsmith/passkey-sdk-client-web`) that consumes the HTTP contract at `spec/protocol.md`, plus two server changes that the cookie-mode client requires to be correct: CSRF protection and a fix to the cookie `Max-Age` drift identified in Phase 1.

The web client is **pure functions only** — no UI components, no React hooks, no reactive state primitives. It wraps `fetch` and `navigator.credentials`, handles base64url ↔ ArrayBuffer conversion, manages session-token storage, and surfaces typed errors that mirror the protocol's error codes. A future React adapter sits on top of this; that is explicit Phase 4+ work.

A reference Vite app (`examples/web-demo`) exercises every flow end-to-end against the real Hono server, with a Chromium WebDriver-BiDi virtual authenticator for passkey ceremonies.

## Goals

- A consumer can `pnpm add @mattsmith/passkey-sdk-client-web`, instantiate `createAuthClient({ baseUrl, storage })`, and complete email-OTP and passkey flows in ten or so lines of app code.
- Cookie mode "just works" with CSRF protection — no extra client wiring required.
- Header mode keeps the client portable to non-cookie contexts (cross-origin, native WebView, future React Native).
- Public methods never expose the raw session token. Callers get `{ user }`, `{ otpId }`, etc.
- Errors are exhaustive and typed: each protocol error code, plus `network` and `passkey_*` codes for browser-side failures, maps to a discriminable `AuthClientError`.
- The package builds to ESM only, has no runtime dependencies, and works in any modern browser without a bundler-specific transform.

## Non-goals (Phase 2)

- React / Vue / Svelte adapters or hooks.
- Drop-in UI components (sign-in form, passkey-management widget, etc.).
- Reactive session state (an observable `currentUser` store). Apps coordinate that themselves; the client is imperative.
- A non-browser fetch transport (Node, React Native). The client targets browsers.
- The Swift/iOS client (Phase 3).
- A shared cross-platform contract conformance suite. Deferred to Phase 3 when a second client makes it pay off.
- Multi-process passkey challenge store, transports backfill at registration, Postgres/Express adapters — all carried over from Phase 1's deferred list.

---

## Architecture

### New package

```
packages/client-web/                   # @mattsmith/passkey-sdk-client-web
├── package.json                       # ESM, "browser" target, no runtime deps
├── tsup.config.ts                     # mirrors core/hono — esm + .d.ts
├── src/
│   ├── index.ts                       # public exports
│   ├── client.ts                      # createAuthClient(config) — public façade
│   ├── transport.ts                   # fetch wrapper: csrf, mode, error mapping
│   ├── storage.ts                     # token storage abstraction (cookie | header)
│   ├── webauthn.ts                    # navigator.credentials wrapper + base64url codec
│   ├── errors.ts                      # AuthClientError + ErrorCode union
│   └── types.ts                       # AuthClientConfig, result shapes, internal types
└── tests/
    ├── transport.test.ts              # csrf, headers, error mapping (msw)
    ├── storage.test.ts                # cookie vs header round-trips
    ├── webauthn.test.ts               # base64url codec, NotAllowedError mapping
    ├── client-email.test.ts           # OTP flow against msw
    ├── client-passkey.test.ts         # passkey flows with mocked navigator.credentials
    └── client-session.test.ts         # /me, sign-out, sessions, passkeys list/delete
```

The package boundary is symmetric with `packages/core` and `packages/hono`: a single public façade (`createAuthClient`) backed by small one-purpose files. Tests live alongside the package.

### Touched packages

```
packages/hono/src/index.ts             # CSRF middleware + cookie Max-Age threading
packages/hono/tests/routes.test.ts     # CSRF coverage added
spec/protocol.md                       # +csrf_required, +invalid_request, X-CSRF-Token
```

### New example

```
examples/web-demo/                     # private workspace package
├── package.json                       # vite + @mattsmith/passkey-sdk-client-web (workspace:*)
├── vite.config.ts
├── index.html
├── src/main.ts                        # minimal UI exercising every method on the client
├── playwright.config.ts
└── tests/
    └── e2e.test.ts                    # full flow vs real Hono server, virtual authenticator
```

The Vite app talks to the existing `examples/hono-app` over a configured base URL (default `http://localhost:3000/auth`). Both run together for the e2e.

### Boundary rules (held)

- `client-web` imports nothing from `core`, `hono`, or `cli`. The HTTP contract is its only seam against the server.
- Tests in `client-web` never reach into the server packages — they mock the contract via msw.
- The example app imports the published-shape entry points (`@mattsmith/passkey-sdk-client-web`) via workspace resolution.

---

## Public API

```ts
import { createAuthClient } from "@mattsmith/passkey-sdk-client-web";

const client = createAuthClient({
  baseUrl: "https://api.example.com/auth",
  storage: "cookie", // or "header"
});

// Email OTP
const { otpId, expiresInSeconds } = await client.startEmailSignIn(email);
const { user } = await client.verifyEmailOtp(otpId, code);

// Passkey
const { passkeyId } = await client.registerPasskey({ deviceName: "MacBook" });
const { user } = await client.signInWithPasskey();

// Session
const { user } = await client.getCurrentUser();
await client.signOut();

// Management
const { sessions } = await client.listSessions();
const { passkeys } = await client.listPasskeys();
await client.deletePasskey(passkeyId);
```

Method names track `packages/core/src/auth.ts` (Phase 1) so app code reads identically on both sides of the boundary. The earlier `signInWithEmail` shorthand from the original design spec is dropped in favor of the explicit two-step shape (`startEmailSignIn` + `verifyEmailOtp`) that matches the protocol.

### Configuration

```ts
type AuthClientConfig = {
  baseUrl: string;                       // e.g. "https://api.example.com/auth"
  storage: "cookie" | "header";          // session-token mode; fixed at construction
  fetch?: typeof fetch;                  // override (testing, custom transport); defaults to global fetch
  storageKey?: string;                   // header mode only; localStorage key. Default "passkey-sdk:session"
  csrfCookieName?: string;               // cookie mode only. Default "csrf"
};
```

No reactive state, no event emitters, no global singleton. Apps that want a "current user" store wrap `getCurrentUser()` themselves.

### Result shapes

All result types are explicit and minimal:

```ts
type AuthUser = { id: string; email: string };

type StartEmailSignInResult = { otpId: string; expiresInSeconds: number };
type VerifyEmailOtpResult = { user: AuthUser };
type RegisterPasskeyResult = { passkeyId: string };
type SignInWithPasskeyResult = { user: AuthUser };
type GetCurrentUserResult = { user: AuthUser };
type ListSessionsResult = { sessions: SessionSummary[] };
type ListPasskeysResult = { passkeys: PasskeySummary[] };

type SessionSummary = {
  createdAt: number; expiresAt: number; lastSeenAt: number;
  userAgent: string | null; ip: string | null;
};
type PasskeySummary = {
  id: string; deviceName: string | null;
  createdAt: number; lastUsedAt: number | null;
  transports: string[] | null;
};
```

The raw `sessionToken` field returned by the server is **never surfaced**. Cookie mode discards it (the browser already has the cookie); header mode persists it to `localStorage` and strips it from the public result.

---

## Internals

### Storage modes

Two implementations behind one tiny interface:

```ts
interface SessionStorage {
  load(): string | null;
  save(token: string): void;
  clear(): void;
  attachToRequest(headers: Headers): void;  // header mode adds Authorization; cookie mode is a no-op
}
```

- **`cookie` mode** — `attachToRequest` is a no-op (the browser handles the `session` cookie). `save`/`load`/`clear` are also no-ops; the SDK trusts the browser's cookie jar. The transport sets `credentials: "include"` on every request.
- **`header` mode** — `save` writes to `localStorage[storageKey]`. `attachToRequest` adds `Authorization: Bearer <token>`. `clear` removes the entry. The transport extracts `sessionToken` from `/auth/email/verify` and `/auth/passkey/sign-in/finish` responses and calls `save` before returning the public result.

The mode is fixed at construction. Switching modes mid-session is unsupported (and unnecessary — apps pick one at integration time).

### CSRF (cookie mode only)

Double-submit cookie pattern, automatic on both sides.

**Server (Hono adapter):**
- A `csrf` cookie is issued alongside `session` on every session-issuing response (`/auth/email/verify`, `/auth/passkey/sign-in/finish`). Value is 32 random bytes, base64url-encoded. Attributes: `Path=/`, `SameSite=Lax`, `Secure` when behind HTTPS, **not** `HttpOnly` (the JS client must read it).
- New middleware `csrfMiddleware` runs on every non-GET, non-HEAD route under the auth prefix when a `cookieName` is configured. When the incoming request carries a `session` cookie, it compares the `csrf` cookie to the `X-CSRF-Token` header; mismatch or absence → 403 `{ error: "csrf_required" }`.
- Sign-out clears both `session` and `csrf` cookies.
- Bypass: requests with no `session` cookie skip the check entirely. This covers (a) pre-session traffic — `/auth/email/start`, `/auth/email/verify`, `/auth/passkey/sign-in/start`, `/auth/passkey/sign-in/finish` — and (b) header-mode clients that authenticate via `Authorization: Bearer …` without a cookie.

**Client (`transport.ts`, cookie mode):**
- Before each non-GET request, read `document.cookie` for `csrfCookieName` (default `"csrf"`).
- If present, set `X-CSRF-Token: <value>` on the request.
- If absent on a flow that requires it (anything authenticated), proceed anyway and let the server's 403 surface as `AuthClientError("csrf_required")` — the client never invents a value.
- The CSRF cookie is set by the response from `/auth/email/verify` / `/auth/passkey/sign-in/finish`; the next request then carries the header.

### WebAuthn wrapper

The server returns and accepts base64url-encoded ArrayBuffer fields. The browser's `navigator.credentials` API uses real ArrayBuffers. The wrapper bridges them:

**Inbound (server → `navigator.credentials.create`/`get`):**
- Convert `options.challenge`, `options.user.id`, `options.excludeCredentials[].id`, `options.allowCredentials[].id` from base64url string → `ArrayBuffer`.
- Pass the resulting `PublicKeyCredentialCreationOptions` / `PublicKeyCredentialRequestOptions` verbatim to `navigator.credentials.create({ publicKey })` / `.get({ publicKey })`.

**Outbound (`PublicKeyCredential` → server):**
- Extract `id`, `rawId`, `response.{clientDataJSON, attestationObject | authenticatorData, signature, userHandle}` and `type`.
- Convert each ArrayBuffer field → base64url string.
- POST as the `credential` field on `/auth/passkey/register/finish` or `/auth/passkey/sign-in/finish`.

**Error mapping:**
- `NotAllowedError` (user dismissed prompt, timeout, no credential available) → `AuthClientError("passkey_cancelled", ...)`.
- `InvalidStateError` (e.g. credential already registered for this RP) → `AuthClientError("passkey_failed", ...)`. Same for `SecurityError`, `NotSupportedError`, `AbortError`.
- Any other thrown error from the API → `AuthClientError("passkey_failed", ...)` with the original error attached as `cause`.

The base64url codec is implemented inline (no `Buffer`, no third-party dep) — about 30 lines using `atob`/`btoa` + URL-safe replacement.

### Error mapping

```ts
class AuthClientError extends Error {
  code: AuthClientErrorCode;
  status?: number;
  cause?: unknown;
}

type AuthClientErrorCode =
  // From the server
  | "invalid_otp" | "otp_attempts_exceeded" | "otp_expired"
  | "invalid_credential" | "unknown_credential" | "unauthenticated"
  | "rate_limited" | "csrf_required" | "invalid_request"
  // Client-only
  | "network"           // fetch threw, response wasn't JSON, etc.
  | "passkey_cancelled" // NotAllowedError, AbortError
  | "passkey_failed"    // any other navigator.credentials failure
  | "unsupported";      // running where navigator.credentials doesn't exist
```

The transport reads `{ error, message }` from non-2xx responses and constructs the matching `AuthClientError`. Unrecognized server error strings still produce an `AuthClientError` whose `code` is the raw string typed as a fallback — apps can switch on it without losing forward-compat as new server codes arrive.

`invalid_request` (Phase 1's ZodError → 400 mapping) is included as a first-class code per Phase 1's completion notes.

---

## Server v0.1 fixes (folded into Phase 2)

### 1. Cookie `Max-Age` threading

`packages/hono/src/index.ts:45` currently hard-codes `sessionLifetime = 60 * 60 * 24 * 30`. Replace with a read of `auth.config.session.lifetimeSeconds` (already exposed through `createAuth`'s closure). If unset, fall back to 30 days. Existing routes use the same value when setting and clearing the cookie.

Test: a `lifetimeSeconds: 3600` config sets `Max-Age=3600` on the response cookie.

### 2. CSRF middleware

New export `csrfMiddleware` from `@mattsmith/passkey-sdk-hono`. `mountAuthRoutes` installs it automatically when `cookieName` is configured (the existing condition that already controls cookie issuance). Behavior:

- On `/auth/email/verify` and `/auth/passkey/sign-in/finish`, the route handler additionally sets the `csrf` cookie (32 random bytes, base64url) using the same `Max-Age` as `session`.
- The middleware runs after route matching but before the handler. Skips GET/HEAD. Skips when `Authorization: Bearer …` is present and no `session` cookie is present (bearer-mode bypass).
- On mismatch or absence → 403 `{ error: "csrf_required", message: "CSRF token missing or invalid" }`.
- On `/auth/sign-out`, the response clears both cookies (existing handler clears `session`; extend it to clear `csrf`).

Test additions in `hono/tests/routes.test.ts`:
- Cookie mode + non-GET + missing header → 403 `csrf_required`.
- Cookie mode + non-GET + matching header → original status.
- Bearer mode (no cookie) + non-GET + no header → original status.
- Sign-out clears both cookies.

### 3. Spec update

`spec/protocol.md` gains:
- A short "CSRF" section documenting the double-submit pattern, header name, and the `csrf` cookie.
- `csrf_required` (403) and `invalid_request` (400) entries in the error code table.
- A note that bearer-mode clients omit the `X-CSRF-Token` header.

---

## Testing strategy

### `client-web` (vitest + jsdom + msw)

| Suite | Covers |
|---|---|
| `transport.test.ts` | base URL composition, mode selection, header attach, CSRF read+attach, response error mapping for every protocol code, network-failure mapping |
| `storage.test.ts` | cookie no-ops; header mode round-trip via mocked `localStorage`; clear on sign-out |
| `webauthn.test.ts` | base64url codec round-trip with random buffers; NotAllowedError → `passkey_cancelled`; missing `navigator.credentials` → `unsupported` |
| `client-email.test.ts` | start → verify happy path; verify with bad code surfaces `invalid_otp`; expired surfaces `otp_expired`; over-limit surfaces `otp_attempts_exceeded`; cookie mode discards token, header mode persists it |
| `client-passkey.test.ts` | register start → finish with mocked `navigator.credentials.create`; sign-in start → finish with mocked `.get`; assertion failure surfaces `invalid_credential`; cancelled prompt surfaces `passkey_cancelled` |
| `client-session.test.ts` | `getCurrentUser` 200 + 401 paths; `signOut` clears storage in header mode; `listSessions`/`listPasskeys`/`deletePasskey` shapes |

`navigator.credentials` is mocked via `vi.stubGlobal`. msw mocks `fetch` against the protocol; tests assert request shapes (path, method, headers, body) as well as response handling. Target ~50 tests.

### `examples/web-demo` (Playwright + virtual authenticator)

One end-to-end test drives the demo UI through every flow against a real `examples/hono-app` instance:

1. `pnpm --filter hono-app-example dev` (background, port 3000) — actually started by Playwright's `webServer` config.
2. `pnpm --filter web-demo dev` (background, port 5173) — same.
3. Playwright launches Chromium with WebDriver BiDi enabled, adds a virtual authenticator (`CDPSession.send("WebAuthn.addVirtualAuthenticator")`).
4. Test: start email OTP → grab the OTP from server stdout (or a test-only `/__test/last-otp` endpoint guarded by `NODE_ENV=test`) → verify → register passkey → sign out → sign back in with passkey → fetch `/auth/me` → matches.

The test-only endpoint is the simplest path; a small TODO note in `hono-app` makes it clear it's for the e2e harness only. Alternative (parsing stdout) is brittle.

### `hono` adapter

Routes test gains four CSRF-related cases as listed in §"CSRF middleware" above. No other server changes.

---

## Configuration and defaults

| Setting | Default | Configurable | Reasoning |
|---|---|---|---|
| `storage` | (required) | Yes | App must pick — affects every request |
| `csrfCookieName` | `"csrf"` | Yes | Match the server default |
| `storageKey` (header mode) | `"passkey-sdk:session"` | Yes | Avoid collision with app-owned localStorage entries |
| `fetch` override | global `fetch` | Yes | Tests, custom transports |
| Server CSRF | on when `cookieName` set | Yes | New `mountAuthRoutes` option `csrf: false` for opt-out (e.g. when an upstream gateway handles it) |

---

## Open questions and explicit deferrals

1. **CSRF cookie attributes.** Default to `Path=/`, `SameSite=Lax`, `Secure` when the request was HTTPS, no `HttpOnly`. App-level overrides via `mountAuthRoutes` are out of scope for v0.1 — projects that need different attributes can fork the middleware.
2. **CSRF on `/auth/email/start`.** Email-start is currently unauthenticated and pre-session; CSRF is not required. The middleware bypass on missing `session` cookie covers this naturally.
3. **`getCurrentUser` user-email enrichment.** Phase 1 returns `email: ""` on `/auth/me` and on passkey sign-in. The web client surfaces this verbatim. Apps that need the email hit their own users endpoint (per the design spec's principle that the project owns the users table). No SDK-side enrichment hook in v0.1.
4. **Cleanup of expired rows.** Phase 1's `auth.cleanup()` is unchanged; not in Phase 2 scope.
5. **Building for older browsers.** Output target ES2022; consumers who need older support transpile downstream. No bundled polyfills.
6. **Bundler strategy for `web-demo`.** Vite (matches Phase 1's casual-tooling baseline). No SSR.

---

## Files Phase 2's plan should reference first

1. `Passkey/spec/protocol.md` — the contract being implemented.
2. `Passkey/packages/hono/src/index.ts` — current cookie issuance and route shapes; CSRF middleware lands alongside.
3. `Passkey/packages/core/src/auth.ts` — public façade types (`Auth`, `AuthRuntime`) the example will consume.
4. `Passkey/examples/hono-app/src/index.ts` — server the demo and e2e talk to.
5. `Passkey/docs/superpowers/notes/2026-05-04-phase-1-completion.md` — known deviations, open items, repo conventions.
6. `Passkey/docs/superpowers/specs/2026-05-03-passkey-sdk-design.md` — overall design (cross-platform RP-ID/origins reasoning, naming).

---

## Acceptance

Phase 2 is complete when:

- `@mattsmith/passkey-sdk-client-web` builds, typechecks, and passes its test suite (~50 tests).
- `examples/web-demo` passes its single Playwright e2e against a live `hono-app`.
- `examples/hono-app/tests/e2e.test.ts` continues to pass with CSRF middleware enabled.
- `spec/protocol.md` documents `csrf_required`, `invalid_request`, and the X-CSRF-Token header.
- `packages/hono/tests/routes.test.ts` passes with new CSRF and Max-Age coverage.
- A Phase 2 completion notes doc is committed under `docs/superpowers/notes/`, and the project memory entry is updated to point Phase 3 at it.
