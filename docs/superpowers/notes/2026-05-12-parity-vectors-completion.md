# Passkey SDK — Parity Vectors Completion Notes

**Date:** 2026-05-12
**Status:** Protocol parity suite shipped. All 12 tasks of `docs/superpowers/plans/2026-05-12-protocol-parity-vectors.md` complete.
**Branch:** `main` (clean tree; merged via worktree, re-authored with the GitHub noreply email, fast-forward pushed to `origin/main`)

---

## TL;DR for future client implementations

`spec/protocol.md` now has a runnable conformance suite. Any future second
server (Go, Rust, etc.) can be test-driven against the same 20 JSON
vectors — no parallel TypeScript test code to maintain. The reference
`examples/hono-app` passes 100% on day one.

```bash
pnpm test:parity
```

That command, from a clean clone after `pnpm install` and `pnpm build`,
auto-boots `examples/hono-app` on an ephemeral port and runs every vector
in `tests/parity/vectors/**/*.json`. Exit 0 ⇔ conformance.

When a future Go server lands, the same command with `--url=http://...`
(via `pnpm --filter passkey-parity-runner test:e2e -- --url=...`) drives
it against the same vectors. No new test code required.

---

## What's in this phase

- **`tests/parity/runner/`** — Node CLI, intentionally outside the pnpm
  workspace so its deps (Playwright, Zod, tough-cookie) don't hoist into
  the main install graph. Installed via `pnpm install --ignore-workspace`.
- **`tests/parity/vectors/`** — 20 JSON scenarios, one per protocol
  behavior. Format documented in [`tests/parity/README.md`](../../../tests/parity/README.md).
- **`examples/hono-app/src/index.ts`** — two new test-only routes:
  - `POST /__test/force-expire-otp { otpId }` — forces an OTP row past
    its expiry. Used by `email/verify-expired.json`.
  - The `origins` array now honors `AUTH_ORIGINS` (comma-separated)
    when set, falling back to the hardcoded `localhost:{3000,3001,5173}`
    list. The runner sets `AUTH_ORIGINS=http://localhost:<ephemeral>` so
    WebAuthn ceremonies against an auto-booted server validate.

---

## Repo layout (as built)

```
tests/parity/
├── README.md                       # format + how to run
├── runner/                         # outside pnpm workspace
│   ├── package.json                # private, --ignore-workspace install
│   ├── tsconfig.json               # extends ../../../tsconfig.base.json
│   ├── pnpm-lock.yaml              # committed; playwright pinned to 1.59.1
│   ├── src/
│   │   ├── index.ts                # CLI: discover, boot, run, report
│   │   ├── scenario.ts             # Zod-validated Scenario types + interpolate + pickJsonPath
│   │   ├── matcher.ts              # 8 leaf matchers + nested-object recursion
│   │   ├── transport.ts            # fetch + bearer/cookie modes + tough-cookie CSRF echo
│   │   ├── webauthn.ts             # Playwright virtual-authenticator harness
│   │   ├── executor.ts             # runScenario engine
│   │   └── server.ts               # auto-boot of examples/hono-app via tsx subprocess
│   ├── tests/                      # vitest self-tests (matcher/scenario/transport/executor/webauthn)
│   └── scripts/
│       └── verify-vector.ts        # dev helper for one-off vector runs
└── vectors/
    ├── email/        (5 vectors)   # start-happy, verify-happy, verify-invalid-otp, verify-expired, verify-attempts-exceeded
    ├── passkey/      (5 vectors)   # register-{happy,unauthenticated}, signin-{happy,unknown-credential,invalid-credential}
    ├── session/      (5 vectors)   # me-{happy,unauthenticated}, signout-happy, list-{sessions,passkeys}
    ├── passkey-mgmt/ (2 vectors)   # delete-{happy,unknown}
    ├── csrf/         (2 vectors)   # cookie-mode-happy, csrf-required
    └── validation/   (1 vector)    # invalid-request-body
```

---

## Test counts (verified)

