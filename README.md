# Passkey SDK

Self-hosted email-OTP + passkey authentication for personal apps. Drop a few packages into a Hono server, point a web or iOS client at it, and you have passwordless sign-in backed by SQLite — no external auth service required at runtime.

The defining constraint is **multi-platform from day one**: a single project's backend serves both a web client and a native Apple-platform client, both of which register and authenticate passkeys against the same user accounts.

## Features

- **Email OTP + WebAuthn passkeys.** First sign-in by emailed code; every subsequent device by passkey.
- **SQLite-backed.** No Postgres, no Redis, no third-party auth provider. A single `.db` file per environment.
- **One HTTP contract.** Every client implements [`spec/protocol.md`](spec/protocol.md); swap clients without touching the server.
- **Cookie or bearer sessions.** Cookies (with built-in CSRF middleware) for the web; bearer tokens for iOS.
- **Zero-runtime-dep web client.** Just `fetch`, `navigator.credentials`, `localStorage`, `document.cookie`.
- **Native iOS / macOS Swift Package.** `URLSession` + `AuthenticationServices` + Keychain.

## Status

> **Personal project.** Built for one developer's apps. Nothing published to npm or SwiftPM yet — consumed via workspace links and SwiftPM path dependencies. No public stability guarantees. Code is here to read, fork, and learn from.

- **Phase 1 — TypeScript server:** shipped (`packages/core`, `packages/hono`, `packages/cli`).
- **Phase 2 — Web client:** shipped (`packages/client-web`) plus cookie-mode prerequisites on the server (CSRF middleware, `Secure` cookies, threaded `Max-Age`).
- **Phase 3 — Swift / iOS client:** shipped (`clients/PasskeySDK`) plus a SwiftUI demo (`clients/ios-demo`).
- **Phase 4 — Go server:** shipped (`servers/go/`, `examples/go-app`). Peer implementation of the TS server; both pass the same `tests/parity/` HTTP conformance suite under a CI matrix (`pnpm test:parity --server={ts,go}`).

## Server implementations

The SDK ships two interchangeable server implementations of the same HTTP
contract (`spec/protocol.md`). Pick the one that fits your stack — the web
(`packages/client-web`) and Swift (`clients/PasskeySDK`) clients work against
either unchanged.

- **TypeScript:** `packages/core` + `packages/hono`. Consumed via `examples/hono-app`. Best for Node/Bun apps already using Hono.
- **Go:** `servers/go/`. Consumed via `examples/go-app`. Best for Go apps; `httpapi.Mount(r, cfg)` mounts on any `chi` router.

Both are exercised against the same `tests/parity/` HTTP conformance suite.
Run `pnpm test:parity --server=ts` or `--server=go` to verify either against
the vector library. CI runs both legs on every push.

## Packages

| Package | Description |
|---|---|
| [`@mattsmith/passkey-sdk-core`](packages/core) | Server: pure TS — email OTP, WebAuthn ceremonies, sessions, SQLite storage. No HTTP. |
| [`@mattsmith/passkey-sdk-hono`](packages/hono) | Server: Hono adapter — mounts `/auth/*` routes, CSRF middleware, cookie issuance. |
| [`@mattsmith/passkey-sdk-cli`](packages/cli) | Server: `passkey-sdk migrate <db>` for running schema migrations. |
| [`@mattsmith/passkey-sdk-client-web`](packages/client-web) | Browser client: `fetch` + `navigator.credentials` wrapper, typed errors, cookie/header session modes. |
| [`PasskeySDK`](clients/PasskeySDK) (Swift) | Native iOS / macOS client: `URLSession` + `AuthenticationServices` + Keychain. Bearer-mode only. |
| [`servers/go`](servers/go) | Server: Go peer implementation of the TS server. Mountable on any `chi` router; backed by `modernc.org/sqlite` (pure Go, no cgo) and `github.com/go-webauthn/webauthn`. |

## Examples

