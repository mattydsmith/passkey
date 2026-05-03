# Passkey SDK — Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-05-03
**Author:** Matt Smith

---

## Overview

A small, opinionated SDK for adding passwordless authentication to personal projects. Two login methods: 6-digit email OTP and passkeys (WebAuthn). Each project that uses the SDK runs its own auth code against its own database — there is no shared auth service.

The defining constraint is **multi-platform from day one**: a single project's backend serves both a web client and a native Apple-platform (iOS/macOS) client, both of which need to register and authenticate passkeys against the same user accounts.

## Goals

- One npm install (or Swift Package add) and a few lines of configuration to drop passwordless auth into a new project.
- Email OTP and passkey sign-in working symmetrically across web and iOS clients.
- Self-contained: no external auth service required at runtime.
- Project's existing users table stays the source of truth; the SDK only references it.
- Small, well-bounded packages that are easy to read, test, and extend.

## Non-Goals (v1)

- Other databases beyond SQLite (Postgres, MySQL, Turso) — design must permit this later.
- Other server frameworks beyond Hono (Express, Fastify, Next.js) — same.
- A Go server SDK — the protocol is defined to allow this; implementation is later.
- React hooks or drop-in UI components — clients ship pure functions only.
- Magic links, OAuth/social providers, multi-factor beyond passkey-as-MFA, account linking, multi-tenancy, admin UI.
- Rate limiting (the contract reserves the error code; enforcement is left to projects/proxies).

---

## Architecture

A monorepo of small, well-bounded packages. The HTTP/JSON contract between client and server is the durable artifact every package implements or consumes.

```
passkey-sdk/
├── spec/
│   └── protocol.md              # The HTTP contract — source of truth
│
├── packages/
│   ├── core/                    # TS server: pure functions, no HTTP
│   │   ├── src/
│   │   │   ├── email-otp.ts     # generate, hash, verify codes
│   │   │   ├── passkey.ts       # WebAuthn ceremonies (uses @simplewebauthn/server)
│   │   │   ├── session.ts       # create, validate, revoke
│   │   │   └── storage.ts       # SQLite schema + queries
│   │   └── migrations/
│   │       └── 001_init.sql
│   │
│   ├── hono/                    # TS server: Hono adapter — mounts /auth/* routes
│   │   └── src/index.ts
│   │
│   ├── client-web/              # JS/TS web client — pure functions
│   │   └── src/index.ts
│   │
│   └── client-swift/            # Swift iOS/macOS client — pure functions
│       └── Sources/PasskeySDK/
│
└── examples/
    ├── hono-app/                # Reference TS server using packages/hono
    ├── web-demo/                # Browser app using client-web
    └── ios-demo/                # SwiftUI app using client-swift
```

### Architectural principles

- **`core` knows nothing about HTTP.** It takes structured inputs, returns structured outputs. All side effects (DB, time, randomness, ID generation, email sending) flow through injected dependencies for testability.
- **The Hono adapter is thin.** Roughly 150 LOC: parse request → call core → serialize response. Future framework adapters follow the same shape.
- **Both clients implement the same contract.** Symmetric API surface across web and iOS so the mental model carries over. A future Go server is a sibling package implementing the same contract; clients don't change.
- **Each package has a single, clear purpose.** A reader should be able to answer "what does this do, how do you use it, what does it depend on" without reading internals.

### Cross-platform passkey configuration

For a single backend to serve both a web client and an iOS app sharing the same passkeys:

- **RP ID** is set to the apex domain (e.g., `example.com`).
- **Web origins** include all subdomains the web client runs on (e.g., `https://app.example.com`, `https://example.com`).
- **iOS** declares Associated Domains: `webcredentials:example.com` and `applinks:example.com`.
- **AASA file** (`/.well-known/apple-app-site-association`) is served from the web domain. The SDK provides a helper that produces the JSON.

---

## Data model

The SDK owns three SQLite tables. None of them are the project's `users` table — the project owns that.

### `auth_passkeys` — registered credentials

One row per passkey. A user may have many (phone, laptop, backup device).

