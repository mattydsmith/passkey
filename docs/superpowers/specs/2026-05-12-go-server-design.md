# Passkey SDK — Go Server Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-05-12
**Author:** Matt Smith
**Predecessors:**
- `2026-05-03-passkey-sdk-design.md` — overall cross-platform design
- `2026-05-04-passkey-sdk-phase-2-web-client-design.md` — web client (server-agnostic by construction)
- `2026-05-04-passkey-sdk-phase-3-swift-design.md` — Swift client (server-agnostic by construction)
- `docs/superpowers/notes/2026-05-12-parity-vectors-completion.md` — parity suite that enforces cross-impl conformance
- `spec/protocol.md` — the durable HTTP contract both server implementations must satisfy

---

## Overview

This phase introduces a **Go server implementation** of the Passkey SDK that sits as a peer to the existing TypeScript server (`packages/core` + `packages/hono`), not a downstream port. Both servers satisfy the same HTTP contract in `spec/protocol.md`; the existing `tests/parity/` suite is the conformance enforcer and gets extended to run against either implementation. A developer adopting the SDK picks one server language at integration time; the browser (`packages/client-web`) and iOS (`clients/PasskeySDK`) clients remain unchanged because they already speak the protocol, not a server flavor.

The lockstep guarantee — "if Go changes, TS still works, and vice versa" — comes from a CI matrix that runs the full parity suite against both servers on every push. Vectors are the source of truth; a behaviour change that lands on one server but not the other is caught the moment the other leg of the matrix runs.

The Go implementation is shipped as a **library** (mountable `chi` handlers, like `packages/hono`), not just a binary. An accompanying `examples/go-app/` consumes the library the way `examples/hono-app/` consumes the TS packages and is what the parity runner auto-boots.

## Goals

- A developer building a Go HTTP app imports `github.com/mattydsmith/passkey/servers/go`, calls a single `Mount(...)` (or similarly-named) function on their `chi` router with a config struct, and gets the same `/auth/...` routes that `packages/hono` exposes — including OTP, passkey ceremonies, sessions, CSRF, and management endpoints.
- The Go server passes 100% of the parity vectors in `tests/parity/vectors/` — the same vectors the TS server passes.
- `pnpm test:parity` gains a `--server=ts|go` flag (default `ts`), with auto-boot of the matching example app on an ephemeral port. Identical UX for both targets.
- A GitHub Actions workflow runs the parity suite against `--server=ts` and `--server=go` on every push to any branch with the existing PR-style protections.
- No changes to `packages/client-web` or `clients/PasskeySDK` are required. They continue to work against either server unchanged.
- The Go server has no cgo dependencies, so CI and local development run on a clean Go toolchain alone.

## Non-goals (this phase)

- A Go **client** SDK. The web + Swift clients already cover the client surface; a Go client is a clean follow-up if ever desired.
- A Go CLI mirroring `packages/cli`. The CLI's role is dev-ergonomics for TS workflows; nothing in the protocol requires it.
- Production-grade email delivery. The Go server ships with a stub `EmailSender` interface and a logging implementation, same posture as the TS server.
- Multi-process / restart-survival for in-memory passkey challenge maps. Both servers keep the same deferred-work caveat from Phase 1.
- A "pre-merge gate" that rejects spec-changes lacking matching vector-changes. The matrix CI run already catches divergence at vector-add time; we can add this belt-and-braces check later if drift becomes a problem in practice.
- A Go-side "cookie/bearer" client config split. The server treats both modes identically per the protocol — the choice lives in the client transport, which is already shipped.
- Releasing the Go module to a versioned proxy (`v1.0.0` tagging, `pkg.go.dev` polish). Initial consumers will import by commit SHA; tagging is a follow-up.

---

## Architecture

### Repo additions

