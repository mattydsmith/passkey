# Repo conventions for AI-assisted sessions

This file codifies the conventions established during Phase 1 and Phase 2. Future Claude (or other agentic) sessions should read this first before making changes.

## Project shape

Personal multi-package SDK at `/Users/mattsmith/Documents/Dev/SDKs/Passkey`. pnpm workspace, four packages (`core`, `hono`, `cli`, `client-web`) plus two examples (`hono-app`, `web-demo`). Phase 1 (TS server) and Phase 2 (web client + cookie-mode prereqs) are shipped. Phase 3 (Swift/iOS client) is planned.

## Workflow

- **Work directly on `main`.** This is a single-dev personal repo; the user explicitly authorized direct-to-main commits during Phase 1 and the convention has held since. There is no separate feature-branch workflow, no PR process, no remote (the repo is local-only).
- **No `Co-Authored-By: Claude …` trailer in commit messages** unless the user explicitly asks for it. Plan-prescribed commit messages are the canonical wording.
- **One commit per task** when executing a written plan. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- **TDD where there's testable behavior:** failing test → implement → green → commit. Skip ceremony for pure config / docs / scaffolding.
- **Don't introduce destructive shortcuts.** If a process is in the way (stale dev server, lockfile, etc.), route around it (e.g. use a different port) rather than killing it.

## Reading order for context

When starting a Phase 3+ session or picking up after a break:

1. `docs/superpowers/notes/2026-05-04-phase-2-completion.md` — most recent state, deviations, gotchas
2. `docs/superpowers/notes/2026-05-04-phase-1-completion.md` — server-side context that's still load-bearing
3. `spec/protocol.md` — the durable HTTP contract
4. `docs/superpowers/specs/2026-05-03-passkey-sdk-design.md` — overall cross-platform design
5. The package source you're touching

## Commands

All from the repo root:

```bash
pnpm install         # idempotent; lockfile committed
pnpm build           # all four packages via tsup
pnpm typecheck       # tsc --noEmit per package
pnpm test            # vitest in core + hono + client-web
pnpm --filter hono-app-example test     # server e2e via app.request
pnpm --filter web-demo-example test     # Playwright e2e (needs Chromium installed)
```

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
- **`requireSession` returns `email: ""`** because the session table doesn't store email. Apps that need the email hit their own users endpoint or the protocol's `/auth/me`.

## Wire-protocol quirks

- **CSRF**: cookie-mode clients automatically get a non-HttpOnly `csrf` cookie alongside the `session` cookie on session-issuing endpoints; the client transport reads the cookie and echoes `X-CSRF-Token` on non-GET requests. Bearer-mode clients skip the check (no session cookie → middleware bypasses).
- **`Secure` cookies** are auto-set when `X-Forwarded-Proto: https` or the request URL is HTTPS.
- **In-memory passkey challenge maps** (`pendingRegistrations`, `pendingSignIns`) are process-local. Multi-process or restart-survival is deferred.

## What NOT to do without asking

- Add a `LICENSE` file.
- Set up a remote (`origin`) or push commits anywhere.
- Publish any package to npm.
- Squash, rebase, force-push, or otherwise rewrite history.
- Kill processes by pattern (`pkill -f …`) — sandbox correctly refuses, and so should you.
