# Protocol Parity Vectors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `tests/parity/` — a language-agnostic conformance test suite for `spec/protocol.md`. Vectors are JSON files describing scenarios (sequenced HTTP requests with captured variables, expected response shape, expected error codes). A Node-based runner executes them against any HTTP server URL and proves conformance. The current TS server passes the suite on day one; a future Go server is test-driven against the same vectors.

**Why now:** The TS server is feature-complete from the user's perspective. Without runnable conformance tests, the spec is a markdown doc that can drift from the implementation silently — and any future second implementation (Go, etc.) has nothing concrete to target.

**Architecture:**

```
tests/parity/
├── README.md                # How to run, how to add vectors
├── runner/
│   ├── package.json         # Node deps (zod, playwright for WebAuthn)
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts         # CLI entry: pnpm test:parity [serverUrl]
│   │   ├── scenario.ts      # Scenario type + execution loop
│   │   ├── matcher.ts       # Shape matching (required fields, types, regex)
│   │   ├── webauthn.ts      # Virtual authenticator harness (Playwright CDP)
│   │   └── transport.ts     # HTTP client (fetch + cookie jar + CSRF echo)
│   └── tests/               # Tests of the runner itself
└── vectors/
    ├── email/
    │   ├── start-happy.json
    │   ├── verify-happy.json
    │   ├── verify-invalid-otp.json
    │   ├── verify-expired.json
    │   └── verify-attempts-exceeded.json
    ├── passkey/
    │   ├── register-happy.json
    │   ├── register-unauthenticated.json
    │   ├── signin-happy.json
    │   ├── signin-unknown-credential.json
    │   └── signin-invalid-credential.json
    ├── session/
    │   ├── me-happy.json
    │   ├── me-unauthenticated.json
    │   ├── signout-happy.json
    │   ├── list-sessions.json
    │   └── list-passkeys.json
    ├── passkey-mgmt/
    │   ├── delete-happy.json
    │   └── delete-unknown.json
    ├── csrf/
    │   ├── cookie-mode-happy.json     # full e2e in cookie mode
    │   └── csrf-required.json         # POST without X-CSRF-Token after cookie session
    └── validation/
        └── invalid-request-body.json
```

**Tech Stack:** Node 22+ (Bun-compatible), TypeScript, `zod` for schema matching, Playwright (Chromium + `WebAuthn.addVirtualAuthenticator`) for the WebAuthn harness, `fetch` for HTTP. No new packages added to the workspace — `tests/parity/runner/` is its own pnpm project with locked deps.

**Reference reading order before starting:**
1. `spec/protocol.md` — the contract being codified
2. `docs/superpowers/notes/2026-05-04-phase-2-completion.md` — the existing CSRF + cookie semantics
3. `examples/hono-app/src/index.ts` — the test server vectors run against
4. `examples/web-demo/tests/e2e.spec.ts` — existing Playwright + virtual-authenticator pattern (mirror its setup)
5. `packages/client-web/tests/*.test.ts` — existing assertions on response shapes (use these to derive matchers)
6. `CLAUDE.md` — repo conventions

**Workflow:** Work directly on `main`. One commit per task. Conventional commit messages. NO `Co-Authored-By` trailer.

**Testing:**
- Runner self-tests via `vitest` in `tests/parity/runner/`.
- End-to-end: `pnpm test:parity` boots `examples/hono-app` on a free port, runs every vector against it, fails if any scenario diverges.
- Vector authoring: each vector file is independently executable via `pnpm test:parity -- --only=email/verify-happy`.

---

## Scenario file format (locked in before tasks)

Each vector is a JSON file with this shape:

```json
{
  "name": "verify happy path",
  "mode": "bearer",
  "steps": [
    {
      "request": {
        "method": "POST",
        "path": "/auth/email/start",
        "body": { "email": "test@example.com" }
      },
      "expect": {
        "status": 200,
        "body": {
          "otpId": { "type": "string", "nonEmpty": true },
          "expiresInSeconds": { "type": "number", "min": 1 }
        }
      },
      "capture": {
        "otpId": "$.body.otpId"
      }
    },
    {
      "request": {
        "method": "GET",
        "path": "/__test/last-otp?email=test@example.com"
      },
      "expect": { "status": 200 },
      "capture": { "code": "$.body.code" }
    },
    {
      "request": {
        "method": "POST",
        "path": "/auth/email/verify",
        "body": { "otpId": "{{otpId}}", "code": "{{code}}" }
      },
      "expect": {
        "status": 200,
        "body": {
          "sessionToken": { "type": "string", "nonEmpty": true },
          "user": {
            "id": { "type": "string", "nonEmpty": true },
            "email": { "const": "test@example.com" }
          }
        }
      }
    }
  ]
}
```

