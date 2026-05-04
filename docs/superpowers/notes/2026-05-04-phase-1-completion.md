# Passkey SDK — Phase 1 Completion Notes

**Date:** 2026-05-04
**Status:** Phase 1 (TypeScript server) shipped. All 25 tasks of `docs/superpowers/plans/2026-05-03-passkey-sdk-phase-1-server.md` complete.
**Branch:** `main` (clean tree, all commits direct to main)

---

## TL;DR for Phase 2 (web client) planning

- The HTTP contract from `spec/protocol.md` is implemented and tested. **Plan Phase 2 against `spec/protocol.md`**, not the original design spec — the protocol doc is the durable contract.
- Server runs locally via `examples/hono-app` and a real end-to-end OTP flow passes (`examples/hono-app/tests/e2e.test.ts`).
- The shipped HTTP contract has a few deviations from the design spec — see **Known limitations** below. Phase 2 should design around these or fix them in v0.1.

---

## Repo layout (as built)

```
passkey-sdk/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml             # packages: packages/*, examples/*
├── tsconfig.base.json              # strict, ES2022, NodeNext, exactOptionalPropertyTypes
├── spec/
│   └── protocol.md                 # HTTP contract — source of truth for clients
├── packages/
│   ├── core/                       # @mattsmith/passkey-sdk-core
│   │   ├── migrations/001_init.sql
│   │   ├── src/
│   │   │   ├── index.ts            # public exports
│   │   │   ├── types.ts            # User, AuthConfig, *Record types
│   │   │   ├── errors.ts           # AuthError + 7 error codes
│   │   │   ├── deps.ts             # Deps interface (now/randomBytes/randomId) + defaultDeps
│   │   │   ├── db.ts               # type Db = Database.Database
│   │   │   ├── migrate.ts          # runMigrations(db)
│   │   │   ├── session.ts          # createSession/validateAndBumpSession/revokeSession/listSessionsForUser
│   │   │   ├── aasa.ts             # appleAppSiteAssociation()
│   │   │   ├── cleanup.ts          # cleanup({db,deps}) → {sessions, otps}
│   │   │   ├── auth.ts             # createAuth(config, runtime) — public façade
│   │   │   ├── storage/{sessions,otps,passkeys}.ts
│   │   │   └── flows/{email-otp,passkey-register,passkey-signin}.ts
│   │   └── tests/                  # 11 test files, 59 tests
│   ├── hono/                       # @mattsmith/passkey-sdk-hono
│   │   ├── src/index.ts            # mountAuthRoutes(app, auth, opts?)
│   │   └── tests/routes.test.ts    # 9 HTTP-level contract tests
│   └── cli/                        # @mattsmith/passkey-sdk-cli
│       └── src/index.ts            # `passkey-sdk migrate <db>`
└── examples/
    └── hono-app/                   # private workspace package "hono-app-example"
        ├── src/index.ts            # exported app/auth/db; serve() guarded by import.meta main check
        └── tests/e2e.test.ts       # full OTP flow against the real app via app.request()
```

**Boundary rules held:** `core` never imports from `hono` or `cli`. `hono` and `cli` import only `@mattsmith/passkey-sdk-core`. Storage files are one-table-each. Flow files are one-ceremony-each.

---

## What's tested (68 package tests + 1 e2e)

| Suite | Tests | Covers |
|---|---|---|
| `core/tests/errors.test.ts` | 3 | AuthError shape, toJSON, type guard |
| `core/tests/deps.test.ts` | 4 | defaultDeps now/randomBytes/randomId; Deps substitutability |
| `core/tests/migrate.test.ts` | 3 | Schema creation, idempotency, bookkeeping |
| `core/tests/storage.test.ts` | 14 | sessions/otps/passkeys CRUD + JSON round-trip for transports |
| `core/tests/session.test.ts` | 6 | create/validate/revoke + sliding lastSeenAt + expiry |
| `core/tests/email-otp.test.ts` | 9 | start (3) + verify (6: success, consume, replay, attempts, expiry, unknown) |
| `core/tests/passkey.test.ts` | 4 | beginRegistration shape (3) + beginSignIn shape (1) |
| `core/tests/passkey-integration.test.ts` | 5 | finish ceremonies with mocked verifiers — registration success/failure (verified=false vs thrown), sign-in success/unknown_credential |
| `core/tests/cleanup.test.ts` | 1 | Expired sessions+otps removed by cutoff |
| `core/tests/auth.test.ts` | 7 | End-to-end via createAuth: OTP flow, requireSession (bearer + cookie + missing), signOut, listSessions, AASA |
| `hono/tests/routes.test.ts` | 9 | All HTTP routes: email start/verify/400/401, /me with/without bearer, sign-out, passkey routes |
| `examples/hono-app/tests/e2e.test.ts` | 1 | start → verify → /api/me with the real app |

