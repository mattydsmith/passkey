# Repo conventions for AI-assisted sessions

This file codifies the conventions established during Phases 1–3 and the parity-vectors work. Future Claude (or other agentic) sessions should read this first before making changes.

## Project shape

Personal multi-package SDK at `/Users/mattsmith/Documents/Dev/SDKs/Passkey`. pnpm workspace, four packages (`core`, `hono`, `cli`, `client-web`) plus two examples (`hono-app`, `web-demo`) plus a Swift Package (`clients/PasskeySDK`) and a SwiftUI demo (`clients/ios-demo`). Phases 1 (TS server), 2 (web client + cookie-mode prereqs), and 3 (Swift/iOS client) are all shipped. A cross-implementation HTTP parity suite at `tests/parity/` ships alongside.

## Workflow

- **Use feature branches for new work.** The earlier convention was direct-to-main, but the user lost a chunk of work when an unpushed worktree was cleared, so any non-trivial change now branches off `main` (e.g. `feat/<topic>`) and merges back when complete. Push the branch to `origin` early so it survives a workspace wipe; one-line typo-style edits can still go straight to `main` if the user OKs it in the moment.
- **Remote is `origin` → `github.com/mattydsmith/passkey.git`.** Push only when the user explicitly asks. GitHub blocks pushes that expose the real email; commits must use the noreply variant `231002+mattydsmith@users.noreply.github.com`. The main repo's local git config pins this; the global config still has the real email, so worktrees inherit the wrong value — set the local override on any new clone before committing.
- **No `Co-Authored-By: Claude …` trailer in commit messages** unless the user explicitly asks for it. Plan-prescribed commit messages are the canonical wording.
- **One commit per task** when executing a written plan. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- **TDD where there's testable behavior:** failing test → implement → green → commit. Skip ceremony for pure config / docs / scaffolding.
- **Don't introduce destructive shortcuts.** If a process is in the way (stale dev server, lockfile, etc.), route around it (e.g. use a different port) rather than killing it.

## Reading order for context

When starting a new session or picking up after a break:

1. `docs/superpowers/notes/2026-05-12-parity-vectors-completion.md` — most recent state, conformance suite, deviations
2. `docs/superpowers/notes/2026-05-04-phase-3-completion.md` — Swift/iOS client handoff
3. `docs/superpowers/notes/2026-05-04-phase-2-completion.md` — web client + cookie-mode prereqs
4. `docs/superpowers/notes/2026-05-04-phase-1-completion.md` — server-side context that's still load-bearing
5. `spec/protocol.md` — the durable HTTP contract
6. `tests/parity/README.md` — vector format, matcher reference (only when touching the parity suite)
7. `docs/superpowers/specs/2026-05-03-passkey-sdk-design.md` — overall cross-platform design
8. The package source you're touching

## Commands

All from the repo root:

```bash
pnpm install         # idempotent; lockfile committed
pnpm build           # all four packages via tsup
pnpm typecheck       # tsc --noEmit per package
pnpm test            # vitest in core + hono + client-web
pnpm --filter hono-app-example test     # server e2e via app.request
pnpm --filter web-demo-example test     # Playwright e2e (needs Chromium installed)
pnpm test:parity     # vitest self-tests + auto-boot hono-app + run all 20 conformance vectors
```

The parity runner lives outside the pnpm workspace at `tests/parity/runner/`. First time on a clone, install its deps separately:

```bash
( cd tests/parity/runner && pnpm install --ignore-workspace )
```

`pnpm test:parity` will fail with "vitest: command not found" if you skip that step.

## Build pipeline gotchas

- The `hono` package's tests resolve `@mattsmith/passkey-sdk-core` from its built `dist/`, **not** from source. After touching `core`, run `pnpm --filter @mattsmith/passkey-sdk-core build` before running hono tests, or you'll see stale-symbol errors.
- `tsup` has `clean: true`, so a fresh build wipes `dist/` first. macOS Finder duplicates (`index 2.js`) are gitignored along with the rest of `dist/`.
- `client-web` is a browser package. `tsconfig.json` has `lib: ["ES2022", "DOM"]` and `types: []` to keep `@types/node` out of the build. Don't add Node-only imports here.

## Testing patterns