```
servers/
└── go/                                  # Go module — the SDK as a library
    ├── go.mod                           # module github.com/mattydsmith/passkey/servers/go
    ├── go.sum
    ├── README.md                        # quickstart + mount example
    ├── auth/                            # OTP, session, CSRF middleware, sign-out
    │   ├── otp.go
    │   ├── session.go
    │   ├── csrf.go
    │   └── *_test.go
    ├── passkey/                         # WebAuthn ceremonies
    │   ├── register.go                  # /auth/passkey/register/{start,finish}
    │   ├── signin.go                    # /auth/passkey/sign-in/{start,finish}
    │   ├── management.go                # GET /auth/passkeys, DELETE /auth/passkeys/:id
    │   └── *_test.go
    ├── storage/                         # interface + SQLite impl
    │   ├── storage.go                   # Storage interface
    │   ├── sqlite.go                    # modernc.org/sqlite implementation
    │   ├── migrate.go                   # hand-rolled schema migrations
    │   └── *_test.go
    └── httpapi/                         # public Mount entrypoint + route wiring
        ├── mount.go                     # func Mount(r chi.Router, cfg Config)
        ├── config.go                    # Config struct (RPID, Origins, DB, EmailSender, …)
        ├── errors.go                    # JSON error encoder matching protocol.md shape
        └── *_test.go
examples/
└── go-app/                              # Go example consumer — parity runner auto-boots this
    ├── go.mod                           # separate module, replaces -> ../../servers/go
    ├── main.go                          # mounts the library, wires sqlite, listens on $PORT
    ├── README.md
    └── testroutes/                      # /__test/last-otp, /__test/force-expire-otp (NODE_ENV=test only)
        └── routes.go
```

### Library choices

| Concern | Choice | Rationale |
|---|---|---|
| Go version | ≥ 1.22 | `slog`, new `net/http` routing patterns, stable generics ergonomics. |
| HTTP router | `github.com/go-chi/chi/v5` | Idiomatic Go composition over stdlib `http.Handler`. Mirrors `packages/hono`'s "compose middleware + routes" shape, which makes the consumer experience symmetric across servers. |
| WebAuthn | `github.com/go-webauthn/webauthn` | De facto standard Go WebAuthn lib, actively maintained, handles attestation + assertion verification including the `signature` / `clientDataJSON` / `authenticatorData` plumbing. |
| SQLite | `modernc.org/sqlite` | Pure-Go SQLite. No cgo means clean cross-compilation, simpler CI, no toolchain footguns. Equivalent feature set to `mattn/go-sqlite3` for our usage. |
| Migrations | Hand-rolled `migrate.go` | Schema is small (users, sessions, passkeys, pending_otps, pending_registrations). Matches `packages/core/src/migrate.ts`. Avoids `golang-migrate` dep. |
| Tests | stdlib `testing` + `net/http/httptest` | Matches the project's minimalism preference. No testify. |
| Logging | stdlib `log/slog` | Stable, ergonomic, no dep. |

### Public surface (sketch)

```go
package httpapi

type Config struct {
    RPID         string                       // e.g. "localhost"
    RPName       string                       // e.g. "Passkey Demo"
    Origins      []string                     // WebAuthn-accepted origins
    Storage      storage.Storage              // backing store
    EmailSender  auth.EmailSender             // OTP delivery (stub by default)
    SessionCookieName string                  // empty = bearer-only mode supported
    CSRFCookieName    string                  // defaults to "csrf"
    Now          func() time.Time             // injectable clock for tests
    OTPTTL       time.Duration                // default 10 min
    SessionTTL   time.Duration                // default 30 days
}

func Mount(r chi.Router, cfg Config) error
```

### Configuration via env vars (example app)

Mirrors `examples/hono-app/src/index.ts`:

- `AUTH_ORIGINS` — comma-separated WebAuthn-accepted origins. Falls back to `http://localhost:3000,http://localhost:3001,http://localhost:5173`.
- `PORT` — listening port. Default `3001` for parity with the TS example.
- `RP_ID` — defaults to `localhost`.
- `NODE_ENV=test` — enables `/__test/last-otp` and `/__test/force-expire-otp` test routes. Yes, we keep the `NODE_ENV` name (not `PASSKEY_ENV`) so the parity runner doesn't need a per-server env-var-name dispatch table. Both servers honour the same variable.

### Wire-protocol details (matching `spec/protocol.md`)

- All endpoints accept JSON; all responses are JSON.
- Errors: `{ "error": "<code>", "message": "<human string>" }`.
- Session token transported as `Authorization: Bearer <token>` or `Cookie: session=<token>` — server treats both identically.
- CSRF: cookie-mode double-submit. Server sets a non-HttpOnly `csrf` cookie on session-issuing endpoints; rejects non-GET requests with a session cookie but missing/wrong `X-CSRF-Token` header with 403 `csrf_required`. Bearer-mode requests bypass the check (no session cookie present).
- `Secure` cookie attribute auto-set when request is HTTPS (URL scheme or `X-Forwarded-Proto: https`).
- `passkeyId` is the bare base64url credential ID — same value across `registerPasskey`, `listPasskeys[].id`, and the `:id` in `DELETE /auth/passkeys/:id`.
- `/auth/me` returns `{ user: { id, email } }`. The Go server **must return the real email address** (looked up via the user table at request time, or denormalised onto the session row — implementation choice). This is strictly better than the TS server's `email: ""` quirk, and the parity vector matches `email: { type: "string" }` so both pass. Tightening the vector to require non-empty is a follow-up after the TS server catches up — out of scope here.