Stored:
- `credential_id` (BLOB, primary key) — the WebAuthn credential ID
- `user_id` (TEXT) — reference to the project's user
- `public_key` (BLOB) — COSE-encoded public key
- `sign_count` (INTEGER) — replay-protection counter; verified on every assertion
- `transports` (TEXT, JSON array) — e.g. `["internal","hybrid"]`; lets clients hint which authenticators to surface
- `aaguid` (BLOB) — authenticator model identifier
- `device_name` (TEXT) — user-facing label, e.g. "iPhone 15"
- `created_at`, `last_used_at` (INTEGER, unix seconds)

Index on `user_id` for "list my passkeys" and per-user lookups.

### `auth_sessions` — opaque session tokens

One row per active session.

Stored:
- `token_hash` (BLOB, primary key) — SHA-256 of the raw token; the raw token only lives on the client
- `user_id` (TEXT)
- `created_at`, `expires_at`, `last_seen_at` (INTEGER)
- `user_agent`, `ip` (TEXT, optional) — for "active sessions" UI

Indexes on `user_id` (list/revoke) and `expires_at` (cleanup).

**Hashing rationale:** if the database leaks, an attacker cannot use the leaked tokens to impersonate users — same reason passwords are hashed.

### `auth_email_otps` — pending OTP codes

One row per outstanding code.

Stored:
- `id` (TEXT, primary key) — random ID, returned to the client as `otpId`
- `email` (TEXT)
- `code_hash` (BLOB) — SHA-256 of the 6-digit code
- `attempts` (INTEGER) — incremented on each failed verification; row invalidated at 5
- `created_at`, `expires_at` (INTEGER) — 10-minute lifetime
- `consumed_at` (INTEGER, nullable) — set on first successful verification

The `id` (`otpId` to the client) binds verification to a specific issuance: the client echoes back the same `id` it received, preventing accidental verification of a stale code.

**Why hashing + attempts + single-use matters:** a 6-digit code is 1-in-a-million per guess. Five attempts before invalidation, plus a 10-minute window, makes brute force impractical.

### Project's users table

Untouched. The SDK never reads or writes it. The project provides a `findOrCreateByEmail(email) → user_id` hook; the SDK calls that hook during OTP verification and stores the returned `user_id` in its own tables.

---

## HTTP contract

Three core flows, each a two-step ceremony. Plus session/management endpoints. All requests and responses are JSON. Errors are `{ error: <code>, message: <human string> }` with the codes listed below.

### Flow A — Sign in with email (OTP)

**Step 1.**
```
POST /auth/email/start
Body:    { "email": "matt@example.com" }
200:     { "otpId": "otp_abc123", "expiresInSeconds": 600 }
```
Server creates the OTP row, calls `email.sendOtp({ to, code })`, returns the `otpId`.

**Step 2.**
```
POST /auth/email/verify
Body:    { "otpId": "otp_abc123", "code": "482917" }
200:     { "sessionToken": "tok_…", "user": { "id": "u_42", "email": "..." } }
```
Server verifies the code, calls `users.findOrCreateByEmail`, creates a session.

(The `otpId` field is named distinctly to avoid collision with the WebAuthn `challenge` field used in passkey flows.)

### Flow B — Register a passkey (authenticated)

**Step 1.**
```
POST /auth/passkey/register/start    (authenticated request)
200: { "options": { "challenge": "...", "rp": {...}, "user": {...},
                    "pubKeyCredParams": [...], ... } }
```
Authenticated requests carry the session token either as a cookie (`Cookie: session=tok_…`) or a header (`Authorization: Bearer tok_…`). Both are accepted; the client picks one mode at construction time.
Returns the WebAuthn creation options. Client passes verbatim into `navigator.credentials.create()` (web) or `ASAuthorizationPlatformPublicKeyCredentialProvider` (iOS).

**Step 2.**
```
POST /auth/passkey/register/finish
Body: { "credential": { ...attestation blob... }, "deviceName": "iPhone 15" }
200:  { "passkeyId": "pk_…" }
```
Server verifies the attestation, stores the public key.

### Flow C — Sign in with a passkey

**Step 1.**
```
POST /auth/passkey/sign-in/start
200: { "options": { "challenge": "...", "rpId": "example.com",
                    "allowCredentials": [], "userVerification": "preferred" } }
```
Empty `allowCredentials` means discoverable credentials — no email needed at sign-in time.