- **vitest**, not jest. `vitest run` for one-shot, `vitest` for watch.
- **msw** for network mocking in `client-web` tests. **Always include `afterEach(() => server.resetHandlers())`** — without it, `server.use(...)` overrides leak across tests on reordering. This bug bit us during Phase 2.
- **jsdom** as the test env for `client-web`. Default opaque-origin throws `SecurityError` on `localStorage`, and Node 25 has an experimental webstorage global that shadows it. `tests/setup.ts` installs a Map-backed `Storage` shim — keep it.
- **Fake `navigator.credentials`** via `Object.defineProperty(globalThis.navigator, "credentials", { value, configurable: true })`. `vi.stubGlobal` doesn't work for read-only navigator props in jsdom.
- **Playwright** drives the Vite demo through Chromium with `WebAuthn.addVirtualAuthenticator` via CDP. Hono-app runs on port **3001** (not 3000) for tests to sidestep stray dev servers, and `vite.config.ts` proxies `/auth` and `/__test` to make everything same-origin (eliminates CORS).

## TypeScript quirks

- `exactOptionalPropertyTypes: true` is enabled. `{ x?: T }` doesn't accept `{ x: undefined }`. Use the conditional-spread idiom: `...(x !== undefined ? { x } : {})`. This pattern is used throughout `client-web`.
- `noUncheckedIndexedAccess: true`. Array/object indexing returns `T | undefined`. Use `!` only when you're sure (e.g. just after a `.length > 0` check).

## WebAuthn specifics

- **`@simplewebauthn/server` v10** is installed (not v13+). The `registrationInfo` shape is flat, not nested. See `packages/core/src/flows/passkey-register.ts` and `passkey-signin.ts` for the v10-specific reads.
- **Don't use `127.0.0.1` as an RP ID.** WebAuthn rejects IP-literal RP IDs. The hono-app uses `localhost` (works in browsers + the Chromium virtual authenticator). Production deploys would use the apex domain.
- **`passkeyId` is the bare base64url credential id** — same value across `registerPasskey`, `listPasskeys[].id`, and the `:id` in `DELETE /auth/passkeys/:id`. No prefix.
- **`requireSession` returns `email: ""`** because the session table doesn't store email. Apps that need the email hit their own users endpoint or the protocol's `/auth/me`. The parity vector for `/auth/me` matches `email: { type: "string" }` (any string) for cross-implementation tolerance.

## Wire-protocol quirks

- **CSRF**: cookie-mode clients automatically get a non-HttpOnly `csrf` cookie alongside the `session` cookie on session-issuing endpoints; the client transport reads the cookie and echoes `X-CSRF-Token` on non-GET requests. Bearer-mode clients skip the check (no session cookie → middleware bypasses).
- **`Secure` cookies** are auto-set when `X-Forwarded-Proto: https` or the request URL is HTTPS.
- **In-memory passkey challenge maps** (`pendingRegistrations`, `pendingSignIns`) are process-local. Multi-process or restart-survival is deferred.

## Parity suite

- **`tests/parity/`** is the cross-implementation HTTP conformance suite. Vectors are JSON (`tests/parity/vectors/**/*.json`), run by a Node CLI (`tests/parity/runner/`). Tests `examples/hono-app` today; targets any spec-conformant server via `--url=…`.
- **The runner is NOT in the pnpm workspace.** It needs its own `pnpm install --ignore-workspace`. Its `playwright` dep is pinned to an exact version (currently `1.59.1`) to share the Chromium cache with `examples/web-demo`. Bump them together.
- **`examples/hono-app` honors an `AUTH_ORIGINS` env var** (comma-separated list) for its WebAuthn-accepted origins, falling back to `localhost:{3000,3001,5173}`. The runner's auto-boot sets this to the ephemeral port it picks so ceremonies validate. Real deploys should keep the env var unset and rely on the hardcoded list (or extend the list for new ports).
- **Test-only routes on `examples/hono-app`** are gated by `process.env.NODE_ENV === "test"` and `__test/` prefix. Currently: `GET /__test/last-otp?email=`, `POST /__test/force-expire-otp { otpId }`. Both have inner-handler defense-in-depth checks too.
- **The `$webauthn` marker in vector bodies** routes through a Playwright virtual authenticator (`tests/parity/runner/src/webauthn.ts`). The marker supports `corrupt: "signature"` to XOR the first byte of the resulting assertion signature — used by `signin-invalid-credential`.
- **Vectors use static distinct emails** per scenario (`parity-{vector}@example.com`). The auto-boot uses a tmpdir as cwd, so `app.db` is fresh per run.

## What NOT to do without asking

- Add a `LICENSE` file.
- Push to `origin` or publish any package to npm.
- Squash, rebase, force-push, or otherwise rewrite history (the parity-vectors merge rebased its own 15 commits before push, but only because the user explicitly authorized re-authoring for email privacy).
- Kill processes by pattern (`pkill -f …`) — sandbox correctly refuses, and so should you.
- Change `git config` (local or global) without explicit user authorization — the local `user.email` override on this clone is the only documented exception.
