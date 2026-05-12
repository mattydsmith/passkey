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

## Packages

| Package | Description |
|---|---|
| [`@mattsmith/passkey-sdk-core`](packages/core) | Server: pure TS — email OTP, WebAuthn ceremonies, sessions, SQLite storage. No HTTP. |
| [`@mattsmith/passkey-sdk-hono`](packages/hono) | Server: Hono adapter — mounts `/auth/*` routes, CSRF middleware, cookie issuance. |
| [`@mattsmith/passkey-sdk-cli`](packages/cli) | Server: `passkey-sdk migrate <db>` for running schema migrations. |
| [`@mattsmith/passkey-sdk-client-web`](packages/client-web) | Browser client: `fetch` + `navigator.credentials` wrapper, typed errors, cookie/header session modes. |
| [`PasskeySDK`](clients/PasskeySDK) (Swift) | Native iOS / macOS client: `URLSession` + `AuthenticationServices` + Keychain. Bearer-mode only. |

## Examples

| Example | Description |
|---|---|
| [`examples/hono-app`](examples/hono-app) | Reference server using the Hono adapter. Console-logs OTPs in dev. |
| [`examples/web-demo`](examples/web-demo) | Vite app exercising every public method of the web client. Has a Playwright e2e with a Chromium WebAuthn virtual authenticator. |
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