**Step 2.**
```
POST /auth/passkey/sign-in/finish
Body: { "credential": { ...assertion blob... } }
200:  { "sessionToken": "tok_…", "user": { "id": "u_42", "email": "..." } }
```
Server looks up the credential, verifies the signature, finds the owning user, creates a session.

### Session and management endpoints

```
GET    /auth/me                 → { user } | 401
POST   /auth/sign-out           → revokes the current session
GET    /auth/sessions           → list of active sessions for the user
DELETE /auth/sessions/:id       → revoke a session ("log out everywhere else")
GET    /auth/passkeys           → list of user's registered passkeys
DELETE /auth/passkeys/:id       → remove a passkey
```

### Error codes

A small fixed set, returned as `{ error, message }`:

| Code | Meaning |
|---|---|
| `invalid_otp` | Wrong code, or row not found |
| `otp_attempts_exceeded` | 5 wrong guesses on this row |
| `otp_expired` | Past the 10-minute window |
| `invalid_credential` | Passkey signature didn't verify |
| `unknown_credential` | Credential ID not found |
| `unauthenticated` | No session, or session expired |
| `rate_limited` | Reserved for future use; not enforced by SDK in v1 |

### Implicit behaviors

- **Account creation is implicit.** The first successful `/auth/email/verify` for an unknown email triggers `users.findOrCreateByEmail`, which is the project's signal to create a user. There is no separate `/sign-up` endpoint.
- **Recovery is implicit.** A user who has lost all their passkeys signs in via email OTP and registers a new passkey. There is no separate recovery flow.

---

## SDK shape per platform

### TS server (Hono adapter)

```ts
import Database from "better-sqlite3";
import { createAuth } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "@mattsmith/passkey-sdk-hono";
import { Hono } from "hono";

const db = new Database("./app.db");

export const auth = createAuth({
  db,
  rpId: "example.com",
  origins: ["https://app.example.com", "https://example.com"],
  session: {
    lifetimeSeconds: 60 * 60 * 24 * 30,
    cookieName: "session",
  },
  email: {
    sendOtp: async ({ to, code }) => {
      // BYO transport
      await resend.emails.send({
        from: "auth@example.com",
        to,
        subject: `Your sign-in code: ${code}`,
        text: `Your code is ${code}. It expires in 10 minutes.`,
      });
    },
  },
  users: {
    findOrCreateByEmail: async (email) => {
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) return existing.id;
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(id, email);
      return id;
    },
  },
});

const app = new Hono();
mountAuthRoutes(app, auth, { prefix: "/auth" });

app.get("/api/me", async (c) => {
  const user = await auth.requireSession(c.req.raw);   // throws 401 if missing
  return c.json({ user });
});

// AASA helper for iOS associated domains
app.get("/.well-known/apple-app-site-association", (c) =>
  c.json(auth.appleAppSiteAssociation({ appIds: ["TEAMID.com.example.MyApp"] }))
);
```

### Web client

```ts
import { createAuthClient } from "@mattsmith/passkey-sdk-client-web";

const client = createAuthClient({
  baseUrl: "https://api.example.com/auth",
  storage: "cookie", // or "header" — controls how the session token is sent
});

const { otpId } = await client.signInWithEmail("matt@example.com");
const { user } = await client.verifyEmailOtp(otpId, "482917");

await client.registerPasskey({ deviceName: "MacBook" });
const { user } = await client.signInWithPasskey();

const me = await client.getCurrentUser();
await client.signOut();
```

The web client wraps `navigator.credentials` internally and surfaces typed errors matching the contract's error codes. **Session token handling is internal**: when an endpoint returns `{ sessionToken, user }`, the client stores the token (cookie or `localStorage`+`Authorization` header, per `storage` config) and the public methods only surface `{ user }`. Callers never touch the raw token.

### iOS/macOS client (Swift)

```swift
import PasskeySDK

let client = AuthClient(baseURL: URL(string: "https://api.example.com/auth")!)

let otpId = try await client.signInWithEmail("matt@example.com")
let user = try await client.verifyEmailOtp(otpId: otpId, code: "482917")

try await client.registerPasskey(deviceName: UIDevice.current.name)
let user = try await client.signInWithPasskey()

let me = try await client.currentUser()
try await client.signOut()
```