---

## Parity integration

### Runner extension

`tests/parity/runner/src/` gains a small dispatch table:

```ts
const SERVERS = {
  ts: { autoBoot: bootHonoApp /* existing */ },
  go: { autoBoot: bootGoApp  /* new */ },
};
```

`--server=ts|go` selects which `autoBoot` runs. Both implementations:
- Pick an ephemeral port.
- Set `AUTH_ORIGINS=http://localhost:<port>`.
- Set `NODE_ENV=test`.
- Use a temp dir as cwd so each run gets a fresh `app.db`.
- Tear down on suite exit.

`bootGoApp` shells out to `go run ./examples/go-app` (or a `go build`-produced binary if one exists, for speed). The first parity run after a fresh clone takes the compile hit; subsequent runs reuse the build cache.

### CLI default

`pnpm test:parity` (no flag) runs with `--server=ts` (faster local feedback, no Go toolchain assumed for TS-only contributors). CI runs both legs explicitly.

### Vectors

No vector changes are needed. The full suite (currently 20 vectors across `csrf/`, `email/`, `passkey/`, `passkey-mgmt/`, `session/`, `validation/`) is the contract both servers satisfy.

---

## Lockstep enforcement

Three layers, in order of strength:

### Layer 1 — Vectors are the source of truth (already in place)

`tests/parity/vectors/**/*.json` is the contract. Any behaviour either server exhibits must be representable as a vector, or it isn't part of the contract.

### Layer 2 — CI matrix runs both servers (new, this phase)

A GitHub Actions workflow (`.github/workflows/parity.yml`):

```yaml
name: parity
on: [push, pull_request]
jobs:
  parity:
    strategy:
      fail-fast: false
      matrix:
        server: [ts, go]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: ( cd tests/parity/runner && pnpm install --ignore-workspace --frozen-lockfile )
      - run: pnpm test:parity --server=${{ matrix.server }}
```

A change to either server that breaks the contract fails the matching matrix leg. A new vector that one server can't yet satisfy fails its leg until the implementation catches up. This is the load-bearing lockstep mechanism.

### Layer 3 — Spec/vector co-change gate (deferred)

A small CI step that fails if a commit changes `spec/protocol.md` without also touching `tests/parity/vectors/`. **Not implemented in this phase.** Layer 2 already catches the failure case (the vectors are the contract; the spec is documentation). Easy to add later if spec/vector drift becomes a real problem.

---

## Phased implementation

Each phase is one commit on `feat/go-support`. Conventional commit prefixes. Push after each phase to protect against workspace loss.

| # | Phase | Acceptance |
|---|---|---|
| 1 | **Skeleton**: `servers/go/go.mod`, `servers/go/{auth,passkey,storage,httpapi}` empty-but-compiling, `examples/go-app/main.go` listening on `$PORT` with `/healthz`. Makefile targets: `build`, `test`, `run`. README quickstart. | `go test ./...` passes (0 tests is OK). `examples/go-app` starts and responds 200 on `/healthz`. |
| 2 | **Parity runner gains `--server=go`** with `bootGoApp`. Adds matrix-aware CLI parsing. No vectors run yet beyond a trivial smoke test. | `pnpm test:parity --server=go --vectors-glob=session/me-unauthenticated` (a single existing vector) passes against a stubbed `/auth/me` returning 401. |
| 3 | **Storage + migrations + email OTP**: SQLite schema, `Storage` interface, sqlite impl, `/auth/email/{start,verify}`, `/auth/me`, `/auth/sign-out`, sessions. Stub email sender that logs the code and exposes it via `/__test/last-otp`. | `email/` + `session/` parity vectors pass on `--server=go`; TS suite still green. |
| 4 | **Passkey ceremonies**: register start/finish, sign-in start/finish, list, delete. In-memory pending-registration / pending-signin maps. | `passkey/` + `passkey-mgmt/` parity vectors pass on `--server=go`. |
| 5 | **CSRF + cookie mode + Secure cookie auto-set**. | `csrf/` parity vectors pass on `--server=go`. |
| 6 | **Validation hardening + full-suite smoke**: input validation matching TS, `/__test/force-expire-otp`, defensive checks. | Full parity suite (all 20 vectors) green on both `--server=ts` and `--server=go`. |
| 7 | **CI + docs**: GitHub Actions matrix workflow, top-level `README.md` mention, `tests/parity/README.md` updates, CLAUDE.md "Project shape" + "Commands" sections updated. | CI matrix green on push to `feat/go-support`. CLAUDE.md reflects the new shape. |