| Example | Description |
|---|---|
| [`examples/hono-app`](examples/hono-app) | Reference server using the Hono adapter. Console-logs OTPs in dev. |
| [`examples/web-demo`](examples/web-demo) | Vite app exercising every public method of the web client. Has a Playwright e2e with a Chromium WebAuthn virtual authenticator. |
| [`examples/go-app`](examples/go-app) | Reference Go server using `servers/go`. Auto-booted by the parity runner under `--server=go`. |
| [`clients/ios-demo`](clients/ios-demo) | SwiftUI app exercising every public method of `PasskeySDK`. Manual run target. |

## Quick start

### Server (Hono)

```ts
import Database from "better-sqlite3";
import { Hono } from "hono";
import { createAuth, runMigrations } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "@mattsmith/passkey-sdk-hono";

const db = new Database("./app.db");
runMigrations(db);

const auth = createAuth({
  rpId: "example.com",
  origins: ["https://app.example.com"],
  session: { lifetimeSeconds: 60 * 60 * 24 * 30, cookieName: "session" },
  email: {
    sendOtp: async ({ to, code }) => {
      // BYO transport — Resend, SES, console.log in dev, etc.
    },
  },
  users: {
    findOrCreateByEmail: async (email) => {
      // Project owns the users table. Return a user_id.
    },
  },
}, { db });

const app = new Hono();
mountAuthRoutes(app, auth);   // CSRF middleware + cookies are default-on
```

### Web client

```ts
import { createAuthClient } from "@mattsmith/passkey-sdk-client-web";

const client = createAuthClient({
  baseUrl: "https://api.example.com/auth",
  storage: "cookie",   // or "header" for bearer-token mode
});

const { otpId } = await client.startEmailSignIn("matt@example.com");
const { user } = await client.verifyEmailOtp(otpId, "482917");

await client.registerPasskey({ deviceName: "MacBook" });
const { user: signedIn } = await client.signInWithPasskey();

await client.signOut();
```

## Repository layout

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
├── tests/
│   └── parity/                   # Cross-implementation HTTP conformance suite
│       ├── runner/               #   Node CLI (vitest self-tests + scenario runner)
│       └── vectors/              #   JSON scenarios — one per protocol behavior
└── docs/superpowers/
    ├── specs/                    # Design specs
    ├── plans/                    # Implementation plans
    └── notes/                    # Per-phase completion notes