| Suite | Tests | Covers |
|---|---|---|
| `matcher.test.ts` | 31 | each leaf matcher type, nested objects, path-on-mismatch, error envelope |
| `scenario.test.ts` | 25 | Zod schema validation, `interpolate()`, `pickJsonPath()` |
| `transport.test.ts` | 15 | bearer/cookie modes, CSRF echo, `omitCsrf`, Set-Cookie persistence, sign-out clears jar |
| `executor.test.ts` | 11 | capture + interpolation, status mismatch, body mismatch, error envelope, `$webauthn` markers |
| `webauthn.test.ts` | 3 | round-trip create ceremony, get ceremony, isolation between harnesses |
| **Parity vectors** | **20** | every endpoint + every error code except `rate_limited`/`internal_error` (out of scope) |

**85 unit tests + 20 vectors. All pass under `pnpm test:parity` from a clean clone.** Total ~10s on an M-series Mac (Chromium boot is the dominant cost).

---

## Key deviations from the plan

These deviations are load-bearing — future work on the parity suite needs to know them.

### 1. The plan envisioned vector verification at Task 6, but the executor lives at Task 11

The plan's Task 6 step 3 says "Run them against hono-app. Confirm pass" before
Task 11 builds the runner CLI. I split Task 11's executor logic into a separate
intermediate commit (`feat(parity): scenario executor`) between Phase B and
Task 6 so Tasks 6–10 could be incrementally verified. Task 11 then just wraps
the executor in vector discovery + auto-boot. This is a strict superset of
the plan; the commit-per-task convention is preserved.

### 2. The `$webauthn` marker supports `corrupt: "signature"`

The plan's risk register flagged that `signin-invalid-credential` needs a
"deliberate-corruption helper". The executor handles this inline: a step
body of `{ $webauthn: "get", options: "{{x}}", corrupt: "signature" }`
runs the ceremony, then XORs the first byte of the resulting signature
before sending. Implemented in `src/executor.ts`'s `corruptSignature()`.

### 3. `pnpm install` from inside the runner needs `--ignore-workspace`

Without the flag, pnpm walks up, finds the workspace, and installs the
workspace projects (skipping the runner). Documented in
[`tests/parity/README.md`](../../../tests/parity/README.md). The
`test:parity` root script doesn't need it because it `cd`s into the
runner and runs an npm script there.

### 4. Playwright pinned to exact `1.59.1` (not `^`)

The Chromium binary cache key includes the playwright minor version
(1.59 → chromium build 1217, 1.60 → 1223). Pinning exactly to 1.59.1
keeps the cache shared with `examples/web-demo`, which uses
`@playwright/test ^1.45.0` and resolves to 1.59.1 too. If web-demo
ever bumps past 1.59.x, bump the runner in lockstep.

### 5. The runner page-script is a string, not a typed function

`addInitScript({ content: HARNESS_SCRIPT })` takes a JS string. Writing
the page-context helpers (`b64uToBuffer`, `decodeCreate`, etc.) as
typed TypeScript inside `addInitScript(() => {...})` works but pollutes
the surrounding TS file with browser globals (`atob`, `btoa`,
`navigator.credentials`). The string form keeps `webauthn.ts` clean of
DOM types — `tsconfig.json` does NOT include `"DOM"` in `lib`.

### 6. The `/auth/me` email is empty (matches existing quirk)

CLAUDE.md notes `requireSession` returns `email: ""`. The `session/me-happy`
vector asserts `email: { type: "string" }` (any string), not a specific
value — both the current TS server and a future server that DID populate
email would pass this vector. Cross-implementation conformance over
literal-value assertion.

### 7. Force-expire route is a test-only POST, gated by `NODE_ENV=test`

Mirrors the existing `__test/last-otp` pattern. The route writes
`expires_at = 0` directly into `auth_email_otps`. Gated at module load
AND in the handler (defense-in-depth), so production builds never expose
it. Same approach a future Go server should take.

### 8. The auto-boot subprocess uses a tmpdir as cwd

`examples/hono-app` creates `./app.db` relative to `process.cwd()`. The
auto-boot uses `os.tmpdir()` so each `pnpm test:parity` invocation
starts with an empty DB and migrations run fresh. The tmpdir is removed
on subprocess stop.

### 9. The runner's `test:parity` script runs unit tests first, then e2e

`pnpm test:parity` (from repo root) chains:
1. `vitest run --passWithNoTests` — runner self-tests (no server needed)
2. `tsx src/index.ts` — full vector run (boots hono-app, runs all 20)