---

## Testing strategy

### Unit tests (Go, stdlib `testing` + `httptest`)

- `auth/`: OTP generation, expiry, max-attempts; session creation, lookup, expiry; CSRF middleware accept/reject paths.
- `passkey/`: register options shape, finish-handler base64url decoding, signin allow-credentials enumeration, attestation/assertion verification with stub authenticator. Use `go-webauthn/webauthn`'s built-in test vectors plus a thin custom harness for our wrapper.
- `storage/`: migration up-from-zero, idempotent re-run, FK constraints, cleanup of expired OTPs.
- `httpapi/`: end-to-end via `httptest.NewServer` for handful of routes — but the big win is the parity suite, so unit tests stay surgical (don't duplicate vector coverage).

### Parity tests (existing TS suite, both targets)

Primary acceptance for every server-visible behaviour. Run via `pnpm test:parity --server={ts,go}`.

### What's intentionally not tested

- A Go-side "client SDK". There is no Go client.
- Race conditions on the in-memory pending-registration maps under concurrent load. Phase 1's "single-process, multi-process deferred" caveat applies equally.
- Real-device WebAuthn against the Go server. Same simulator/virtual-authenticator coverage we have today suffices.

---

## Risks & open questions

- **`go-webauthn/webauthn` API quirks**: The library may want a different attestation/assertion lifecycle than `@simplewebauthn/server` v10 (e.g. how it surfaces `aaguid`, `credentialPublicKey`, transports). Spike in Phase 4 — if the impedance mismatch is high, may need a thin wrapper that re-shapes results into the same `Passkey` storage row as the TS side.
- **modernc.org/sqlite quirks**: Pure-Go SQLite has occasional perf and edge-case differences vs cgo. For our scale (single-process, dev/demo workloads) this is fine; flagging for visibility.
- **First-run compile cost in parity runner**: `go run` cold-start is 2–5s on a clean cache. Acceptable for CI; for local dev we can pre-`go build` and reuse the binary if it gets annoying.
- **Vector tolerance for `email` on `/auth/me`**: The TS server returns `""`; the Go server can return the real email. Current vector matches `{ type: "string" }` so either passes. Worth tightening the vector later, but that's a separate decision — out of scope here.
- **`NODE_ENV` naming on the Go side**: Aesthetically odd to use `NODE_ENV` in a Go binary. Justified by parity-runner simplicity (single env var across both). Documented in the Go README.

---

## Out-of-band changes to existing code

These are unavoidable in this phase:

- `tests/parity/runner/src/`: gains `--server` flag, server-dispatch table, `bootGoApp` function. The existing `bootHonoApp` is extracted but otherwise unchanged.
- `tests/parity/README.md`: documents the new flag and the two boot paths.
- `README.md` (repo root): adds a "Server implementations" subsection pointing to both `packages/hono` and `servers/go`.
- `CLAUDE.md`: "Project shape" gains `servers/go/` and `examples/go-app/`; "Commands" gains `pnpm test:parity --server=go` and the first-time `cd servers/go && go mod download` hint.
- `.github/workflows/parity.yml`: new CI workflow.

No changes to: `packages/core`, `packages/hono`, `packages/cli`, `packages/client-web`, `clients/PasskeySDK`, `clients/ios-demo`, `examples/hono-app` (beyond possibly extracting `AUTH_ORIGINS` env-var docs into a shared note — TBD during impl, not load-bearing).

---

## Out of scope (re-stating for clarity)

- Go client SDK.
- Go CLI.
- Tagged Go module versions (consumers import by commit SHA initially).
- Spec-change pre-merge gate (Layer 3 of lockstep, deferred).
- Real email transport in the Go server (stub-only, matches TS).
- Multi-process / restart-survival for in-memory passkey challenge maps (matches TS).