The Swift client wraps `AuthenticationServices` (`ASAuthorizationPlatformPublicKeyCredentialProvider`), stores the session token in Keychain (sent as `Authorization: Bearer …` on subsequent requests), and surfaces the same error codes as enum cases. As with the web client, the raw token is internal — public methods return only the user.

---

## Configuration and defaults

| Setting | Default | Configurable | Reasoning |
|---|---|---|---|
| OTP length | 6 digits | No (v1) | Standard; combined with attempt limit + expiry, brute force is impractical |
| OTP expiry | 10 minutes | Yes | Long enough for slow email, short enough that codes don't pile up |
| OTP max attempts | 5 | Yes | Hard limit before row is invalidated |
| Session lifetime | 30 days | Yes | "Remember me" feel without indefinite sessions |
| Session sliding | On | Yes | `last_seen_at` bumps on each request; full inactivity expires |
| `userVerification` | `preferred` | Yes | Best UX; won't fail on devices that lack biometrics |
| Web storage mode | `cookie` | Yes | Or `header`; cookie mode triggers CSRF protection automatically |

### Cross-cutting policy

- **OTP delivery:** BYO transport via `email.sendOtp` callback. SDK never bundles SMTP credentials.
- **CSRF:** SDK uses the double-submit cookie pattern automatically when `storage: "cookie"`. Header mode does not need CSRF.
- **CORS:** Not the SDK's job. Examples will show how to configure it on the server framework.
- **Logging:** SDK accepts an optional `logger`; defaults to no-op. No PII is logged by default.
- **Time, randomness, IDs:** Injected via config (defaults to `Date.now`, `crypto.randomBytes`, etc.). Tests override these.

---

## Testing strategy

- **`core`: integration tests over unit tests.** In-memory SQLite, full flows end-to-end (`startEmailOtp` → email mock captures code → `verifyOtp` → assert session row exists). Vitest. Sub-second runtime.
- **`hono` adapter: HTTP-level tests.** Hit routes via `app.request(...)`, assert status and body. Doubles as contract conformance.
- **`client-web`: contract tests against a mocked HTTP layer.** `msw` mocks the contract; assert client sends correct shapes and surfaces correct errors. WebAuthn calls mocked at `navigator.credentials`.
- **`client-swift`: same pattern using `URLProtocol` for HTTP.** `AuthenticationServices` is wrapped behind a thin protocol seam so tests can substitute fakes.
- **Shared contract conformance suite.** JSON fixtures defining "given this request, server must return this response or this error code." Both server adapters (Hono now, future Express/Go) run the same suite. Both clients verify they emit/parse the same shapes. This is the mechanism that prevents drift between platforms.

---

## Naming

- **Repo:** `passkey-sdk` (working directory `/Users/mattsmith/Documents/Dev/SDKs/Passkey`).
- **npm packages:** `@mattsmith/passkey-sdk-core`, `@mattsmith/passkey-sdk-hono`, `@mattsmith/passkey-sdk-client-web`.
- **Swift package:** `PasskeySDK` (Swift Package Manager).

These are easy to type, signal personal use, and keep the option open to publish without colliding on a generic name.

---

## Open questions and explicit deferrals

1. **Email transport in examples.** The reference Hono example will use `console.log` for OTPs in dev mode and document how to wire up Resend or similar. No transport is bundled.
2. **AASA serving.** SDK provides the JSON; the project decides how to serve it (typically a route on the web server). Examples will show this.
3. **Cleanup of expired rows.** Both `auth_sessions` and `auth_email_otps` accumulate expired rows. v1 ships a `auth.cleanup()` function for the project to call on a schedule (cron, Hono background task, etc.). No automatic cleanup in v1.
4. **Multiple databases.** Storage layer must be designed around an interface that SQLite implements first; Postgres etc. become additional implementations later.
5. **Multiple server frameworks.** The Hono adapter is the template; Express and others follow the same shape. Defer until a project actually needs them.

---

## Future work (not in v1, but design must not block)

- Postgres / Turso / MySQL storage backends
- Express, Fastify, Next.js route handler adapters
- Go server SDK (same contract)
- React hooks layer on top of the web client
- Drop-in UI components
- Rate-limiting middleware
- OAuth / social provider sign-in
- Multi-tenancy / org membership