WebAuthn-bearing steps reference a virtual-authenticator handle:

```json
{
  "request": {
    "method": "POST",
    "path": "/auth/passkey/register/finish",
    "body": {
      "registrationId": "{{registrationId}}",
      "credential": { "$webauthn": "create", "options": "{{options}}" }
    }
  },
  "expect": { "status": 200, "body": { "passkeyId": { "type": "string", "nonEmpty": true } } }
}
```

The runner sees `$webauthn: "create"` and routes the inner `options` through the Playwright virtual authenticator, then substitutes the resulting attestation into the request body.

Matcher reference (zod-backed):
- `{ "type": "string", "nonEmpty": true }` — non-empty string
- `{ "type": "number", "min": N, "max": N }` — number with bounds
- `{ "const": V }` — exact match
- `{ "regex": "..." }` — regex match
- `{ "array": { "minLength": N, "items": {...} } }` — array shape
- `{ "$any": true }` — accept any value (use sparingly)
- `{ "error": "<code>" }` — assert body matches `{ error, message }` with the given code

---

## Phase A — Runner scaffolding (Tasks 1–3)

### Task 1: Create the `tests/parity/runner/` package

**Files:**
- Create: `tests/parity/runner/package.json` (private, not in workspace)
- Create: `tests/parity/runner/tsconfig.json`
- Create: `tests/parity/runner/src/index.ts` (CLI entry point — empty for now)
- Create: `tests/parity/README.md`
- Modify: root `package.json` to add `test:parity` script that invokes the runner

- [ ] **Step 1: Scaffold the Node project.** Choose Node 22+, ESM, TypeScript, `tsx` for runtime, `vitest` for self-tests, `zod` for matchers, `playwright` for WebAuthn harness. Lock these in `package.json`. Keep it OUT of the pnpm workspace (`private: true`, no workspace reference) so it doesn't get hoisted weirdly.
- [ ] **Step 2: Write `tsconfig.json`** mirroring `packages/client-web` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- [ ] **Step 3: Write `tests/parity/README.md`** documenting: prereqs (`pnpm install` from `tests/parity/runner/`, `pnpm exec playwright install chromium`), `pnpm test:parity` from root, vector file authoring.
- [ ] **Step 4: Add `"test:parity": "cd tests/parity/runner && pnpm test"` to root `package.json` scripts.**
- [ ] **Step 5: Commit.** Message: `chore(parity): scaffold tests/parity/runner package`

### Task 2: Implement scenario type + variable substitution

**Files:**
- Create: `tests/parity/runner/src/scenario.ts`
- Create: `tests/parity/runner/tests/scenario.test.ts`

- [ ] **Step 1: Define types.** `Scenario`, `Step`, `Request`, `Expect`, `Matcher`. Discriminated unions where appropriate. Export a Zod schema so vector files are validated at load time.
- [ ] **Step 2: Variable substitution.** `interpolate(template, ctx)` replaces `{{name}}` in strings and recurses through objects/arrays. JSONPath-lite (`$.body.foo`) for `capture`.
- [ ] **Step 3: Tests.** Round-trip vector → parsed shape; interpolation cases (string, nested, missing var = error, array recursion).
- [ ] **Step 4: Commit.** `feat(parity): scenario types + variable substitution`

### Task 3: Implement the matcher

**Files:**
- Create: `tests/parity/runner/src/matcher.ts`
- Create: `tests/parity/runner/tests/matcher.test.ts`

- [ ] **Step 1: Build matcher function** that takes a matcher spec and a value, returns `{ ok: true } | { ok: false, path, reason }`. Recurse into objects.
- [ ] **Step 2: Implement each matcher** (`type/nonEmpty`, `const`, `regex`, `array`, `$any`, `error` shortcut).
- [ ] **Step 3: Tests.** Each matcher type, nested matching, mismatch reporting.
- [ ] **Step 4: Commit.** `feat(parity): response shape matcher`

---

## Phase B — HTTP + WebAuthn transports (Tasks 4–5)

### Task 4: Implement the HTTP client

**Files:**
- Create: `tests/parity/runner/src/transport.ts`
- Create: `tests/parity/runner/tests/transport.test.ts`

- [ ] **Step 1: Two modes.** `bearer` (manages an `Authorization: Bearer …` header after sessionToken capture); `cookie` (cookie jar — uses `tough-cookie` — plus reads `csrf` cookie value and adds `X-CSRF-Token` on non-GET requests automatically).
- [ ] **Step 2: Request execution.** `execute(req, ctx) → { status, headers, body }`. JSON encode/decode, error on non-JSON unless explicitly allowed.
- [ ] **Step 3: Mode wiring.** Sessions issued by `/auth/email/verify` and `/auth/passkey/sign-in/finish` are detected automatically by mode-specific logic (bearer reads `sessionToken` from response body and stashes it; cookie relies on jar).
- [ ] **Step 4: Tests.** Bearer attaches header after capture; cookie jar persists and echoes CSRF; non-GET without CSRF in cookie mode triggers the server's `csrf_required` (we want to be able to write that negative vector).
- [ ] **Step 5: Commit.** `feat(parity): http transport with bearer + cookie modes`