Run all: `pnpm test` (covers packages) + `pnpm --filter hono-app-example test` (covers e2e).

---

## Key deviations from the original plan

These deviations are **load-bearing** — Phase 2 needs to know them.

### 1. `@simplewebauthn/server` v10 API shape (vs plan's v13+ assumption)

The plan was written assuming the v13+ shape with `registrationInfo.credential.{id, publicKey, counter, transports}`. v10 (currently installed) uses a flat shape:

| Plan assumed | What v10 actually has |
|---|---|
| `excludeCredentials[].id: Uint8Array` | `excludeCredentials[].id: Base64URLString` (string) |
| `info.credential.id: Uint8Array` | `info.credentialID: Base64URLString` |
| `info.credential.publicKey: Uint8Array` | `info.credentialPublicKey: Uint8Array` |
| `info.credential.counter: number` | `info.counter: number` |
| `info.credential.transports?: AuthenticatorTransportFuture[]` | **not exposed** |
| `info.aaguid: string (base64)` | `info.aaguid: string` (already) |
| `verifyAuthenticationResponse({ ..., credential: {...} })` | `verifyAuthenticationResponse({ ..., authenticator: {credentialID, credentialPublicKey, counter, transports?} })` |

**Implication for Phase 2:** the web client doesn't care — these are server-internal — but if we ever upgrade to v13+, `passkey-register.ts:130-148` and `passkey-signin.ts:91-114` need to be revisited.

### 2. `transports` not captured at registration

Because v10 doesn't expose transports on `registrationInfo`, freshly registered passkeys are stored with `transports: null`. The schema and storage layer support transports correctly (round-trip tested), and `excludeCredentials` in the WebAuthn options will simply omit the transports hint for those creds. Functional but suboptimal. Fixable when we upgrade @simplewebauthn or when we capture transports from the client-side credential response.

### 3. `aaguid` decoded as hex (not the more common base64)

`packages/core/src/flows/passkey-register.ts:142` uses `Buffer.from(aaguid, "hex")`. v10 returns aaguid as a 32-char hex string (no dashes), so this works. If a future @simplewebauthn version returns a UUID-with-dashes format, this needs adjustment. The integration test at `passkey-integration.test.ts` mocks the value as a 32-char hex string to match.

### 4. `requireSession` returns `email: ""`

The session table doesn't store the email — only `userId`. So `auth.requireSession(req)` returns `{ id, email: "" }`. The original `auth.test.ts` plan expected `user.email === "matt@example.com"`; that was an inconsistency — we updated it to assert `user.id === "u_1"`. The plan's design spec implies clients should look up email from their own users table by id.

**`finishPasskeySignIn` has the same limitation:** the SDK only resolves `userId` from the credential, so the `user` field in `SignInResult` from passkey sign-in is `{ id, email: "" }`. Documented in `spec/protocol.md`.

**Email-OTP verify is fine** — `verifyEmailOtp` knows the email (from `OtpRecord.email`) and returns it.

### 5. ZodError handling in the Hono adapter

Plan didn't explicitly include a Zod-error branch in `errorResponse`; we added one to satisfy the "invalid body returns 400" test. Maps `ZodError` → `{ error: "invalid_request", ... }` with status 400. **Note:** `invalid_request` is **not** in the spec's error code table. Phase 2 clients should expect 400 with this error string (or generally treat any non-200 as a contract error and not rely on the exact code for client-side validation failures).

### 6. Plan inconsistency: session error message

Plan's `validateAndBumpSession` test used regex `/unauthenticated/i` but the implementation message was `"Session is missing or expired"`. Fixed in `289d803` — message kept as spec'd, test regex updated to `/missing or expired/i`.

### 7. Session cookie `Max-Age` hard-coded in adapter