```

## Development

```bash
pnpm install         # idempotent
pnpm build           # builds all four packages
pnpm typecheck       # tsc --noEmit across all packages
pnpm test            # runs vitest in core + hono + client-web
```

Per-example tests:

```bash
pnpm --filter hono-app-example test     # 3 tests (server e2e via app.request)
pnpm --filter web-demo-example test     # Playwright e2e (needs port 3001 free; uses NODE_ENV=test internally)
```

Conformance suite (spec/protocol.md → vectors):

```bash
pnpm test:parity     # vitest self-tests + auto-boot hono-app + run every vector
```

See [`tests/parity/README.md`](tests/parity/README.md) for the vector format,
how to add a new scenario, and how to point the runner at a non-reference
server with `--url`.

Run the reference server:

```bash
( cd examples/hono-app && pnpm migrate )    # creates ./app.db
( cd examples/hono-app && pnpm dev )        # listens on :3000, OTPs printed to stdout
```

Run the reference web demo (talks to `examples/hono-app`):

```bash
( cd examples/hono-app && pnpm dev )        # in one terminal
( cd examples/web-demo && pnpm dev )        # in another, listens on :5173
```

## Conventions

- Node ≥20, ESM-only, `NodeNext` module resolution.
- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Each package has one clear purpose and a small public surface.
- `core` knows nothing about HTTP; the Hono adapter is thin.
- The web client has no runtime dependencies — only `fetch`, `navigator.credentials`, `localStorage`, `document.cookie`.

## Further reading

- [`spec/protocol.md`](spec/protocol.md) — the HTTP contract (errors, CSRF, every endpoint)
- [`docs/superpowers/specs/2026-05-03-passkey-sdk-design.md`](docs/superpowers/specs/2026-05-03-passkey-sdk-design.md) — overall design
- [`docs/superpowers/notes/2026-05-04-phase-1-completion.md`](docs/superpowers/notes/2026-05-04-phase-1-completion.md) — Phase 1 server handoff
- [`docs/superpowers/notes/2026-05-04-phase-2-completion.md`](docs/superpowers/notes/2026-05-04-phase-2-completion.md) — Phase 2 web-client handoff

### Registration ownership (September 2026)

The TypeScript core `finishPasskeyRegistration` method now requires `userId`,
resolved from a verified server-side session. Direct callers must supply this
field; omission fails closed. The Hono adapter resolves it automatically, so
the HTTP request body and browser/iOS clients are unchanged. Go mounted routes
also bind completion to the current authenticated account. A different account
cannot finish or consume the owner's pending ceremony.

This binds account identity only. It does not provide host account-enabled
checks or atomically serialize registration persistence with host revocation.

### Host-owned registration persistence

Go `httpapi.Config.PasskeyRegistration` and TS `passkey.registrationCommit`
replace the final credential write after WebAuthn verification. The host must
check account eligibility and the supplied initiating session hash under the
same writer/transaction as persistence, sample `Now`/`now` after obtaining that
writer, and commit before returning success. Failures never fall back to the
SDK write. The challenge is spent once verification begins, including on host
failure, so the user must begin a fresh ceremony before retrying.

Host commit mode additionally binds a pending ceremony to its original verified
session. A different session on the same account cannot resume it. TS direct
`createAuth` registration calls must supply the original HTTP `request` when
this option is configured; Hono forwards it automatically. Go
`storage.CreateSQLitePasskeyInTx` preserves SDK field encoding while letting a
host own the transaction. This extension does not itself implement a host
account lifecycle or authorize registration-start data access.

### Go host-owned registration-start admission

Go `httpapi.Config.PasskeyRegistrationStart` optionally admits registration
start after SDK session verification. The callback receives the verified user
ID, a copy of the initiating session hash, the clock function and request. The
host must order current account/session/expiry checks with revocation.
Configured mode uses the verified identity to create options without reading
existing passkeys: WebAuthn registration start does not need those rows.

Return `auth.ErrUnauthenticated` for an ineligible initiating session. Other
failures produce 503 `session_unavailable` with `Retry-After: 1`. Refusal creates
no pending ceremony and never falls back to the default storage read. The
preliminary SDK session lookup/touch still occurs before this callback; it is
outside the host admission transaction. A nil callback preserves existing behavior.

Admission can win before a later revocation, with the response or pending ceremony
created afterward. Hosts requiring lifecycle safety must also configure
`PasskeyRegistration` to recheck the initiating session and account at persistence.
Mount does not enforce this pairing. This Go-only extension changes no default
wire payload or TypeScript behavior and does not implement account lifecycle.

### Go host-owned account management

`httpapi.Config.AccountManagement` optionally owns current account/session
admission together with `/auth/me`, session listing, passkey listing and owned
passkey deletion. The callback receives the named operation, verified identity,
copied initiating session hash, optional copied deletion ID, request and clock.
Return the requested rows or complete the deletion only after your lifecycle
transaction commits. A check followed by an unguarded read/write is insufficient.

`auth.ErrUnauthenticated` becomes 401; deletion `storage.ErrNotFound` becomes
404 `unknown_credential`. Other failures and foreign returned rows become 503
`session_unavailable` with `Retry-After: 1`, without fallback or private error
text. A nil callback preserves default SDK behavior. SDK SQLite transaction
helpers share the default row decoders and retain the caller's transaction;
owned deletion is constrained by both owner and credential ID.

Initial SDK session lookup/touch is outside the host transaction. A winning
snapshot may be delivered after later revocation; it was authorized when read.
Ceremonies, sign-out, host account lifecycle and TypeScript host integration
are outside this opt-in. Registration admission and final commit must still be
configured independently where needed. Default HTTP/TypeScript behavior is unchanged.