### Task 5: Implement the WebAuthn virtual authenticator harness

**Files:**
- Create: `tests/parity/runner/src/webauthn.ts`
- Create: `tests/parity/runner/tests/webauthn.test.ts`

- [ ] **Step 1: Start a headless Chromium** once at suite startup; reuse across vectors. Tear down after suite.
- [ ] **Step 2: Per-scenario authenticator.** Create a fresh virtual authenticator on a blank page via CDP; `addVirtualAuthenticator(...)` with the protocol's expected transport and resident-key settings (mirror `examples/web-demo/tests/e2e.spec.ts`).
- [ ] **Step 3: Ceremony invocation.** Given `{ $webauthn: "create" | "get", options }`, execute the right `navigator.credentials.*` call inside the page context, return the public-key-credential JSON the server expects.
- [ ] **Step 4: Tests.** Round-trip a register ceremony against a fake server that echoes the credential id (or against the real hono-app in a setup hook).
- [ ] **Step 5: Commit.** `feat(parity): webauthn virtual authenticator harness`

---

## Phase C — Vectors (Tasks 6–10)

### Task 6: Authoring conventions + first happy-path vector

**Files:**
- Create: `tests/parity/vectors/email/start-happy.json`
- Create: `tests/parity/vectors/email/verify-happy.json`
- Modify: `tests/parity/README.md` (document conventions)

- [ ] **Step 1: Decide naming convention.** `{endpoint-group}/{behavior}.json`. Behaviors: `happy`, `<error-code>`, descriptive suffix. Document in README.
- [ ] **Step 2: Write the two email-flow vectors.** Reference the existing test code in `examples/hono-app/src/__test/last-otp.ts` for how to fetch the OTP.
- [ ] **Step 3: Run them against hono-app.** Confirm pass.
- [ ] **Step 4: Commit.** `test(parity): email happy-path vectors`

### Task 7: Email error-code vectors

**Files:**
- Create: `tests/parity/vectors/email/verify-invalid-otp.json`
- Create: `tests/parity/vectors/email/verify-expired.json`
- Create: `tests/parity/vectors/email/verify-attempts-exceeded.json`

- [ ] **Step 1: invalid_otp** — start OTP, attempt with wrong code, expect 401 + `{ error: "invalid_otp" }`.
- [ ] **Step 2: otp_expired** — needs a server-side time-warp hook OR a precomputed expired row. Decision: extend `examples/hono-app/src/__test/` with a `force-expire-otp` route (test-only, gated by `NODE_ENV=test`).
- [ ] **Step 3: otp_attempts_exceeded** — five wrong guesses, sixth returns 429.
- [ ] **Step 4: Commit.** `test(parity): email error-code vectors`

### Task 8: Passkey vectors

**Files:**
- Create: `tests/parity/vectors/passkey/register-happy.json`
- Create: `tests/parity/vectors/passkey/register-unauthenticated.json`
- Create: `tests/parity/vectors/passkey/signin-happy.json`
- Create: `tests/parity/vectors/passkey/signin-unknown-credential.json`
- Create: `tests/parity/vectors/passkey/signin-invalid-credential.json`

- [ ] **Step 1: register-happy.** Chain: email sign-in → register/start → `$webauthn: "create"` → register/finish → assert `passkeyId` shape.
- [ ] **Step 2: register-unauthenticated.** Call register/start with no session, expect 401 + `unauthenticated`.
- [ ] **Step 3: signin-happy.** Chain: register a passkey (precondition), wipe session, sign-in/start → `$webauthn: "get"` → sign-in/finish → assert session token.
- [ ] **Step 4: signin-unknown-credential.** Use a synthetic credential id the server has never seen, expect 404 + `unknown_credential`.
- [ ] **Step 5: signin-invalid-credential.** Tamper the assertion signature, expect 401 + `invalid_credential`. Requires a "corrupt signature" toggle in the webauthn harness.
- [ ] **Step 6: Commit.** `test(parity): passkey ceremony vectors`

### Task 9: Session + management vectors

**Files:**
- Create: `tests/parity/vectors/session/me-happy.json`
- Create: `tests/parity/vectors/session/me-unauthenticated.json`
- Create: `tests/parity/vectors/session/signout-happy.json`
- Create: `tests/parity/vectors/session/list-sessions.json`
- Create: `tests/parity/vectors/session/list-passkeys.json`
- Create: `tests/parity/vectors/passkey-mgmt/delete-happy.json`
- Create: `tests/parity/vectors/passkey-mgmt/delete-unknown.json`