A failure in (1) short-circuits (2). Self-tests are fast (~500ms);
unit failures should surface before the slow Chromium boot.

### 10. Vectors use static distinct emails per scenario

JSON has no obvious template syntax for "random per-run". Each vector
uses a unique hardcoded email (`parity-{vector-name}@example.com`). The
auto-boot's fresh DB ensures no cross-run state contamination. If
vectors ever need randomness, the executor could grow an
`initialContext` field (already designed in `RunOptions`).

### 11. The plan was committed to main as untracked when this session started

The user authored the plan file in the main repo but didn't commit it
before spawning a worktree. The worktree didn't see the untracked file.
I copied the plan into the worktree and committed it as the first
commit (`docs: add protocol-parity-vectors implementation plan`). On
merge back to main, the original untracked copy in the main repo was
removed (it was byte-identical) so the fast-forward could land.

### 12. The branch was re-authored before push to satisfy GitHub email privacy

The worktree's git config inherited `user.email = mattydsmith@gmail.com`
from `~/.gitconfig`; the existing main commits used the GitHub noreply
variant (`231002+mattydsmith@users.noreply.github.com`). GitHub rejected
the push on email-privacy grounds. With explicit user authorization, I
set a local `user.email` override on the main repo's `.git/config` and
`git rebase main~15 -x 'git commit --amend --reset-author --no-edit'`
re-authored the 15 commits. The orphaned pre-rebase commits remain on
the worktree branch (`claude/adoring-herschel-d19ad9`) and will be GC'd.

---

## Public API surface (what future implementations see)

The runner is invoked the same way regardless of target server:

```bash
pnpm test:parity                                              # auto-boot
pnpm test:parity -- --url=http://localhost:8080               # external server
pnpm test:parity -- --only=passkey                            # filter vectors
```

The CLI exits 0 if every vector passes, 1 on any failure, 2 on usage
error. Failure output includes the per-step path of divergence:

```
FAIL  passkey/register-happy  step 5: $.body.passkeyId: expected non-empty string
```

That message — `<vector-name> step <N>: <jsonpath>: <reason>` — is the
contract for human-readable conformance failures.

---

## How to run things

```bash
# Full conformance check, clean-clone, all 20 vectors
pnpm test:parity

# Just the runner's own unit tests (fast; no server boot)
cd tests/parity/runner && pnpm test

# Single vector against a server you booted yourself
cd tests/parity/runner
pnpm exec tsx scripts/verify-vector.ts --url=http://localhost:3001 \
  ../vectors/email/start-happy.json
```

---

## Open items / things to revisit later

- **`rate_limited` and `internal_error` vectors.** Both are listed in
  `spec/protocol.md` but explicitly deferred ("reserved (not enforced
  by SDK in v1)" and "hard to reliably trigger" respectively).
- **In-memory passkey challenge maps.** Still process-local. A
  multi-instance server would need SQLite-backed pending-challenge
  storage. Out of scope for parity; in scope for production.
- **CI hook.** No GitHub Actions workflow yet. `pnpm test:parity` is
  ready to run in CI; an `.github/workflows/parity.yml` calling
  `pnpm install && pnpm build && cd tests/parity/runner && pnpm install --ignore-workspace && pnpm exec playwright install chromium && cd ../../.. && pnpm test:parity`
  would do it.
- **A Go (or Rust) reference server** that the same suite exercises
  via `--url`. The vectors are language-agnostic; the runner is the
  only Node-dependent piece, and it's standalone.

---

## Files future phases should read first

1. [`spec/protocol.md`](../../../spec/protocol.md) — the contract being conformance-tested.
2. [`tests/parity/README.md`](../../../tests/parity/README.md) — vector format, matcher reference, how to add a new vector.
3. [`tests/parity/runner/src/index.ts`](../../../tests/parity/runner/src/index.ts) — the CLI orchestration.
4. [`tests/parity/runner/src/executor.ts`](../../../tests/parity/runner/src/executor.ts) — scenario execution + `$webauthn` handling.
5. [`docs/superpowers/notes/2026-05-04-phase-3-completion.md`](2026-05-04-phase-3-completion.md) — Swift client handoff, still load-bearing.
6. [`CLAUDE.md`](../../../CLAUDE.md) — repo conventions, updated 2026-05-12.