`packages/hono/src/index.ts:45` hard-codes `sessionLifetime = 60*60*24*30` (30 days) for the cookie's `Max-Age`. The actual session TTL is read from `config.session.lifetimeSeconds` and used for the DB `expires_at`. These can drift if a consumer configures a non-default `lifetimeSeconds`. Worth threading through in v0.1.

### 8. In-memory `pendingRegistrations` / `pendingSignIns` Maps

Both passkey ceremonies use module-level `Map`s for the challenge store with a 5-minute TTL and a `gcExpired` sweep on each begin call. **This is process-local** — multi-process or restart-survival is a Phase 2+ concern. For a single-process Hono server it's fine.

---

## Tech stack chosen

- **Runtime:** Node ≥20, ESM-only, NodeNext module resolution
- **Build:** tsup (esbuild) → `dist/` (esm + .d.ts)
- **Test:** Vitest 1.6
- **Server:** Hono 4.5 (peer dep), `@hono/node-server` in the example
- **DB:** better-sqlite3 11 (peer dep on packages/core, dev dep elsewhere)
- **WebAuthn:** @simplewebauthn/server 10 (see deviations above)
- **Validation:** zod 3.23
- **TS config highlights:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (this one bit us a few times — adapt object construction to omit keys instead of setting them to `undefined`)

---

## Public API surface (for Phase 2 to consume)

The web client will hit endpoints documented in `spec/protocol.md`. Cookie mode and bearer mode are both supported on every authenticated endpoint. The cookie name defaults to `session` (configurable).

Highlights for client design:
- `POST /auth/email/start` → `{ otpId, expiresInSeconds }`
- `POST /auth/email/verify` → `{ sessionToken, user: { id, email } }` + sets `Set-Cookie` (HttpOnly, SameSite=Lax)
- `POST /auth/passkey/register/start` (auth required) → `{ registrationId, options }` — pass `options` verbatim to `navigator.credentials.create()`
- `POST /auth/passkey/register/finish` → `{ passkeyId }`
- `POST /auth/passkey/sign-in/start` (no auth) → `{ signInId, options }` (with `allowCredentials: []` for discoverable creds)
- `POST /auth/passkey/sign-in/finish` → `{ sessionToken, user }`
- `GET /auth/me` → `{ user }`
- `POST /auth/sign-out` → `{ ok: true }` + clears cookie
- `GET /auth/sessions`, `GET /auth/passkeys`, `DELETE /auth/passkeys/:id` (all auth)

CSRF: not implemented yet. The design spec called for double-submit cookie pattern when `storage: cookie`. Phase 2 should plan this in.

---

## How to run things

```bash
# from repo root
pnpm install        # already idempotent, lockfile committed
pnpm build          # builds core, hono, cli (cli depends on core's dist)
pnpm typecheck      # all three packages
pnpm test           # 59 + 9 = 68 package tests
pnpm --filter hono-app-example test    # 1 e2e test

# Run the example server
( cd examples/hono-app && pnpm migrate )    # creates ./app.db
( cd examples/hono-app && pnpm dev )        # listens on :3000, OTPs printed to stdout
```

---

## Open items / things to revisit in Phase 2 (or sooner)

- Capture credential `transports` from the client response to backfill `auth_passkeys.transports` (currently null for new registrations).
- Thread `config.session.lifetimeSeconds` to the cookie `Max-Age` in the Hono adapter.
- CSRF protection (double-submit cookie) for cookie-mode clients.
- The "email is empty in `requireSession` / passkey sign-in" UX — Phase 2 client probably wants a `getCurrentUser()` that resolves both id and email by hitting `/auth/me` AND a project-side `/api/users/:id` (or extending `/auth/me` to take an enrichment callback at the server).
- Multiple-server-process passkey challenge store (replace in-memory Maps with DB-backed store) — nice-to-have, not urgent.
- @simplewebauthn/server upgrade to v13+ when the dust settles; we can simplify a chunk of `passkey-register.ts` and `passkey-signin.ts`.

---

## Files Phase 2 should read first

1. `spec/protocol.md` — the contract
2. `packages/hono/src/index.ts` — the actual route shapes including error mapping (400/401/404/410/429)
3. `packages/core/src/auth.ts` — public façade types (`Auth`, `AuthRuntime`, `AuthConfig`)
4. `examples/hono-app/src/index.ts` — reference consumer wiring
5. `packages/core/tests/auth.test.ts` — usage examples for every public method