- [ ] **Step 1–7: One vector per case.** Most chain off an email sign-in. `delete-unknown` uses a synthetic id.
- [ ] **Step 8: Commit.** `test(parity): session + management vectors`

### Task 10: CSRF + cookie-mode vectors

**Files:**
- Create: `tests/parity/vectors/csrf/cookie-mode-happy.json`
- Create: `tests/parity/vectors/csrf/csrf-required.json`
- Create: `tests/parity/vectors/validation/invalid-request-body.json`

- [ ] **Step 1: cookie-mode-happy.** Full email flow in cookie mode. Verify the runner echoes CSRF correctly.
- [ ] **Step 2: csrf-required.** Cookie mode, deliberately drop the `X-CSRF-Token` header on a non-GET, expect 403 + `csrf_required`. Requires a runner flag `omitCsrf: true` on the step.
- [ ] **Step 3: invalid-request-body.** Send a malformed body to `/auth/email/start`, expect 400 + `invalid_request`.
- [ ] **Step 4: Commit.** `test(parity): csrf + validation vectors`

---

## Phase D — Integration (Tasks 11–12)

### Task 11: End-to-end runner against hono-app

**Files:**
- Modify: `tests/parity/runner/src/index.ts` — full CLI: discover vectors, boot server (or expect URL), run all, report.
- Create: `tests/parity/runner/src/server.ts` — utility that boots `examples/hono-app` on an ephemeral port with `NODE_ENV=test`.

- [ ] **Step 1: Vector discovery.** Glob `tests/parity/vectors/**/*.json`, validate each against the Zod schema, report any malformed ones up front.
- [ ] **Step 2: Server boot.** Either accept `--url` for an external server, or auto-boot `hono-app` (mirroring `examples/web-demo/tests/global-setup.ts`).
- [ ] **Step 3: Reporter.** Pretty per-vector pass/fail with the matcher's path-of-divergence on failure. Summary count at the end.
- [ ] **Step 4: Commit.** `feat(parity): full runner CLI + auto-boot hono-app`

### Task 12: CI hook + README polish

**Files:**
- Modify: root `README.md` — add `tests/parity/` to the layout tree.
- Modify: `tests/parity/README.md` — final polish.
- Modify: root `package.json` — confirm `test:parity` works from clean clone.

- [ ] **Step 1: README updates.** Document `pnpm test:parity` as the conformance check.
- [ ] **Step 2: Clean-clone verification.** Delete `tests/parity/runner/node_modules`, re-`pnpm install` from inside `tests/parity/runner/`, re-run.
- [ ] **Step 3: Commit.** `docs(parity): document parity suite in top-level README`

---

## Out of scope (deferred)

- **Running the suite against anything but `examples/hono-app`.** The runner accepts `--url` so a future Go server can be tested, but no Go server exists yet.
- **Negative-path vectors for `rate_limited`.** Spec marks it "reserved (not enforced by SDK in v1)" — no vector needed.
- **`internal_error` (500) vector.** Hard to reliably trigger without breaking the server intentionally. Skip.
- **Pending-challenge state migration.** The TS server holds it in-memory. Parity testing doesn't require fixing this; the Go server would either replicate the in-memory approach or both servers would later migrate to SQLite.

## Risk register

- **WebAuthn ceremony non-determinism.** Mitigated by structural matchers; ceremony bytes never appear in vector files. The `signin-invalid-credential` vector needs a deliberate-corruption helper in the harness — design that early.
- **OTP expiry test depends on a test-only server hook.** We'd add `__test/force-expire-otp` to `examples/hono-app`. Should be gated by `NODE_ENV=test` (Phase 2 already established this pattern).
- **Cookie mode + Node's `fetch` cookie handling.** Node's built-in `fetch` doesn't manage cookies. Use `tough-cookie` + manual `Set-Cookie` parsing, or use Playwright's request context (which has a built-in jar). Decide in Task 4.
- **Workspace pollution.** `tests/parity/runner/` is intentionally outside the pnpm workspace; if accidentally included, its dev deps will hoist and confuse builds. Verify in Task 1 with `pnpm -r list` after install.

## Definition of done

- [ ] `pnpm test:parity` from a clean clone passes against `examples/hono-app` with all vectors green.
- [ ] Every endpoint in `spec/protocol.md` has at least one happy-path vector.
- [ ] Every error code in the spec's error table has at least one negative vector (except `rate_limited` and `internal_error`, per "out of scope").
- [ ] Both `bearer` and `cookie` modes have at least one full end-to-end scenario.
- [ ] A `tests/parity/README.md` documents the format clearly enough that adding a new vector takes <10 minutes.
