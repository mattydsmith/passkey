# Passkey SDK Phase 2 (Web Client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@mattsmith/passkey-sdk-client-web` (the browser TS client for the Passkey SDK) plus the two server v0.1 fixes (CSRF middleware, cookie `Max-Age` threading) that the cookie-mode client requires to be correct.

**Architecture:** The client is a single ESM package — pure functions, no UI, no framework adapters. It wraps `fetch` and `navigator.credentials`, handles base64url ↔ ArrayBuffer conversion, persists the session token (cookie or `localStorage`), and surfaces typed errors mirroring the protocol's error codes. Two server changes go in alongside: a Hono CSRF middleware (double-submit cookie, default-on when a session cookie is configured) and a fix to the cookie `Max-Age` so it follows `config.session.lifetimeSeconds`. A `examples/web-demo` Vite app exercises every flow end-to-end with a Playwright + Chromium WebDriver-BiDi virtual authenticator.

**Tech Stack:** TypeScript (ESM, strict, NodeNext, target ES2022), tsup (esbuild) for the client build, vitest 1.6 + jsdom + msw 2.x for client tests, Vite 5 for the demo, Playwright 1.x with WebDriver BiDi for the e2e. No new runtime deps in the client itself; CSRF middleware uses `node:crypto` already available in the Hono adapter's runtime.

**Reference reading order before starting:**
1. `Passkey/docs/superpowers/specs/2026-05-04-passkey-sdk-phase-2-web-client-design.md` — the design this plan implements
2. `Passkey/spec/protocol.md` — the contract being consumed
3. `Passkey/packages/hono/src/index.ts` — current routes and cookie issuance
4. `Passkey/packages/core/src/auth.ts` — public façade types
5. `Passkey/examples/hono-app/src/index.ts` — server the demo talks to
6. `Passkey/docs/superpowers/notes/2026-05-04-phase-1-completion.md` — known deviations and conventions

**Workflow:** Work directly on `main` (per Phase 1 convention; user explicitly authorized). One commit per task. Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

---

## Phase A — Server v0.1 fixes (Tasks 1–4)

These land first because the client depends on them. After Phase A the server is correct for cookie-mode clients; the client implementation in Phase C/D can rely on CSRF being enforced and the cookie lifetime matching config.

---

### Task 1: Fix cookie `Max-Age` threading

The current adapter hard-codes 30 days at `packages/hono/src/index.ts:56`. Replace with a read of `auth.config.session.lifetimeSeconds`. The `Auth` type doesn't currently expose `config`; we'll thread it through by passing `auth` plus the active lifetime from the call site, OR (simpler) add a getter to the `Auth` return type so the adapter can read it. Use the second approach — minimal API surface change, pure addition.

**Files:**
- Modify: `Passkey/packages/core/src/auth.ts:194-197` (export `config` from the returned `Auth`)
- Modify: `Passkey/packages/hono/src/index.ts:54-58` (read lifetime from `auth.config.session.lifetimeSeconds`)
- Modify: `Passkey/packages/hono/tests/routes.test.ts` (add a test that asserts cookie `Max-Age` matches a non-default lifetime)

- [ ] **Step 1: Add a failing test that a non-default `lifetimeSeconds` shows up in the cookie**

Append to `Passkey/packages/hono/tests/routes.test.ts` (inside the `describe("mountAuthRoutes — email OTP")` block, after the existing cookie test):

```ts
  it("POST /auth/email/verify Max-Age matches config.session.lifetimeSeconds", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const sentOtps: { to: string; code: string }[] = [];
    const auth = createAuth(
      {
        rpId: "example.com",
        origins: ["https://app.example.com"],
        session: { lifetimeSeconds: 3600, cookieName: "session" },
        email: { sendOtp: async (a) => { sentOtps.push(a); } },
        users: {
          findOrCreateByEmail: async () => "u_x",
        },
      },
      { db, deps: defaultDeps }
    );
    const app = new Hono();
    mountAuthRoutes(app, auth);
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    const { otpId } = await start.json();
    const verify = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code: sentOtps[0]!.code }),
    });
    const setCookie = verify.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/Max-Age=3600/);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: this new test FAILS because the cookie `Max-Age` is the hard-coded `2592000`, not `3600`. Existing tests still pass.

- [ ] **Step 3: Expose `config` on the returned `Auth` object**

Edit `Passkey/packages/core/src/auth.ts`. Inside the object returned by `createAuth`, add a `config` property that exposes the active config. Place it near the top of the returned object (after the function docstring/before `startEmailOtp`):

```ts
  return {
    config,
```

The full edit: change the line `return {` (currently around line 72) to:

```ts
  return {
    config,
```

So `Auth` includes the original `AuthConfig` verbatim.

- [ ] **Step 4: Read the lifetime from `auth.config` in the Hono adapter**

Edit `Passkey/packages/hono/src/index.ts`. Replace lines 55–57:

```ts
  const prefix = opts.prefix ?? "/auth";
  const sessionLifetime = 60 * 60 * 24 * 30;
  const cookieName = "session";
```

with:

```ts
  const prefix = opts.prefix ?? "/auth";
  const sessionLifetime = auth.config.session.lifetimeSeconds;
  const cookieName = auth.config.session.cookieName ?? "session";
```

This also fixes a latent bug: the `cookieName` was hard-coded but should follow config.

- [ ] **Step 5: Run the test suite — Max-Age test now passes, all others still pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: all tests PASS, including the new Max-Age assertion.

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: all tests PASS (the new `config` field on `Auth` should not break anything since it's additive).

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
git add packages/core/src/auth.ts packages/hono/src/index.ts packages/hono/tests/routes.test.ts
git commit -m "fix(hono): thread session lifetime to cookie Max-Age

The session cookie's Max-Age was hard-coded to 30 days regardless of
config.session.lifetimeSeconds. Expose config on the Auth return type
and read both lifetime and cookieName from it in the adapter."
```

---

### Task 2: CSRF middleware (TDD)

Build the CSRF middleware as a separate file. Behavior:
- Skip the check when the request method is GET or HEAD.
- Skip when no `<sessionCookieName>` cookie is present on the request (covers pre-session traffic and bearer-mode clients).
- When a session cookie is present, compare the `<csrfCookieName>` cookie value to the `X-CSRF-Token` header. Mismatch or absence → 403 `{ error: "csrf_required", message: "CSRF token missing or invalid" }`.

**Files:**
- Create: `Passkey/packages/hono/src/csrf.ts`
- Create: `Passkey/packages/hono/tests/csrf.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/hono/tests/csrf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { csrfMiddleware } from "../src/csrf.js";

function buildApp() {
  const app = new Hono();
  app.use("*", csrfMiddleware({ sessionCookieName: "session", csrfCookieName: "csrf" }));
  app.post("/x", (c) => c.json({ ok: true }));
  app.get("/y", (c) => c.json({ ok: true }));
  return app;
}

describe("csrfMiddleware", () => {
  it("allows GET requests with no cookies", async () => {
    const app = buildApp();
    const res = await app.request("/y");
    expect(res.status).toBe(200);
  });

  it("allows POST when no session cookie is present", async () => {
    const app = buildApp();
    const res = await app.request("/x", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows POST in bearer mode (session header but no session cookie)", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: { Authorization: "Bearer tok_abc" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects POST with session cookie but no X-CSRF-Token", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: { Cookie: "session=tok_abc; csrf=csrf_value" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("csrf_required");
  });

  it("rejects POST with session cookie and mismatching X-CSRF-Token", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        Cookie: "session=tok_abc; csrf=csrf_value",
        "X-CSRF-Token": "wrong",
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("csrf_required");
  });

  it("rejects POST with session cookie and no csrf cookie", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        Cookie: "session=tok_abc",
        "X-CSRF-Token": "anything",
      },
    });
    expect(res.status).toBe(403);
  });

  it("allows POST with matching csrf cookie and X-CSRF-Token header", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        Cookie: "session=tok_abc; csrf=csrf_value",
        "X-CSRF-Token": "csrf_value",
      },
    });
    expect(res.status).toBe(200);
  });

  it("HEAD is exempt", async () => {
    const app = buildApp();
    const res = await app.request("/y", { method: "HEAD" });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: tests FAIL with module not found ("Cannot find module '../src/csrf.js'") because the middleware doesn't exist yet.

- [ ] **Step 3: Implement the middleware**

Create `Passkey/packages/hono/src/csrf.ts`:

```ts
import type { MiddlewareHandler } from "hono";

export interface CsrfOptions {
  sessionCookieName: string;
  csrfCookieName: string;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === name && v !== undefined) return decodeURIComponent(v);
  }
  return null;
}

export function csrfMiddleware(opts: CsrfOptions): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD") return next();

    const cookieHeader = c.req.header("cookie") ?? null;
    const sessionCookie = readCookie(cookieHeader, opts.sessionCookieName);
    if (!sessionCookie) return next();

    const csrfCookie = readCookie(cookieHeader, opts.csrfCookieName);
    const headerToken = c.req.header("x-csrf-token") ?? null;

    if (!csrfCookie || !headerToken || csrfCookie !== headerToken) {
      return c.json(
        { error: "csrf_required", message: "CSRF token missing or invalid" },
        403
      );
    }
    return next();
  };
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: all CSRF tests PASS. The pre-existing routes tests still pass (no integration yet).

Run: `pnpm --filter @mattsmith/passkey-sdk-hono typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/hono/src/csrf.ts packages/hono/tests/csrf.test.ts
git commit -m "feat(hono): csrf middleware (double-submit cookie)

New csrfMiddleware enforces double-submit cookie pattern. Skips GET/HEAD,
skips when no session cookie is present (pre-session traffic and bearer
mode), validates session+csrf cookie equality with X-CSRF-Token header
otherwise. Not yet wired into mountAuthRoutes."
```

---

### Task 3: Wire CSRF into `mountAuthRoutes` and issue/clear `csrf` cookie

Wire the middleware into `mountAuthRoutes` (default-on when a `cookieName` is configured, opt-out via `csrf: false`). Issue the `csrf` cookie alongside `session` on `/auth/email/verify` and `/auth/passkey/sign-in/finish`. Clear both on sign-out. Add route-level tests covering the integrated behavior.

**Files:**
- Modify: `Passkey/packages/hono/src/index.ts` (wire middleware, set csrf cookie, clear on sign-out)
- Modify: `Passkey/packages/hono/tests/routes.test.ts` (add CSRF integration tests)

- [ ] **Step 1: Add failing integration tests for CSRF on the routes**

Append to `Passkey/packages/hono/tests/routes.test.ts` after the existing describes:

```ts
describe("mountAuthRoutes — CSRF", () => {
  async function signIn(app: ReturnType<typeof buildApp>["app"], sentOtps: { to: string; code: string }[]) {
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    const { otpId } = await start.json();
    const verify = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code: sentOtps[0]!.code }),
    });
    const setCookie = verify.headers.get("set-cookie") ?? "";
    return { setCookie, body: await verify.json() };
  }

  function parseCookies(setCookie: string): Record<string, string> {
    // set-cookie may contain multiple cookies separated by ", " (Hono joins them)
    const out: Record<string, string> = {};
    const cookies = setCookie.split(/,(?=\s*\w+=)/);
    for (const c of cookies) {
      const first = c.split(";")[0]!.trim();
      const [k, v] = first.split("=", 2);
      if (k && v !== undefined) out[k] = decodeURIComponent(v);
    }
    return out;
  }

  it("verify sets both session and csrf cookies", async () => {
    const { app, sentOtps } = buildApp();
    const { setCookie } = await signIn(app, sentOtps);
    const cookies = parseCookies(setCookie);
    expect(cookies.session).toBeDefined();
    expect(cookies.csrf).toBeDefined();
    expect(cookies.csrf!.length).toBeGreaterThan(20);
  });

  it("authenticated POST in cookie mode requires X-CSRF-Token", async () => {
    const { app, sentOtps } = buildApp();
    const { setCookie } = await signIn(app, sentOtps);
    const cookies = parseCookies(setCookie);
    const cookieHeader = `session=${cookies.session}; csrf=${cookies.csrf}`;
    // No X-CSRF-Token header → 403
    const res = await app.request("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookieHeader },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("csrf_required");
  });

  it("authenticated POST in cookie mode with matching X-CSRF-Token succeeds", async () => {
    const { app, sentOtps } = buildApp();
    const { setCookie } = await signIn(app, sentOtps);
    const cookies = parseCookies(setCookie);
    const cookieHeader = `session=${cookies.session}; csrf=${cookies.csrf}`;
    const res = await app.request("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookieHeader, "X-CSRF-Token": cookies.csrf! },
    });
    expect(res.status).toBe(200);
  });

  it("bearer-mode POST does not require X-CSRF-Token", async () => {
    const { app, sentOtps } = buildApp();
    const { body } = await signIn(app, sentOtps);
    const res = await app.request("/auth/sign-out", {
      method: "POST",
      headers: { Authorization: `Bearer ${body.sessionToken}` },
    });
    expect(res.status).toBe(200);
  });

  it("sign-out clears both session and csrf cookies", async () => {
    const { app, sentOtps } = buildApp();
    const { setCookie } = await signIn(app, sentOtps);
    const cookies = parseCookies(setCookie);
    const cookieHeader = `session=${cookies.session}; csrf=${cookies.csrf}`;
    const out = await app.request("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookieHeader, "X-CSRF-Token": cookies.csrf! },
    });
    const cleared = out.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/session=;\s*Path=\/;\s*Max-Age=0/);
    expect(cleared).toMatch(/csrf=;\s*Path=\/;\s*Max-Age=0/);
  });

  it("opt-out via { csrf: false } skips CSRF enforcement", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const sentOtps: { to: string; code: string }[] = [];
    const users = new Map<string, string>();
    const auth = createAuth(
      {
        rpId: "example.com",
        origins: ["https://app.example.com"],
        session: { lifetimeSeconds: 60 * 60 * 24 * 30, cookieName: "session" },
        email: { sendOtp: async (a) => { sentOtps.push(a); } },
        users: {
          findOrCreateByEmail: async (e) => {
            const v = users.get(e); if (v) return v;
            const id = `u_${users.size + 1}`; users.set(e, id); return id;
          },
        },
      },
      { db, deps: defaultDeps }
    );
    const app = new Hono();
    mountAuthRoutes(app, auth, { csrf: false });
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    const { otpId } = await start.json();
    const verify = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code: sentOtps[0]!.code }),
    });
    const setCookie = verify.headers.get("set-cookie") ?? "";
    // Sanity: csrf cookie not issued when opted out
    expect(setCookie).not.toMatch(/csrf=/);
    // Sign-out works with no X-CSRF-Token
    const session = setCookie.match(/session=([^;]+)/)![1]!;
    const out = await app.request("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: `session=${session}` },
    });
    expect(out.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: the new CSRF integration tests FAIL — `cookies.csrf` is undefined (not issued yet), opt-out option is unknown, etc.

- [ ] **Step 3: Wire CSRF into the adapter**

Edit `Passkey/packages/hono/src/index.ts`. Make four changes:

**(a)** Add the import at the top:

```ts
import { randomBytes } from "node:crypto";
import { csrfMiddleware } from "./csrf.js";
```

**(b)** Extend `MountOptions`:

```ts
export interface MountOptions {
  prefix?: string;
  csrf?: boolean;            // default: true when cookieName is configured
  csrfCookieName?: string;   // default: "csrf"
}
```

**(c)** Inside `mountAuthRoutes`, after the existing `prefix`/`sessionLifetime`/`cookieName` reads, install the middleware and add a CSRF cookie helper. Replace the existing block:

```ts
export function mountAuthRoutes(app: Hono, auth: Auth, opts: MountOptions = {}) {
  const prefix = opts.prefix ?? "/auth";
  const sessionLifetime = auth.config.session.lifetimeSeconds;
  const cookieName = auth.config.session.cookieName ?? "session";
```

with:

```ts
export function mountAuthRoutes(app: Hono, auth: Auth, opts: MountOptions = {}) {
  const prefix = opts.prefix ?? "/auth";
  const sessionLifetime = auth.config.session.lifetimeSeconds;
  const cookieName = auth.config.session.cookieName ?? "session";
  const csrfCookieName = opts.csrfCookieName ?? "csrf";
  const csrfEnabled = (opts.csrf ?? true) && Boolean(auth.config.session.cookieName);

  if (csrfEnabled) {
    app.use(`${prefix}/*`, csrfMiddleware({
      sessionCookieName: cookieName,
      csrfCookieName,
    }));
  }

  function setCsrfCookie(c: any) {
    const token = randomBytes(32).toString("base64url");
    const parts = [
      `${csrfCookieName}=${token}`,
      `Path=/`,
      `Max-Age=${sessionLifetime}`,
      `SameSite=Lax`,
    ];
    c.header("set-cookie", parts.join("; "), { append: true });
    return token;
  }
```

Note: `csrf` cookie must be readable from JS, so it is **not** `HttpOnly`. The `set-cookie` call uses `{ append: true }` so it stacks with the session cookie.

**(d)** In the `/auth/email/verify` handler (around lines 67–81 originally), call `setCsrfCookie(c)` right after `setSessionCookie(c, ...)` when CSRF is enabled. Replace:

```ts
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      return c.json(result);
```

with:

```ts
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      if (csrfEnabled) setCsrfCookie(c);
      return c.json(result);
```

**(e)** Same change in `/auth/passkey/sign-in/finish`. Replace the second instance of:

```ts
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      return c.json(result);
```

with:

```ts
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      if (csrfEnabled) setCsrfCookie(c);
      return c.json(result);
```

**(f)** Update the sign-out handler (around line 150) to also clear the CSRF cookie. Replace:

```ts
      c.header("set-cookie", `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
      return c.json({ ok: true });
```

with:

```ts
      c.header("set-cookie", `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
      if (csrfEnabled) {
        c.header("set-cookie", `${csrfCookieName}=; Path=/; Max-Age=0; SameSite=Lax`, { append: true });
      }
      return c.json({ ok: true });
```

- [ ] **Step 4: Run the tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: all CSRF integration tests PASS, all pre-existing tests still pass.

- [ ] **Step 5: Update Phase 1 e2e to send CSRF (or use bearer)**

The pre-existing `examples/hono-app/tests/e2e.test.ts` runs an OTP flow that hits `/api/me` after sign-in. With CSRF on by default, any subsequent POST in cookie mode would need the CSRF header. Read `Passkey/examples/hono-app/tests/e2e.test.ts` to confirm whether it makes any POST after verify; if it only does GET `/api/me`, no change needed (GET is exempt).

Run: `pnpm --filter hono-app-example test`
Expected: PASS. If it fails because of a newly-required CSRF on a POST, update that test file to either include `Authorization: Bearer <sessionToken>` (recommended — tests bearer mode) or to read the `csrf` cookie and forward it as `X-CSRF-Token`.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/hono/src/index.ts packages/hono/tests/routes.test.ts
# Plus examples/hono-app/tests/e2e.test.ts if it needed updating in Step 5
git commit -m "feat(hono): wire csrf middleware + double-submit cookie issuance

Default-on when a session cookie is configured; opt-out via
mountAuthRoutes({ csrf: false }). Issues a non-HttpOnly csrf cookie
alongside session on email/verify and passkey/sign-in/finish, validates
on every authenticated non-GET, clears both on sign-out. Bearer-mode
clients (Authorization header without session cookie) bypass the check."
```

---

### Task 4: Update `spec/protocol.md` with CSRF + new error codes

The protocol doc is the durable contract. Add a CSRF section, the `csrf_required` and `invalid_request` error rows, and the X-CSRF-Token header.

**Files:**
- Modify: `Passkey/spec/protocol.md`

- [ ] **Step 1: Add the CSRF section**

Edit `Passkey/spec/protocol.md`. After line 14 (`The client picks one mode at construction time.`) add a blank line then the following section:

```markdown
## CSRF (cookie mode only)

When the client uses the cookie session mode, the server enforces a
double-submit cookie pattern on all non-GET requests under the auth
prefix. On every session-issuing response (`/auth/email/verify`,
`/auth/passkey/sign-in/finish`), the server sets a `csrf` cookie
alongside `session`. The cookie is **not** `HttpOnly` — the client
reads it and echoes the value as `X-CSRF-Token` on subsequent
non-GET requests. The server returns `csrf_required` (403) on any
non-GET request that has a session cookie but a missing or
mismatching X-CSRF-Token header.

Bearer-mode clients (no session cookie, `Authorization: Bearer …`)
do not need to send X-CSRF-Token; the middleware skips the check
when no session cookie is present. Pre-session traffic
(`/auth/email/start`, `/auth/email/verify`,
`/auth/passkey/sign-in/start`, `/auth/passkey/sign-in/finish`) is
also exempt for the same reason.

The `csrf` cookie is cleared by `/auth/sign-out` alongside `session`.
The cookie name and the enforcement default are configurable on the
server adapter.
```

- [ ] **Step 2: Add the new error codes to the table**

Edit `Passkey/spec/protocol.md`. In the "Error codes" table at the bottom, add two rows:

```markdown
| `csrf_required` | 403 | CSRF token missing or invalid (cookie mode) |
| `invalid_request` | 400 | Request body failed validation |
```

Place `csrf_required` after `unauthenticated` and `invalid_request` at the end. The full table (after edit) should read:

```markdown
| Code | HTTP | Meaning |
|---|---|---|
| `invalid_otp` | 401 | Wrong code, or row not found |
| `otp_attempts_exceeded` | 429 | 5 wrong guesses on this row |
| `otp_expired` | 410 | Past the 10-minute window |
| `invalid_credential` | 401 | Passkey signature didn't verify |
| `unknown_credential` | 404 | Credential ID not found / not yours |
| `unauthenticated` | 401 | No session, or session expired |
| `csrf_required` | 403 | CSRF token missing or invalid (cookie mode) |
| `rate_limited` | 429 | Reserved (not enforced by SDK in v1) |
| `invalid_request` | 400 | Request body failed validation |
```

- [ ] **Step 3: Commit**

```bash
git add spec/protocol.md
git commit -m "docs(spec): csrf section + csrf_required/invalid_request codes"
```

---

## Phase B — Client-web scaffolding (Task 5)

### Task 5: Scaffold `packages/client-web`

Create the package skeleton: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`, an empty test file. Mirror conventions from `packages/core` and `packages/hono`. Add devDeps for vitest, jsdom, msw.

**Files:**
- Create: `Passkey/packages/client-web/package.json`
- Create: `Passkey/packages/client-web/tsconfig.json`
- Create: `Passkey/packages/client-web/tsup.config.ts`
- Create: `Passkey/packages/client-web/vitest.config.ts`
- Create: `Passkey/packages/client-web/src/index.ts`
- Create: `Passkey/packages/client-web/tests/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

Create `Passkey/packages/client-web/package.json`:

```json
{
  "name": "@mattsmith/passkey-sdk-client-web",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "jsdom": "^24.0.0",
    "msw": "^2.4.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

No runtime dependencies — the client uses only `fetch`, `navigator.credentials`, `localStorage`, and `document.cookie`, all from the browser standard library.

- [ ] **Step 2: Create `tsconfig.json`**

Create `Passkey/packages/client-web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "lib": ["ES2022", "DOM"],
    "types": []
  },
  "include": ["src/**/*"]
}
```

Note: `lib` includes `DOM` so `fetch`, `navigator`, `document`, `localStorage`, `PublicKeyCredential` all resolve. `types: []` keeps `@types/node` out of the build (this is a browser package).

- [ ] **Step 3: Create `tsup.config.ts`**

Create `Passkey/packages/client-web/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

Create `Passkey/packages/client-web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
  },
});
```

- [ ] **Step 5: Create the test setup file**

Create `Passkey/packages/client-web/tests/setup.ts`:

```ts
// Default jsdom doesn't include PublicKeyCredential, so feature-detection
// of WebAuthn returns false unless we stub it. Tests that exercise WebAuthn
// install their own stub via vi.stubGlobal.
```

A placeholder for now — empty body. Tests that need globals stub them themselves.

- [ ] **Step 6: Create the public entry**

Create `Passkey/packages/client-web/src/index.ts`:

```ts
export {};
```

Empty for now; populated in Tasks 6–13.

- [ ] **Step 7: Create the smoke test**

Create `Passkey/packages/client-web/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("client-web package", () => {
  it("loads", () => {
    expect(true).toBe(true);
  });
});
```

This is just to verify the test runner is wired correctly.

- [ ] **Step 8: Install deps**

Run: `cd /Users/mattsmith/Documents/Dev/SDKs/Passkey && pnpm install`
Expected: lockfile updates with the new package's devDeps. No errors.

- [ ] **Step 9: Run tests, build, typecheck**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: 1 test PASSES.

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web build`
Expected: builds to `packages/client-web/dist/index.js` + `index.d.ts`.

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/client-web pnpm-lock.yaml
git commit -m "feat(client-web): scaffold @mattsmith/passkey-sdk-client-web

ESM-only browser package, target ES2022, dom lib, vitest + jsdom + msw
test setup. Empty entry; populated in subsequent commits."
```

---

## Phase C — Client-web internals (Tasks 6–10, TDD bottom-up)

Each file has dedicated tests; assemble bottom-up so each layer is solid before the next builds on it.

---

### Task 6: `errors.ts` — `AuthClientError` and code union

The error type that every public method can throw. Mirrors the protocol's error codes plus client-only ones.

**Files:**
- Create: `Passkey/packages/client-web/src/errors.ts`
- Create: `Passkey/packages/client-web/tests/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/client-web/tests/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AuthClientError, isAuthClientError } from "../src/errors.js";

describe("AuthClientError", () => {
  it("has code, message, and optional status/cause", () => {
    const e = new AuthClientError("invalid_otp", "Wrong code", { status: 401 });
    expect(e.code).toBe("invalid_otp");
    expect(e.message).toBe("Wrong code");
    expect(e.status).toBe(401);
    expect(e.cause).toBeUndefined();
    expect(e.name).toBe("AuthClientError");
  });

  it("preserves cause", () => {
    const inner = new Error("network down");
    const e = new AuthClientError("network", "fetch failed", { cause: inner });
    expect(e.cause).toBe(inner);
  });

  it("isAuthClientError narrows the type", () => {
    const e: unknown = new AuthClientError("unauthenticated", "x");
    if (isAuthClientError(e)) {
      // type test: code is the union
      expect(e.code).toBe("unauthenticated");
    } else {
      throw new Error("guard failed");
    }
    expect(isAuthClientError(new Error("nope"))).toBe(false);
    expect(isAuthClientError("string")).toBe(false);
    expect(isAuthClientError(null)).toBe(false);
  });

  it("accepts an unknown server code as a fallback string", () => {
    const e = new AuthClientError("future_code" as any, "msg", { status: 418 });
    expect(e.code).toBe("future_code");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: tests FAIL — module not found.

- [ ] **Step 3: Implement `errors.ts`**

Create `Passkey/packages/client-web/src/errors.ts`:

```ts
export type AuthClientErrorCode =
  | "invalid_otp"
  | "otp_attempts_exceeded"
  | "otp_expired"
  | "invalid_credential"
  | "unknown_credential"
  | "unauthenticated"
  | "rate_limited"
  | "csrf_required"
  | "invalid_request"
  | "network"
  | "passkey_cancelled"
  | "passkey_failed"
  | "unsupported";

export interface AuthClientErrorOptions {
  status?: number;
  cause?: unknown;
}

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode | (string & {});
  readonly status: number | undefined;
  override readonly cause: unknown;

  constructor(
    code: AuthClientErrorCode | (string & {}),
    message: string,
    opts: AuthClientErrorOptions = {}
  ) {
    super(message);
    this.name = "AuthClientError";
    this.code = code;
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

export function isAuthClientError(value: unknown): value is AuthClientError {
  return value instanceof AuthClientError;
}
```

The `(string & {})` trick keeps the union open for unknown server codes while still giving autocomplete on the known ones.

- [ ] **Step 4: Update `src/index.ts` to export the error**

Replace `Passkey/packages/client-web/src/index.ts` contents:

```ts
export {
  AuthClientError,
  isAuthClientError,
  type AuthClientErrorCode,
  type AuthClientErrorOptions,
} from "./errors.js";
```

- [ ] **Step 5: Run the tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: all tests PASS.

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client-web/src packages/client-web/tests
git commit -m "feat(client-web): AuthClientError + code union

Single error type with discriminated code (every protocol code plus
client-only network/passkey/unsupported codes). String-fallback type
keeps the union open to forward-compat with new server codes."
```

---

### Task 7: `webauthn.ts` — base64url codec (just the codec; navigator wrapper next task)

Pure functions that round-trip ArrayBuffer ↔ base64url string. No deps. Used by the WebAuthn wrapper in Task 8.

**Files:**
- Create: `Passkey/packages/client-web/src/webauthn.ts`
- Create: `Passkey/packages/client-web/tests/webauthn-codec.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/client-web/tests/webauthn-codec.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bufferToBase64url, base64urlToBuffer } from "../src/webauthn.js";

describe("base64url codec", () => {
  it("round-trips an empty buffer", () => {
    const b = new Uint8Array([]).buffer;
    expect(bufferToBase64url(b)).toBe("");
    expect(base64urlToBuffer("").byteLength).toBe(0);
  });

  it("round-trips a known short buffer", () => {
    // bytes [0xff, 0xfe, 0xfd] → "//79" in standard base64 → "__79" in base64url
    const b = new Uint8Array([0xff, 0xfe, 0xfd]).buffer;
    expect(bufferToBase64url(b)).toBe("__79");
    const decoded = new Uint8Array(base64urlToBuffer("__79"));
    expect(Array.from(decoded)).toEqual([0xff, 0xfe, 0xfd]);
  });

  it("strips padding (=) on encode", () => {
    // 1 byte → 2 char + 2 pad in standard base64; base64url drops pad
    const b = new Uint8Array([0x4d]).buffer;
    expect(bufferToBase64url(b)).toBe("TQ");
  });

  it("accepts padded input on decode", () => {
    const a = new Uint8Array(base64urlToBuffer("TQ=="));
    expect(Array.from(a)).toEqual([0x4d]);
  });

  it("round-trips random 256 bytes", () => {
    const bytes = new Uint8Array(256);
    crypto.getRandomValues(bytes);
    const encoded = bufferToBase64url(bytes.buffer);
    const decoded = new Uint8Array(base64urlToBuffer(encoded));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("base64url uses - and _ instead of + and /", () => {
    // bytes that produce + and / in standard base64
    // [0x3e] → "Pg==" standard; [0x3f] → "Pw==" — find one that produces +//
    const b = new Uint8Array([0xfb, 0xff]).buffer; // "+/8=" standard
    const out = bufferToBase64url(b);
    expect(out).not.toMatch(/[+/=]/);
    expect(out).toBe("-_8");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: FAIL — module `../src/webauthn.js` not found.

- [ ] **Step 3: Implement the codec**

Create `Passkey/packages/client-web/src/webauthn.ts`:

```ts
export function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const standard = btoa(binary);
  return standard.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBuffer(b64url: string): ArrayBuffer {
  const padded = b64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: codec tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client-web/src/webauthn.ts packages/client-web/tests/webauthn-codec.test.ts
git commit -m "feat(client-web): base64url codec for ArrayBuffer round-trip"
```

---

### Task 8: `webauthn.ts` — `navigator.credentials` wrapper

Build on the codec. Two pairs of functions: option-side (server JSON → DOM `PublicKeyCredentialCreationOptions` / `RequestOptions`) and credential-side (DOM `PublicKeyCredential` → server JSON). Plus the `performRegistration`/`performSignIn` orchestrators that wrap `navigator.credentials.create`/`get` and map errors.

**Files:**
- Modify: `Passkey/packages/client-web/src/webauthn.ts` (add the wrapper functions)
- Create: `Passkey/packages/client-web/tests/webauthn-wrapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/client-web/tests/webauthn-wrapper.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decodeCreationOptions,
  decodeRequestOptions,
  encodePublicKeyCredential,
  performRegistration,
  performSignIn,
  bufferToBase64url,
} from "../src/webauthn.js";
import { AuthClientError } from "../src/errors.js";

const sampleCreationOptions = {
  challenge: "Y2g=",  // base64url for "ch" (no padding stripped here for clarity)
  rp: { id: "example.com", name: "example" },
  user: { id: "dV9hYmM", name: "matt@example.com", displayName: "matt@example.com" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [{ type: "public-key", id: "Y3JlZA", transports: ["internal"] }],
  authenticatorSelection: { userVerification: "preferred" },
  timeout: 60000,
};

const sampleRequestOptions = {
  challenge: "Y2g",
  rpId: "example.com",
  allowCredentials: [],
  userVerification: "preferred",
  timeout: 60000,
};

describe("decodeCreationOptions", () => {
  it("converts base64url challenge and user.id to ArrayBuffers", () => {
    const decoded = decodeCreationOptions(sampleCreationOptions);
    expect(decoded.challenge).toBeInstanceOf(ArrayBuffer);
    expect(decoded.user.id).toBeInstanceOf(ArrayBuffer);
    expect(decoded.rp.id).toBe("example.com");
    expect(decoded.user.name).toBe("matt@example.com");
  });

  it("converts excludeCredentials[].id", () => {
    const decoded = decodeCreationOptions(sampleCreationOptions);
    expect(decoded.excludeCredentials).toHaveLength(1);
    expect(decoded.excludeCredentials![0].id).toBeInstanceOf(ArrayBuffer);
    expect(decoded.excludeCredentials![0].transports).toEqual(["internal"]);
  });
});

describe("decodeRequestOptions", () => {
  it("converts challenge and allowCredentials[].id", () => {
    const opts = {
      ...sampleRequestOptions,
      allowCredentials: [{ type: "public-key", id: "Y3JlZA" }],
    };
    const decoded = decodeRequestOptions(opts);
    expect(decoded.challenge).toBeInstanceOf(ArrayBuffer);
    expect(decoded.allowCredentials![0].id).toBeInstanceOf(ArrayBuffer);
  });

  it("handles empty allowCredentials", () => {
    const decoded = decodeRequestOptions(sampleRequestOptions);
    expect(decoded.allowCredentials).toEqual([]);
  });
});

describe("encodePublicKeyCredential", () => {
  function makeAttestationCredential() {
    const rawId = new Uint8Array([1, 2, 3]).buffer;
    const clientDataJSON = new Uint8Array([0x7b, 0x7d]).buffer; // "{}"
    const attestationObject = new Uint8Array([0x40, 0x40]).buffer;
    return {
      id: bufferToBase64url(rawId),
      rawId,
      type: "public-key",
      response: {
        clientDataJSON,
        attestationObject,
      } as AuthenticatorAttestationResponse,
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
  }

  function makeAssertionCredential() {
    const rawId = new Uint8Array([4, 5, 6]).buffer;
    const clientDataJSON = new Uint8Array([0x7b, 0x7d]).buffer;
    const authenticatorData = new Uint8Array([0xaa]).buffer;
    const signature = new Uint8Array([0xbb]).buffer;
    const userHandle = new Uint8Array([0xcc]).buffer;
    return {
      id: bufferToBase64url(rawId),
      rawId,
      type: "public-key",
      response: {
        clientDataJSON,
        authenticatorData,
        signature,
        userHandle,
      } as AuthenticatorAssertionResponse,
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
  }

  it("encodes an attestation credential to JSON", () => {
    const cred = makeAttestationCredential();
    const out = encodePublicKeyCredential(cred);
    expect(out.id).toBe(bufferToBase64url(new Uint8Array([1, 2, 3]).buffer));
    expect(out.rawId).toBe(out.id);
    expect(out.type).toBe("public-key");
    expect(out.response.clientDataJSON).toBe(bufferToBase64url(new Uint8Array([0x7b, 0x7d]).buffer));
    expect(out.response.attestationObject).toBe(bufferToBase64url(new Uint8Array([0x40, 0x40]).buffer));
    expect(out.response.authenticatorData).toBeUndefined();
  });

  it("encodes an assertion credential to JSON", () => {
    const cred = makeAssertionCredential();
    const out = encodePublicKeyCredential(cred);
    expect(out.response.attestationObject).toBeUndefined();
    expect(out.response.authenticatorData).toBe(bufferToBase64url(new Uint8Array([0xaa]).buffer));
    expect(out.response.signature).toBe(bufferToBase64url(new Uint8Array([0xbb]).buffer));
    expect(out.response.userHandle).toBe(bufferToBase64url(new Uint8Array([0xcc]).buffer));
  });
});

describe("performRegistration / performSignIn", () => {
  let originalCredentials: any;

  beforeEach(() => {
    originalCredentials = (globalThis as any).navigator?.credentials;
  });

  afterEach(() => {
    if (originalCredentials !== undefined) {
      Object.defineProperty(globalThis.navigator, "credentials", {
        value: originalCredentials,
        configurable: true,
      });
    }
  });

  function stubCredentials(stub: { create?: any; get?: any }) {
    Object.defineProperty(globalThis.navigator, "credentials", {
      value: stub,
      configurable: true,
    });
  }

  it("performRegistration calls navigator.credentials.create with decoded options", async () => {
    const fakeCred = {
      id: "abc",
      rawId: new Uint8Array([1]).buffer,
      type: "public-key",
      response: {
        clientDataJSON: new Uint8Array([0x7b, 0x7d]).buffer,
        attestationObject: new Uint8Array([0x40]).buffer,
      },
      getClientExtensionResults: () => ({}),
    };
    const create = vi.fn().mockResolvedValue(fakeCred);
    stubCredentials({ create });
    const out = await performRegistration(sampleCreationOptions);
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0][0];
    expect(arg.publicKey.challenge).toBeInstanceOf(ArrayBuffer);
    expect(out.id).toBe("abc");
  });

  it("maps NotAllowedError to passkey_cancelled", async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" })
    );
    stubCredentials({ create });
    await expect(performRegistration(sampleCreationOptions))
      .rejects.toThrowError(AuthClientError);
    try {
      await performRegistration(sampleCreationOptions);
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_cancelled");
    }
  });

  it("maps AbortError to passkey_cancelled", async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );
    stubCredentials({ create });
    try {
      await performRegistration(sampleCreationOptions);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_cancelled");
    }
  });

  it("maps unknown errors to passkey_failed", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    stubCredentials({ create });
    try {
      await performRegistration(sampleCreationOptions);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_failed");
    }
  });

  it("throws unsupported when navigator.credentials is missing", async () => {
    Object.defineProperty(globalThis.navigator, "credentials", {
      value: undefined,
      configurable: true,
    });
    try {
      await performRegistration(sampleCreationOptions);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("unsupported");
    }
  });

  it("performSignIn calls navigator.credentials.get and encodes assertion", async () => {
    const fakeAssertion = {
      id: "asn",
      rawId: new Uint8Array([2]).buffer,
      type: "public-key",
      response: {
        clientDataJSON: new Uint8Array([0x7b]).buffer,
        authenticatorData: new Uint8Array([0xaa]).buffer,
        signature: new Uint8Array([0xbb]).buffer,
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    };
    const get = vi.fn().mockResolvedValue(fakeAssertion);
    stubCredentials({ get });
    const out = await performSignIn(sampleRequestOptions);
    expect(get).toHaveBeenCalledOnce();
    expect(out.id).toBe("asn");
    expect(out.response.signature).toBeDefined();
    expect(out.response.userHandle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: tests FAIL — exports don't exist yet.

- [ ] **Step 3: Implement the wrapper**

Append to `Passkey/packages/client-web/src/webauthn.ts` (after the codec functions):

```ts
import { AuthClientError } from "./errors.js";

export interface ServerCreationOptions {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  excludeCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface ServerRequestOptions {
  challenge: string;
  rpId?: string;
  allowCredentials?: { type: "public-key"; id: string; transports?: string[] }[];
  userVerification?: UserVerificationRequirement;
  timeout?: number;
  extensions?: AuthenticationExtensionsClientInputs;
}

export interface PublicKeyCredentialJSON {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    attestationObject?: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string;
  };
  clientExtensionResults?: AuthenticationExtensionsClientOutputs;
}

export function decodeCreationOptions(
  o: ServerCreationOptions
): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64urlToBuffer(o.challenge),
    rp: o.rp,
    user: {
      id: base64urlToBuffer(o.user.id),
      name: o.user.name,
      displayName: o.user.displayName,
    },
    pubKeyCredParams: o.pubKeyCredParams,
    excludeCredentials: o.excludeCredentials?.map((c) => ({
      type: c.type,
      id: base64urlToBuffer(c.id),
      ...(c.transports !== undefined ? { transports: c.transports as AuthenticatorTransport[] } : {}),
    })),
    ...(o.authenticatorSelection !== undefined ? { authenticatorSelection: o.authenticatorSelection } : {}),
    ...(o.timeout !== undefined ? { timeout: o.timeout } : {}),
    ...(o.attestation !== undefined ? { attestation: o.attestation } : {}),
    ...(o.extensions !== undefined ? { extensions: o.extensions } : {}),
  };
}

export function decodeRequestOptions(
  o: ServerRequestOptions
): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64urlToBuffer(o.challenge),
    ...(o.rpId !== undefined ? { rpId: o.rpId } : {}),
    allowCredentials: (o.allowCredentials ?? []).map((c) => ({
      type: c.type,
      id: base64urlToBuffer(c.id),
      ...(c.transports !== undefined ? { transports: c.transports as AuthenticatorTransport[] } : {}),
    })),
    ...(o.userVerification !== undefined ? { userVerification: o.userVerification } : {}),
    ...(o.timeout !== undefined ? { timeout: o.timeout } : {}),
    ...(o.extensions !== undefined ? { extensions: o.extensions } : {}),
  };
}

export function encodePublicKeyCredential(cred: PublicKeyCredential): PublicKeyCredentialJSON {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const attestationObject = (r as AuthenticatorAttestationResponse).attestationObject;
  const authenticatorData = (r as AuthenticatorAssertionResponse).authenticatorData;
  const signature = (r as AuthenticatorAssertionResponse).signature;
  const userHandle = (r as AuthenticatorAssertionResponse).userHandle;
  const out: PublicKeyCredentialJSON = {
    id: bufferToBase64url(cred.rawId),
    rawId: bufferToBase64url(cred.rawId),
    type: "public-key",
    response: {
      clientDataJSON: bufferToBase64url(r.clientDataJSON),
      ...(attestationObject ? { attestationObject: bufferToBase64url(attestationObject) } : {}),
      ...(authenticatorData ? { authenticatorData: bufferToBase64url(authenticatorData) } : {}),
      ...(signature ? { signature: bufferToBase64url(signature) } : {}),
      ...(userHandle ? { userHandle: bufferToBase64url(userHandle) } : {}),
    },
  };
  try {
    const ext = cred.getClientExtensionResults?.();
    if (ext) out.clientExtensionResults = ext;
  } catch {
    /* extensions are optional */
  }
  return out;
}

function mapWebAuthnError(err: unknown): AuthClientError {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name: string }).name;
    if (name === "NotAllowedError" || name === "AbortError") {
      return new AuthClientError("passkey_cancelled", "User cancelled or timed out", { cause: err });
    }
  }
  const msg = err instanceof Error ? err.message : "Passkey ceremony failed";
  return new AuthClientError("passkey_failed", msg, { cause: err });
}

function ensureSupported(): void {
  if (typeof navigator === "undefined" || !navigator.credentials) {
    throw new AuthClientError("unsupported", "navigator.credentials is not available");
  }
}

export async function performRegistration(
  options: ServerCreationOptions
): Promise<PublicKeyCredentialJSON> {
  ensureSupported();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: decodeCreationOptions(options),
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapWebAuthnError(err);
  }
  if (!cred) throw new AuthClientError("passkey_failed", "No credential returned");
  return encodePublicKeyCredential(cred);
}

export async function performSignIn(
  options: ServerRequestOptions
): Promise<PublicKeyCredentialJSON> {
  ensureSupported();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: decodeRequestOptions(options),
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapWebAuthnError(err);
  }
  if (!cred) throw new AuthClientError("passkey_failed", "No credential returned");
  return encodePublicKeyCredential(cred);
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: all webauthn tests PASS.

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client-web/src/webauthn.ts packages/client-web/tests/webauthn-wrapper.test.ts
git commit -m "feat(client-web): navigator.credentials wrapper

Decodes server creation/request options to DOM types, encodes
PublicKeyCredential responses back to JSON. performRegistration /
performSignIn orchestrate the call and map NotAllowedError/AbortError
to passkey_cancelled, other errors to passkey_failed, missing
navigator.credentials to unsupported."
```

---

### Task 9: `storage.ts` — session-token storage strategies

Two strategies behind one tiny interface. Cookie mode is mostly no-ops (the browser handles the cookie). Header mode persists to `localStorage` and attaches `Authorization: Bearer …`.

**Files:**
- Create: `Passkey/packages/client-web/src/storage.ts`
- Create: `Passkey/packages/client-web/tests/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/client-web/tests/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createSessionStorage } from "../src/storage.js";

describe("createSessionStorage — cookie mode", () => {
  it("load/save/clear are no-ops", () => {
    const s = createSessionStorage("cookie");
    expect(s.load()).toBeNull();
    s.save("tok_abc");
    expect(s.load()).toBeNull();
    s.clear();
    expect(s.load()).toBeNull();
  });

  it("attachToRequest does not add Authorization", () => {
    const s = createSessionStorage("cookie");
    const headers = new Headers();
    s.attachToRequest(headers);
    expect(headers.get("authorization")).toBeNull();
  });

  it("returns includeCredentials=true", () => {
    const s = createSessionStorage("cookie");
    expect(s.includeCredentials).toBe(true);
  });
});

describe("createSessionStorage — header mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("save/load round-trips through localStorage", () => {
    const s = createSessionStorage("header");
    expect(s.load()).toBeNull();
    s.save("tok_abc");
    expect(s.load()).toBe("tok_abc");
  });

  it("uses the configured storageKey", () => {
    const s = createSessionStorage("header", { storageKey: "custom:key" });
    s.save("tok_xyz");
    expect(localStorage.getItem("custom:key")).toBe("tok_xyz");
  });

  it("clear removes the entry", () => {
    const s = createSessionStorage("header");
    s.save("tok_abc");
    s.clear();
    expect(s.load()).toBeNull();
  });

  it("attachToRequest adds Authorization: Bearer when token present", () => {
    const s = createSessionStorage("header");
    s.save("tok_abc");
    const headers = new Headers();
    s.attachToRequest(headers);
    expect(headers.get("authorization")).toBe("Bearer tok_abc");
  });

  it("attachToRequest does not add header when no token", () => {
    const s = createSessionStorage("header");
    const headers = new Headers();
    s.attachToRequest(headers);
    expect(headers.get("authorization")).toBeNull();
  });

  it("returns includeCredentials=false", () => {
    const s = createSessionStorage("header");
    expect(s.includeCredentials).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `storage.ts`**

Create `Passkey/packages/client-web/src/storage.ts`:

```ts
export type SessionMode = "cookie" | "header";

export interface SessionStorage {
  load(): string | null;
  save(token: string): void;
  clear(): void;
  attachToRequest(headers: Headers): void;
  readonly includeCredentials: boolean;
}

export interface SessionStorageOptions {
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "passkey-sdk:session";

export function createSessionStorage(
  mode: SessionMode,
  opts: SessionStorageOptions = {}
): SessionStorage {
  if (mode === "cookie") {
    return {
      load: () => null,
      save: () => {},
      clear: () => {},
      attachToRequest: () => {},
      includeCredentials: true,
    };
  }
  const key = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  return {
    load: () => localStorage.getItem(key),
    save: (token: string) => {
      localStorage.setItem(key, token);
    },
    clear: () => {
      localStorage.removeItem(key);
    },
    attachToRequest: (headers: Headers) => {
      const token = localStorage.getItem(key);
      if (token) headers.set("Authorization", `Bearer ${token}`);
    },
    includeCredentials: false,
  };
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: all storage tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client-web/src/storage.ts packages/client-web/tests/storage.test.ts
git commit -m "feat(client-web): session storage (cookie + header modes)"
```

---

### Task 10: `transport.ts` — fetch wrapper, CSRF, error mapping

The bridge between client methods and the server. Composes path against `baseUrl`, attaches storage headers, reads CSRF cookie and adds `X-CSRF-Token` on non-GET in cookie mode, parses responses, maps errors.

**Files:**
- Create: `Passkey/packages/client-web/src/transport.ts`
- Create: `Passkey/packages/client-web/tests/transport.test.ts`

- [ ] **Step 1: Write the failing tests (uses msw to mock fetch)**

Create `Passkey/packages/client-web/tests/transport.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createTransport } from "../src/transport.js";
import { createSessionStorage } from "../src/storage.js";
import { AuthClientError } from "../src/errors.js";

const BASE = "https://api.example.test/auth";

let lastRequest: { method: string; url: string; headers: Record<string, string>; body: any } | null = null;

const server = setupServer(
  http.post(`${BASE}/email/start`, async ({ request }) => {
    lastRequest = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await request.json(),
    };
    return HttpResponse.json({ otpId: "otp_x", expiresInSeconds: 600 });
  }),
  http.get(`${BASE}/me`, ({ request }) => {
    lastRequest = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: null,
    };
    return HttpResponse.json({ user: { id: "u_1", email: "matt@example.com" } });
  }),
  http.post(`${BASE}/sign-out`, ({ request }) => {
    lastRequest = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: null,
    };
    return HttpResponse.json({ ok: true });
  }),
  http.post(`${BASE}/email/verify`, () =>
    HttpResponse.json({ error: "invalid_otp", message: "wrong" }, { status: 401 })
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  lastRequest = null;
  localStorage.clear();
  // jsdom document.cookie isolation
  for (const c of document.cookie.split(";")) {
    const k = c.split("=")[0]?.trim();
    if (k) document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
});

describe("transport — request shape", () => {
  it("composes baseUrl with the path", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    await t.request("/email/start", { method: "POST", body: { email: "a@b.c" } });
    expect(lastRequest?.url).toBe(`${BASE}/email/start`);
  });

  it("sets content-type on JSON bodies", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    await t.request("/email/start", { method: "POST", body: { email: "a@b.c" } });
    expect(lastRequest?.headers["content-type"]).toMatch(/application\/json/);
  });

  it("parses JSON response on 2xx", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    const res = await t.request<{ otpId: string }>("/email/start", {
      method: "POST",
      body: { email: "a@b.c" },
    });
    expect(res.otpId).toBe("otp_x");
  });
});

describe("transport — header mode", () => {
  it("attaches Authorization: Bearer when token saved", async () => {
    const storage = createSessionStorage("header");
    storage.save("tok_abc");
    const t = createTransport({ baseUrl: BASE, storage });
    await t.request("/me", { method: "GET" });
    expect(lastRequest?.headers["authorization"]).toBe("Bearer tok_abc");
  });

  it("does not add Authorization when no token saved", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    await t.request("/me", { method: "GET" });
    expect(lastRequest?.headers["authorization"]).toBeUndefined();
  });
});

describe("transport — cookie mode CSRF", () => {
  it("adds X-CSRF-Token when csrf cookie is present and method is non-GET", async () => {
    document.cookie = "csrf=csrf_value; path=/";
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
    });
    await t.request("/sign-out", { method: "POST" });
    expect(lastRequest?.headers["x-csrf-token"]).toBe("csrf_value");
  });

  it("uses configured csrfCookieName", async () => {
    document.cookie = "my_csrf=abc123; path=/";
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
      csrfCookieName: "my_csrf",
    });
    await t.request("/sign-out", { method: "POST" });
    expect(lastRequest?.headers["x-csrf-token"]).toBe("abc123");
  });

  it("does not add X-CSRF-Token on GET", async () => {
    document.cookie = "csrf=csrf_value; path=/";
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
    });
    await t.request("/me", { method: "GET" });
    expect(lastRequest?.headers["x-csrf-token"]).toBeUndefined();
  });

  it("omits X-CSRF-Token when csrf cookie is absent (lets server return 403)", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
    });
    await t.request("/sign-out", { method: "POST" });
    expect(lastRequest?.headers["x-csrf-token"]).toBeUndefined();
  });
});

describe("transport — error mapping", () => {
  it("non-2xx with known error code throws AuthClientError with that code", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    try {
      await t.request("/email/verify", {
        method: "POST",
        body: { otpId: "x", code: "000000" },
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthClientError);
      expect((e as AuthClientError).code).toBe("invalid_otp");
      expect((e as AuthClientError).status).toBe(401);
    }
  });

  it("network/non-JSON failure throws AuthClientError network", async () => {
    server.use(
      http.post(`${BASE}/email/start`, () => HttpResponse.error()),
    );
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    try {
      await t.request("/email/start", { method: "POST", body: { email: "a@b.c" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthClientError);
      expect((e as AuthClientError).code).toBe("network");
    }
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transport.ts`**

Create `Passkey/packages/client-web/src/transport.ts`:

```ts
import { AuthClientError, type AuthClientErrorCode } from "./errors.js";
import type { SessionStorage } from "./storage.js";

export interface TransportOptions {
  baseUrl: string;
  storage: SessionStorage;
  fetch?: typeof fetch;
  csrfCookieName?: string;
}

export interface RequestOptions {
  method: "GET" | "POST" | "DELETE";
  body?: unknown;
}

export interface Transport {
  request<T = unknown>(path: string, opts: RequestOptions): Promise<T>;
}

const DEFAULT_CSRF_COOKIE = "csrf";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === name && v !== undefined) return decodeURIComponent(v);
  }
  return null;
}

export function createTransport(opts: TransportOptions): Transport {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const csrfCookieName = opts.csrfCookieName ?? DEFAULT_CSRF_COOKIE;

  return {
    async request<T = unknown>(path: string, ro: RequestOptions): Promise<T> {
      const url = baseUrl + (path.startsWith("/") ? path : `/${path}`);
      const headers = new Headers();
      const init: RequestInit = { method: ro.method, headers };

      if (ro.body !== undefined) {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(ro.body);
      }

      opts.storage.attachToRequest(headers);
      if (opts.storage.includeCredentials) {
        init.credentials = "include";
        if (ro.method !== "GET" && ro.method !== "HEAD") {
          const csrf = readCookie(csrfCookieName);
          if (csrf) headers.set("X-CSRF-Token", csrf);
        }
      }

      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (err) {
        throw new AuthClientError("network", "Network request failed", { cause: err });
      }

      let parsed: any;
      const text = await response.text();
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch (err) {
          throw new AuthClientError("network", "Response was not valid JSON", {
            status: response.status,
            cause: err,
          });
        }
      }

      if (!response.ok) {
        const code = (parsed?.error as AuthClientErrorCode | string) ?? "network";
        const message = (parsed?.message as string) ?? response.statusText;
        throw new AuthClientError(code, message, { status: response.status });
      }

      return parsed as T;
    },
  };
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: all transport tests PASS.

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client-web/src/transport.ts packages/client-web/tests/transport.test.ts
git commit -m "feat(client-web): transport (fetch wrapper, csrf, error mapping)

Composes baseUrl, attaches storage headers, reads csrf cookie and adds
X-CSRF-Token on non-GET in cookie mode, parses JSON, maps non-2xx
responses to AuthClientError with the protocol error code."
```

---

## Phase D — Public façade (Tasks 11–13, TDD top-down via msw)

### Task 11: `client.ts` — `createAuthClient` + email flow

Public façade. Methods: `startEmailSignIn`, `verifyEmailOtp`, `getCurrentUser`, `signOut`. Other methods land in Tasks 12–13. Establishes the contract pattern: each method delegates to the transport, strips the `sessionToken` from the response (storing it via `storage.save` in header mode), returns the public shape.

**Files:**
- Create: `Passkey/packages/client-web/src/types.ts`
- Create: `Passkey/packages/client-web/src/client.ts`
- Create: `Passkey/packages/client-web/tests/client-email.test.ts`
- Modify: `Passkey/packages/client-web/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/client-web/tests/client-email.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createAuthClient } from "../src/client.js";
import { AuthClientError } from "../src/errors.js";

const BASE = "https://api.example.test/auth";

let lastBody: any = null;
let lastHeaders: Record<string, string> = {};

const server = setupServer(
  http.post(`${BASE}/email/start`, async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json({ otpId: "otp_x", expiresInSeconds: 600 });
  }),
  http.post(`${BASE}/email/verify`, async ({ request }) => {
    lastBody = await request.json();
    lastHeaders = Object.fromEntries(request.headers);
    return HttpResponse.json({
      sessionToken: "tok_abc",
      user: { id: "u_1", email: "matt@example.com" },
    });
  }),
  http.get(`${BASE}/me`, ({ request }) => {
    lastHeaders = Object.fromEntries(request.headers);
    return HttpResponse.json({ user: { id: "u_1", email: "matt@example.com" } });
  }),
  http.post(`${BASE}/sign-out`, ({ request }) => {
    lastHeaders = Object.fromEntries(request.headers);
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  lastBody = null;
  lastHeaders = {};
  localStorage.clear();
});

describe("createAuthClient — email flow (header mode)", () => {
  it("startEmailSignIn returns otpId + expiresInSeconds", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.startEmailSignIn("matt@example.com");
    expect(out.otpId).toBe("otp_x");
    expect(out.expiresInSeconds).toBe(600);
    expect(lastBody.email).toBe("matt@example.com");
  });

  it("verifyEmailOtp returns { user } and persists token in header mode", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.verifyEmailOtp("otp_x", "123456");
    expect(out.user.id).toBe("u_1");
    expect((out as any).sessionToken).toBeUndefined();
    expect(localStorage.getItem("passkey-sdk:session")).toBe("tok_abc");
  });

  it("getCurrentUser uses persisted token", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    const me = await client.getCurrentUser();
    expect(me.user.id).toBe("u_1");
    expect(lastHeaders["authorization"]).toBe("Bearer tok_abc");
  });

  it("signOut clears the persisted token in header mode", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    expect(localStorage.getItem("passkey-sdk:session")).toBe("tok_abc");
    await client.signOut();
    expect(localStorage.getItem("passkey-sdk:session")).toBeNull();
  });

  it("verifyEmailOtp surfaces invalid_otp", async () => {
    server.use(
      http.post(`${BASE}/email/verify`, () =>
        HttpResponse.json({ error: "invalid_otp", message: "wrong" }, { status: 401 })
      )
    );
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    try {
      await client.verifyEmailOtp("otp_x", "000000");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("invalid_otp");
    }
  });
});

describe("createAuthClient — email flow (cookie mode)", () => {
  it("verifyEmailOtp does not persist token in cookie mode", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "cookie" });
    const out = await client.verifyEmailOtp("otp_x", "123456");
    expect(out.user.id).toBe("u_1");
    expect(localStorage.getItem("passkey-sdk:session")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `types.ts`**

Create `Passkey/packages/client-web/src/types.ts`:

```ts
export type AuthUser = { id: string; email: string };

export type StartEmailSignInResult = { otpId: string; expiresInSeconds: number };
export type VerifyEmailOtpResult = { user: AuthUser };
export type RegisterPasskeyResult = { passkeyId: string };
export type SignInWithPasskeyResult = { user: AuthUser };
export type GetCurrentUserResult = { user: AuthUser };

export type SessionSummary = {
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  ip: string | null;
};
export type ListSessionsResult = { sessions: SessionSummary[] };

export type PasskeySummary = {
  id: string;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  transports: string[] | null;
};
export type ListPasskeysResult = { passkeys: PasskeySummary[] };

export interface AuthClientConfig {
  baseUrl: string;
  storage: "cookie" | "header";
  fetch?: typeof fetch;
  storageKey?: string;
  csrfCookieName?: string;
}
```

- [ ] **Step 4: Create `client.ts` (email + session methods first)**

Create `Passkey/packages/client-web/src/client.ts`:

```ts
import { createTransport } from "./transport.js";
import { createSessionStorage } from "./storage.js";
import type {
  AuthClientConfig,
  StartEmailSignInResult,
  VerifyEmailOtpResult,
  GetCurrentUserResult,
} from "./types.js";

export interface AuthClient {
  startEmailSignIn(email: string): Promise<StartEmailSignInResult>;
  verifyEmailOtp(otpId: string, code: string): Promise<VerifyEmailOtpResult>;
  getCurrentUser(): Promise<GetCurrentUserResult>;
  signOut(): Promise<void>;
}

export function createAuthClient(config: AuthClientConfig): AuthClient {
  const storage = createSessionStorage(
    config.storage,
    config.storageKey !== undefined ? { storageKey: config.storageKey } : {}
  );
  const transport = createTransport({
    baseUrl: config.baseUrl,
    storage,
    ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
    ...(config.csrfCookieName !== undefined ? { csrfCookieName: config.csrfCookieName } : {}),
  });

  return {
    async startEmailSignIn(email) {
      return transport.request<StartEmailSignInResult>("/email/start", {
        method: "POST",
        body: { email },
      });
    },

    async verifyEmailOtp(otpId, code) {
      const res = await transport.request<{ sessionToken: string; user: { id: string; email: string } }>(
        "/email/verify",
        { method: "POST", body: { otpId, code } }
      );
      storage.save(res.sessionToken);
      return { user: res.user };
    },

    async getCurrentUser() {
      return transport.request<GetCurrentUserResult>("/me", { method: "GET" });
    },

    async signOut() {
      await transport.request<{ ok: true }>("/sign-out", { method: "POST" });
      storage.clear();
    },
  };
}
```

- [ ] **Step 5: Update `src/index.ts` to export the client**

Replace `Passkey/packages/client-web/src/index.ts`:

```ts
export {
  AuthClientError,
  isAuthClientError,
  type AuthClientErrorCode,
  type AuthClientErrorOptions,
} from "./errors.js";

export { createAuthClient, type AuthClient } from "./client.js";

export type {
  AuthUser,
  AuthClientConfig,
  StartEmailSignInResult,
  VerifyEmailOtpResult,
  RegisterPasskeyResult,
  SignInWithPasskeyResult,
  GetCurrentUserResult,
  SessionSummary,
  ListSessionsResult,
  PasskeySummary,
  ListPasskeysResult,
} from "./types.js";
```

- [ ] **Step 6: Run tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: all client-email tests PASS, plus pre-existing tests.

- [ ] **Step 7: Commit**

```bash
git add packages/client-web/src/client.ts packages/client-web/src/types.ts packages/client-web/src/index.ts packages/client-web/tests/client-email.test.ts
git commit -m "feat(client-web): createAuthClient + email/session methods

Public façade with startEmailSignIn, verifyEmailOtp, getCurrentUser,
signOut. Persists session token in header mode; relies on cookie in
cookie mode. Token never surfaces in public results."
```

---

### Task 12: Passkey methods — `registerPasskey` + `signInWithPasskey`

Adds the two passkey ceremonies to the client. Each uses the WebAuthn wrapper from Task 8 plus two transport calls (start + finish).

**Files:**
- Modify: `Passkey/packages/client-web/src/client.ts`
- Create: `Passkey/packages/client-web/tests/client-passkey.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/client-web/tests/client-passkey.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createAuthClient } from "../src/client.js";
import { AuthClientError } from "../src/errors.js";
import { bufferToBase64url } from "../src/webauthn.js";

const BASE = "https://api.example.test/auth";

let lastFinishBody: any = null;

const server = setupServer(
  http.post(`${BASE}/email/verify`, () =>
    HttpResponse.json({ sessionToken: "tok_abc", user: { id: "u_1", email: "m@x.y" } })
  ),
  http.post(`${BASE}/passkey/register/start`, () =>
    HttpResponse.json({
      registrationId: "reg_x",
      options: {
        challenge: "Y2g",
        rp: { id: "example.com", name: "example" },
        user: { id: "dV8x", name: "m@x.y", displayName: "m@x.y" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        excludeCredentials: [],
        timeout: 60000,
      },
    })
  ),
  http.post(`${BASE}/passkey/register/finish`, async ({ request }) => {
    lastFinishBody = await request.json();
    return HttpResponse.json({ passkeyId: "pk_x" });
  }),
  http.post(`${BASE}/passkey/sign-in/start`, () =>
    HttpResponse.json({
      signInId: "auth_x",
      options: {
        challenge: "Y2g",
        rpId: "example.com",
        allowCredentials: [],
        userVerification: "preferred",
        timeout: 60000,
      },
    })
  ),
  http.post(`${BASE}/passkey/sign-in/finish`, async ({ request }) => {
    lastFinishBody = await request.json();
    return HttpResponse.json({
      sessionToken: "tok_pk",
      user: { id: "u_1", email: "" },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  lastFinishBody = null;
  localStorage.clear();
});

function stubCredentials(stub: { create?: any; get?: any }) {
  Object.defineProperty(globalThis.navigator, "credentials", {
    value: stub,
    configurable: true,
  });
}

function fakeAttestation() {
  const rawId = new Uint8Array([1, 2, 3]).buffer;
  return {
    id: bufferToBase64url(rawId),
    rawId,
    type: "public-key",
    response: {
      clientDataJSON: new Uint8Array([0x7b, 0x7d]).buffer,
      attestationObject: new Uint8Array([0x40]).buffer,
    },
    getClientExtensionResults: () => ({}),
  };
}

function fakeAssertion() {
  const rawId = new Uint8Array([4, 5, 6]).buffer;
  return {
    id: bufferToBase64url(rawId),
    rawId,
    type: "public-key",
    response: {
      clientDataJSON: new Uint8Array([0x7b]).buffer,
      authenticatorData: new Uint8Array([0xaa]).buffer,
      signature: new Uint8Array([0xbb]).buffer,
      userHandle: null,
    },
    getClientExtensionResults: () => ({}),
  };
}

describe("registerPasskey", () => {
  it("happy path: start → create → finish", async () => {
    stubCredentials({ create: vi.fn().mockResolvedValue(fakeAttestation()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456"); // get a session
    const out = await client.registerPasskey({ deviceName: "MacBook" });
    expect(out.passkeyId).toBe("pk_x");
    expect(lastFinishBody.registrationId).toBe("reg_x");
    expect(lastFinishBody.deviceName).toBe("MacBook");
    expect(typeof lastFinishBody.credential).toBe("object");
    expect(lastFinishBody.credential.id).toBeDefined();
    expect(lastFinishBody.credential.response.attestationObject).toBeDefined();
  });

  it("registerPasskey without deviceName omits the field", async () => {
    stubCredentials({ create: vi.fn().mockResolvedValue(fakeAttestation()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    await client.registerPasskey();
    expect(lastFinishBody.deviceName).toBeUndefined();
  });

  it("registerPasskey surfaces NotAllowedError as passkey_cancelled", async () => {
    stubCredentials({
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error("denied"), { name: "NotAllowedError" })
      ),
    });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    try {
      await client.registerPasskey();
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_cancelled");
    }
  });
});

describe("signInWithPasskey", () => {
  it("happy path: start → get → finish, persists token", async () => {
    stubCredentials({ get: vi.fn().mockResolvedValue(fakeAssertion()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.signInWithPasskey();
    expect(out.user.id).toBe("u_1");
    expect((out as any).sessionToken).toBeUndefined();
    expect(localStorage.getItem("passkey-sdk:session")).toBe("tok_pk");
    expect(lastFinishBody.signInId).toBe("auth_x");
  });

  it("surfaces invalid_credential", async () => {
    server.use(
      http.post(`${BASE}/passkey/sign-in/finish`, () =>
        HttpResponse.json({ error: "invalid_credential", message: "bad sig" }, { status: 401 })
      )
    );
    stubCredentials({ get: vi.fn().mockResolvedValue(fakeAssertion()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    try {
      await client.signInWithPasskey();
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("invalid_credential");
    }
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: client-passkey tests FAIL — `registerPasskey` and `signInWithPasskey` don't exist on the client yet.

- [ ] **Step 3: Add passkey methods to `client.ts`**

Edit `Passkey/packages/client-web/src/client.ts`. Add the imports at the top:

```ts
import {
  performRegistration,
  performSignIn,
  type ServerCreationOptions,
  type ServerRequestOptions,
} from "./webauthn.js";
import type {
  RegisterPasskeyResult,
  SignInWithPasskeyResult,
} from "./types.js";
```

Extend the `AuthClient` interface:

```ts
export interface AuthClient {
  startEmailSignIn(email: string): Promise<StartEmailSignInResult>;
  verifyEmailOtp(otpId: string, code: string): Promise<VerifyEmailOtpResult>;
  registerPasskey(opts?: { deviceName?: string }): Promise<RegisterPasskeyResult>;
  signInWithPasskey(): Promise<SignInWithPasskeyResult>;
  getCurrentUser(): Promise<GetCurrentUserResult>;
  signOut(): Promise<void>;
}
```

Add the two methods inside the `return { ... }` block (between `verifyEmailOtp` and `getCurrentUser`):

```ts
    async registerPasskey(opts) {
      const start = await transport.request<{ registrationId: string; options: ServerCreationOptions }>(
        "/passkey/register/start",
        { method: "POST" }
      );
      const credential = await performRegistration(start.options);
      const body: { registrationId: string; credential: typeof credential; deviceName?: string } = {
        registrationId: start.registrationId,
        credential,
        ...(opts?.deviceName !== undefined ? { deviceName: opts.deviceName } : {}),
      };
      return transport.request<RegisterPasskeyResult>("/passkey/register/finish", {
        method: "POST",
        body,
      });
    },

    async signInWithPasskey() {
      const start = await transport.request<{ signInId: string; options: ServerRequestOptions }>(
        "/passkey/sign-in/start",
        { method: "POST" }
      );
      const credential = await performSignIn(start.options);
      const res = await transport.request<{ sessionToken: string; user: { id: string; email: string } }>(
        "/passkey/sign-in/finish",
        { method: "POST", body: { signInId: start.signInId, credential } }
      );
      storage.save(res.sessionToken);
      return { user: res.user };
    },
```

- [ ] **Step 4: Run tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: passkey tests PASS, all pre-existing tests still pass.

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client-web/src/client.ts packages/client-web/tests/client-passkey.test.ts
git commit -m "feat(client-web): registerPasskey + signInWithPasskey

Two-step ceremonies wrapping navigator.credentials. Encodes attestation/
assertion responses to JSON, sends to server, persists session token
on successful sign-in."
```

---

### Task 13: Management methods — `listSessions`, `listPasskeys`, `deletePasskey`

Round out the public surface.

**Files:**
- Modify: `Passkey/packages/client-web/src/client.ts`
- Create: `Passkey/packages/client-web/tests/client-management.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `Passkey/packages/client-web/tests/client-management.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createAuthClient } from "../src/client.js";
import { AuthClientError } from "../src/errors.js";

const BASE = "https://api.example.test/auth";

let lastUrl: string | null = null;

const server = setupServer(
  http.get(`${BASE}/sessions`, () =>
    HttpResponse.json({
      sessions: [
        { createdAt: 100, expiresAt: 200, lastSeenAt: 150, userAgent: "ua", ip: "1.2.3.4" },
      ],
    })
  ),
  http.get(`${BASE}/passkeys`, () =>
    HttpResponse.json({
      passkeys: [
        {
          id: "pk_1",
          deviceName: "MacBook",
          createdAt: 100,
          lastUsedAt: 200,
          transports: ["internal"],
        },
      ],
    })
  ),
  http.delete(`${BASE}/passkeys/:id`, ({ request }) => {
    lastUrl = request.url;
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

beforeEach(() => {
  lastUrl = null;
  localStorage.clear();
});

describe("listSessions", () => {
  it("returns the sessions array", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.listSessions();
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].userAgent).toBe("ua");
  });
});

describe("listPasskeys", () => {
  it("returns the passkeys array", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.listPasskeys();
    expect(out.passkeys[0].id).toBe("pk_1");
    expect(out.passkeys[0].transports).toEqual(["internal"]);
  });
});

describe("deletePasskey", () => {
  it("DELETE /auth/passkeys/:id", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.deletePasskey("pk_1");
    expect(lastUrl).toBe(`${BASE}/passkeys/pk_1`);
  });

  it("URL-encodes the id", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.deletePasskey("a/b+c");
    // %2F %2B %3D etc; just assert the raw chars don't appear unencoded
    expect(lastUrl).not.toContain("a/b+c");
    expect(lastUrl).toContain("a%2Fb%2Bc");
  });

  it("surfaces unknown_credential as AuthClientError", async () => {
    server.use(
      http.delete(`${BASE}/passkeys/:id`, () =>
        HttpResponse.json({ error: "unknown_credential", message: "Not yours" }, { status: 404 })
      )
    );
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    try {
      await client.deletePasskey("pk_other");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("unknown_credential");
    }
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: management tests FAIL — methods don't exist.

- [ ] **Step 3: Add management methods to `client.ts`**

Edit `Passkey/packages/client-web/src/client.ts`. Update the imports at the top to add `ListSessionsResult` / `ListPasskeysResult`:

```ts
import type {
  AuthClientConfig,
  StartEmailSignInResult,
  VerifyEmailOtpResult,
  GetCurrentUserResult,
  RegisterPasskeyResult,
  SignInWithPasskeyResult,
  ListSessionsResult,
  ListPasskeysResult,
} from "./types.js";
```

Extend `AuthClient`:

```ts
export interface AuthClient {
  startEmailSignIn(email: string): Promise<StartEmailSignInResult>;
  verifyEmailOtp(otpId: string, code: string): Promise<VerifyEmailOtpResult>;
  registerPasskey(opts?: { deviceName?: string }): Promise<RegisterPasskeyResult>;
  signInWithPasskey(): Promise<SignInWithPasskeyResult>;
  getCurrentUser(): Promise<GetCurrentUserResult>;
  signOut(): Promise<void>;
  listSessions(): Promise<ListSessionsResult>;
  listPasskeys(): Promise<ListPasskeysResult>;
  deletePasskey(id: string): Promise<void>;
}
```

Add the three methods inside `return { ... }` (after `signOut`):

```ts
    async listSessions() {
      return transport.request<ListSessionsResult>("/sessions", { method: "GET" });
    },

    async listPasskeys() {
      return transport.request<ListPasskeysResult>("/passkeys", { method: "GET" });
    },

    async deletePasskey(id) {
      await transport.request<{ ok: true }>(`/passkeys/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
```

- [ ] **Step 4: Run tests — they pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web test`
Expected: management tests PASS, all earlier tests still pass.

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web typecheck`
Expected: no errors.

- [ ] **Step 5: Build the package as a final check**

Run: `pnpm --filter @mattsmith/passkey-sdk-client-web build`
Expected: clean ESM build to `dist/`. No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/client-web/src/client.ts packages/client-web/tests/client-management.test.ts
git commit -m "feat(client-web): listSessions, listPasskeys, deletePasskey"
```

---

## Phase E — Reference example app (Tasks 14–16)

### Task 14: Test-only `/__test/last-otp` endpoint on `hono-app`

Required by the Playwright e2e: gives the test a way to read the most recent OTP without parsing stdout. Guarded by `NODE_ENV === "test"` so it can never leak in production.

**Files:**
- Modify: `Passkey/examples/hono-app/src/index.ts`
- Modify: `Passkey/examples/hono-app/tests/e2e.test.ts` (add a coverage test confirming the endpoint exists in test mode and is absent otherwise)

- [ ] **Step 1: Write a failing test**

Append to `Passkey/examples/hono-app/tests/e2e.test.ts` (inside the existing top-level describe):

```ts
  it("__test/last-otp returns the most recent OTP when NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    // re-import the app to pick up the env
    const { app: testApp } = await import("../src/index.js?test");
    await testApp.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.z" }),
    });
    const res = await testApp.request("/__test/last-otp?email=x@y.z");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
  });
```

NOTE: Cache-busting via `?test` query string on import is a hack for vitest's module cache. If it doesn't pick up the env change reliably, instead use vitest's `vi.resetModules()` + a fresh import, OR (cleaner) keep the env-check inside the route handler so the same module instance can serve both modes based on a runtime check. The actual implementation in Step 3 takes the runtime-check approach to avoid this complication — adjust the test to remove the dynamic re-import:

Replace the test you just wrote with:

```ts
  it("__test/last-otp returns the most recent OTP when NODE_ENV=test", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      await app.request("/auth/email/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "peek@example.com" }),
      });
      const res = await app.request("/__test/last-otp?email=peek@example.com");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.code).toMatch(/^\d{6}$/);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("__test/last-otp is 404 when NODE_ENV is not test", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await app.request("/__test/last-otp?email=x@y.z");
      expect(res.status).toBe(404);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter hono-app-example test`
Expected: FAIL — `/__test/last-otp` returns 404 (no such route).

- [ ] **Step 3: Implement the endpoint**

Edit `Passkey/examples/hono-app/src/index.ts`. Replace the `email.sendOtp` callback with a version that captures the most recent OTP per email, and add the route:

Replace lines 26–30 (the `email` block) with:

```ts
    email: {
      sendOtp: async ({ to, code }) => {
        // Dev: log OTPs to the console. In production, swap for Resend/SES/etc.
        console.log(`\n  📧 OTP for ${to}: ${code}\n`);
        lastOtps.set(to, code);
      },
    },
```

Above `const auth = createAuth(...)`, declare the map:

```ts
const lastOtps = new Map<string, string>();
```

After `mountAuthRoutes(app, auth);` (around line 55) insert:

```ts
// Test-only endpoint to retrieve the most recent OTP for an email.
// Guarded at request time by NODE_ENV — never serves outside test mode.
app.get("/__test/last-otp", (c) => {
  if (process.env.NODE_ENV !== "test") {
    return c.json({ error: "not_found" }, 404);
  }
  const email = c.req.query("email");
  if (!email) return c.json({ error: "missing_email" }, 400);
  const code = lastOtps.get(email);
  if (!code) return c.json({ error: "no_otp_for_email" }, 404);
  return c.json({ code });
});
```

- [ ] **Step 4: Run the tests — they pass**

Run: `pnpm --filter hono-app-example test`
Expected: all tests PASS, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add examples/hono-app/src/index.ts examples/hono-app/tests/e2e.test.ts
git commit -m "feat(examples): test-only /__test/last-otp endpoint

Captures the most recent OTP per email so the Playwright e2e can read
it without parsing stdout. Guarded at request time by NODE_ENV=test."
```

---

### Task 15: Scaffold `examples/web-demo`

A minimal Vite app exercising every public method on `@mattsmith/passkey-sdk-client-web`. UI is intentionally bare-bones — buttons + textareas + a status pane. The Playwright e2e drives this UI in Task 16.

**Files:**
- Create: `Passkey/examples/web-demo/package.json`
- Create: `Passkey/examples/web-demo/tsconfig.json`
- Create: `Passkey/examples/web-demo/vite.config.ts`
- Create: `Passkey/examples/web-demo/index.html`
- Create: `Passkey/examples/web-demo/src/main.ts`

- [ ] **Step 1: Create `package.json`**

Create `Passkey/examples/web-demo/package.json`:

```json
{
  "name": "web-demo-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5173 --host 127.0.0.1",
    "build": "vite build",
    "preview": "vite preview --port 5173 --host 127.0.0.1",
    "test": "playwright test"
  },
  "dependencies": {
    "@mattsmith/passkey-sdk-client-web": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "typescript": "^5.4.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Create `Passkey/examples/web-demo/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "lib": ["ES2022", "DOM"],
    "types": [],
    "moduleResolution": "Bundler",
    "module": "ESNext"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

Create `Passkey/examples/web-demo/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, host: "127.0.0.1" },
  resolve: { dedupe: ["@mattsmith/passkey-sdk-client-web"] },
});
```

- [ ] **Step 4: Create `index.html`**

Create `Passkey/examples/web-demo/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Passkey SDK Web Demo</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
      section { margin-bottom: 1.5rem; padding: 1rem; border: 1px solid #ddd; border-radius: 6px; }
      input, button { font-size: 1rem; padding: 0.4rem 0.6rem; margin: 0.2rem 0.2rem 0.2rem 0; }
      pre { background: #f4f4f4; padding: 0.5rem; overflow: auto; }
    </style>
  </head>
  <body>
    <h1>Passkey SDK Web Demo</h1>

    <section>
      <h2>Email OTP</h2>
      <input id="email" type="email" placeholder="you@example.com" />
      <button id="btn-start">Send OTP</button>
      <input id="otp" type="text" placeholder="6-digit code" />
      <button id="btn-verify">Verify OTP</button>
    </section>

    <section>
      <h2>Passkey</h2>
      <button id="btn-register">Register Passkey</button>
      <button id="btn-signin">Sign in with Passkey</button>
    </section>

    <section>
      <h2>Session</h2>
      <button id="btn-me">Get Current User</button>
      <button id="btn-signout">Sign Out</button>
      <button id="btn-sessions">List Sessions</button>
      <button id="btn-passkeys">List Passkeys</button>
    </section>

    <section>
      <h2>Status</h2>
      <pre id="out">(no output yet)</pre>
    </section>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/main.ts`**

Create `Passkey/examples/web-demo/src/main.ts`:

```ts
import { createAuthClient, AuthClientError } from "@mattsmith/passkey-sdk-client-web";

const client = createAuthClient({
  baseUrl: "http://127.0.0.1:3000/auth",
  storage: "cookie",
});

const out = document.getElementById("out") as HTMLPreElement;
let pendingOtpId: string | null = null;
let pendingPasskeyId: string | null = null;

function show(label: string, value: unknown) {
  const text =
    value instanceof AuthClientError
      ? `ERROR ${value.code}: ${value.message}`
      : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);
  out.textContent = `[${label}] ${text}`;
}

function $(id: string): HTMLInputElement | HTMLButtonElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as HTMLInputElement | HTMLButtonElement;
}

$("btn-start").addEventListener("click", async () => {
  try {
    const email = ($("email") as HTMLInputElement).value;
    const res = await client.startEmailSignIn(email);
    pendingOtpId = res.otpId;
    show("startEmailSignIn", res);
  } catch (e) { show("startEmailSignIn", e); }
});

$("btn-verify").addEventListener("click", async () => {
  try {
    if (!pendingOtpId) return show("verifyEmailOtp", "no pending otpId");
    const code = ($("otp") as HTMLInputElement).value;
    const res = await client.verifyEmailOtp(pendingOtpId, code);
    show("verifyEmailOtp", res);
  } catch (e) { show("verifyEmailOtp", e); }
});

$("btn-register").addEventListener("click", async () => {
  try {
    const res = await client.registerPasskey({ deviceName: "Demo browser" });
    pendingPasskeyId = res.passkeyId;
    show("registerPasskey", res);
  } catch (e) { show("registerPasskey", e); }
});

$("btn-signin").addEventListener("click", async () => {
  try {
    const res = await client.signInWithPasskey();
    show("signInWithPasskey", res);
  } catch (e) { show("signInWithPasskey", e); }
});

$("btn-me").addEventListener("click", async () => {
  try {
    const res = await client.getCurrentUser();
    show("getCurrentUser", res);
  } catch (e) { show("getCurrentUser", e); }
});

$("btn-signout").addEventListener("click", async () => {
  try {
    await client.signOut();
    show("signOut", "ok");
  } catch (e) { show("signOut", e); }
});

$("btn-sessions").addEventListener("click", async () => {
  try {
    const res = await client.listSessions();
    show("listSessions", res);
  } catch (e) { show("listSessions", e); }
});

$("btn-passkeys").addEventListener("click", async () => {
  try {
    const res = await client.listPasskeys();
    show("listPasskeys", res);
    if (pendingPasskeyId !== null) {
      // expose for e2e
      (window as any).__lastPasskeyId = pendingPasskeyId;
    }
  } catch (e) { show("listPasskeys", e); }
});
```

The hono-app uses `rpId: "localhost"` and origins `["http://localhost:5173", "http://localhost:3000"]`. The demo uses `127.0.0.1` for everything since browsers treat `127.0.0.1` as a "secure context" without HTTPS, which WebAuthn requires. **Update `examples/hono-app/src/index.ts`** if needed: change origins to include `http://127.0.0.1:5173` and `http://127.0.0.1:3000`, and `rpId` to `127.0.0.1`. Or, alternatively, run the demo on `localhost:5173` to match. Pick one and stay consistent.

Decision: switch to `127.0.0.1` everywhere — it works in CI without the localhost-only browser carve-outs and is what Playwright defaults to. Edit `examples/hono-app/src/index.ts` line 23–24:

Replace:

```ts
    rpId: "localhost",
    origins: ["http://localhost:5173", "http://localhost:3000"],
```

with:

```ts
    rpId: "127.0.0.1",
    origins: ["http://127.0.0.1:5173", "http://127.0.0.1:3000"],
```

Note: `127.0.0.1` is a valid RP ID for WebAuthn in dev; production deploys would use the apex domain.

- [ ] **Step 6: Install deps**

Run: `pnpm install`
Expected: lockfile updates with vite + playwright. No errors.

- [ ] **Step 7: Smoke-build the demo**

Run: `pnpm --filter web-demo-example build`
Expected: clean Vite build to `examples/web-demo/dist/`.

- [ ] **Step 8: Verify hono-app still passes its tests with the 127.0.0.1 change**

Run: `pnpm --filter hono-app-example test`
Expected: all tests PASS. (The e2e test at `examples/hono-app/tests/e2e.test.ts` uses `app.request()`, so RP ID/origins don't affect it.)

- [ ] **Step 9: Commit**

```bash
git add examples/web-demo examples/hono-app/src/index.ts pnpm-lock.yaml
git commit -m "feat(examples): web-demo Vite app + 127.0.0.1 origin/rpId

Reference consumer of @mattsmith/passkey-sdk-client-web exercising
every public method. Switches hono-app rpId/origins to 127.0.0.1 for
WebAuthn secure-context support without HTTPS in dev/test."
```

---

### Task 16: Playwright e2e against the real Hono server with virtual authenticator

The end-to-end harness. Spins up `hono-app` on :3000 and `web-demo` on :5173 via Playwright's `webServer` config, opens the demo in Chromium with a WebDriver-BiDi virtual authenticator, drives the full flow.

**Files:**
- Create: `Passkey/examples/web-demo/playwright.config.ts`
- Create: `Passkey/examples/web-demo/tests/e2e.spec.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

Create `Passkey/examples/web-demo/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter hono-app-example dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      env: { NODE_ENV: "test", PORT: "3000" },
      timeout: 30_000,
    },
    {
      command: "pnpm --filter web-demo-example dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
```

- [ ] **Step 2: Create the e2e test**

Create `Passkey/examples/web-demo/tests/e2e.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";

const EMAIL = `e2e-${Date.now()}@example.com`;

async function readStatus(page: Page): Promise<string> {
  return (await page.locator("#out").textContent()) ?? "";
}

async function fetchLastOtp(email: string): Promise<string> {
  const res = await fetch(
    `http://127.0.0.1:3000/__test/last-otp?email=${encodeURIComponent(email)}`
  );
  if (!res.ok) throw new Error(`last-otp returned ${res.status}`);
  const body = (await res.json()) as { code: string };
  return body.code;
}

test("full flow: email OTP → register passkey → sign-out → sign-in with passkey", async ({
  page,
  context,
}) => {
  // Add a virtual authenticator via CDP (Chromium-only)
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  await page.goto("/");

  // Email OTP — start
  await page.locator("#email").fill(EMAIL);
  await page.locator("#btn-start").click();
  await expect.poll(() => readStatus(page)).toContain("startEmailSignIn");
  expect(await readStatus(page)).toContain("otpId");

  // Pull the OTP from the test endpoint
  const code = await fetchLastOtp(EMAIL);

  // Email OTP — verify
  await page.locator("#otp").fill(code);
  await page.locator("#btn-verify").click();
  await expect.poll(() => readStatus(page)).toContain("verifyEmailOtp");
  expect(await readStatus(page)).toContain(EMAIL);

  // Register passkey (virtual authenticator auto-confirms)
  await page.locator("#btn-register").click();
  await expect.poll(() => readStatus(page)).toContain("registerPasskey");
  expect(await readStatus(page)).toMatch(/passkeyId/);

  // Get current user — confirms session is active
  await page.locator("#btn-me").click();
  await expect.poll(() => readStatus(page)).toContain("getCurrentUser");
  expect(await readStatus(page)).toContain("u_");

  // Sign out
  await page.locator("#btn-signout").click();
  await expect.poll(() => readStatus(page)).toContain("signOut");

  // Confirm signed out: /me should now error
  await page.locator("#btn-me").click();
  await expect.poll(() => readStatus(page)).toContain("ERROR unauthenticated");

  // Sign in with passkey — should succeed using the resident credential
  await page.locator("#btn-signin").click();
  await expect.poll(() => readStatus(page)).toContain("signInWithPasskey");
  expect(await readStatus(page)).toMatch(/u_/);

  // /me again — back in
  await page.locator("#btn-me").click();
  await expect.poll(() => readStatus(page)).toContain("getCurrentUser");
});
```

- [ ] **Step 3: Install Playwright browsers**

Run: `pnpm --filter web-demo-example exec playwright install chromium`
Expected: Chromium downloads (~150MB first time).

- [ ] **Step 4: Run the e2e test**

Run: `pnpm --filter web-demo-example test`
Expected: webServer entries spin up `hono-app` on :3000 and `web-demo` on :5173, then Chromium runs the test. PASSES.

If the test fails because the virtual authenticator can't satisfy `userVerification: "preferred"`, double-check that the `addVirtualAuthenticator` options have `isUserVerified: true`.

If the test fails because the cookie isn't being sent cross-origin (5173 → 3000), the cookie's `SameSite=Lax` should allow same-site top-level navigation; if Playwright's fetch path treats them as different sites, switch the demo to use the same origin (e.g. by adding a Vite proxy in `vite.config.ts`):

```ts
server: {
  port: 5173,
  host: "127.0.0.1",
  proxy: { "/auth": "http://127.0.0.1:3000", "/__test": "http://127.0.0.1:3000" },
},
```

and change the client's `baseUrl` in `src/main.ts` from `http://127.0.0.1:3000/auth` to `/auth`. This makes everything same-origin; cookies just work. Apply this proxy approach if the cross-origin path causes flakiness.

- [ ] **Step 5: Commit**

```bash
git add examples/web-demo/playwright.config.ts examples/web-demo/tests/e2e.spec.ts
# Plus examples/web-demo/vite.config.ts and examples/web-demo/src/main.ts if Step 4's
# proxy fallback was needed.
git commit -m "test(examples): web-demo Playwright e2e

Full flow: email OTP → register passkey → sign-out → sign-in with
passkey, against a live hono-app with a Chromium WebAuthn virtual
authenticator."
```

---

## Phase F — Wrap-up (Task 17)

### Task 17: Full suite green, completion notes, memory update

Final verification + handoff artifacts for Phase 3.

**Files:**
- Create: `Passkey/docs/superpowers/notes/2026-05-04-phase-2-completion.md`
- Modify: `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/passkey-sdk-phase-1.md` (rename or supersede)
- Modify: `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/MEMORY.md` (point to Phase 2)

- [ ] **Step 1: Run the full suite from the repo root**

Run from `Passkey/`:

```bash
pnpm install   # idempotent
pnpm typecheck
pnpm build
pnpm test
pnpm --filter hono-app-example test
pnpm --filter web-demo-example test
```

Expected: all green. If anything fails, fix the underlying issue and re-run before proceeding. Do not skip any failing test.

- [ ] **Step 2: Write Phase 2 completion notes**

Create `Passkey/docs/superpowers/notes/2026-05-04-phase-2-completion.md`. Include:

- Status: Phase 2 shipped, branch `main` clean.
- What's in: `@mattsmith/passkey-sdk-client-web` (full public API), CSRF middleware, cookie Max-Age fix, web-demo example, Playwright e2e.
- Test inventory by suite, total counts.
- Any deviations from the design spec (e.g. if the proxy fallback was needed, if RP-ID changed from `127.0.0.1` to something else, if any test was skipped).
- Public API surface as actually shipped (mirror the design spec's API section but reflect reality).
- How to run things (build, test, dev server, e2e).
- Open items for v0.1+ or Phase 3:
  - Multi-process passkey challenge store (Phase 1 deferred).
  - Transports backfill at registration (Phase 1 deferred).
  - Shared cross-platform contract conformance suite (Phase 3, when Swift client lands).
  - React/Vue adapters (Phase 4+).
  - Postgres / Express adapters (later).
- Files Phase 3 should read first:
  1. `spec/protocol.md`
  2. `docs/superpowers/specs/2026-05-04-passkey-sdk-phase-2-web-client-design.md`
  3. `packages/client-web/src/index.ts`
  4. `packages/client-web/src/webauthn.ts` (the codec + wrapper map directly to ASAuthorizationServices types)
  5. `examples/hono-app/src/index.ts`

- [ ] **Step 3: Commit the completion notes**

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
git add docs/superpowers/notes/2026-05-04-phase-2-completion.md
git commit -m "docs: phase-2 completion notes for handoff to phase 3"
```

- [ ] **Step 4: Update project memory**

Edit `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/passkey-sdk-phase-1.md` — rename in spirit (replace contents) to reflect Phase 2 status:

Replace the file's contents with:

```markdown
---
name: Passkey SDK Phase 2 status
description: Phase 2 (web client + cookie-mode CSRF/Max-Age fixes) of the Passkey SDK shipped 2026-05-04; pointers to the contract doc, completion notes, and Phase 3 (Swift) entry point
type: project
---
The Passkey SDK at `/Users/mattsmith/Documents/Dev/SDKs/Passkey` shipped Phase 2 on 2026-05-04. The web client (`@mattsmith/passkey-sdk-client-web`), CSRF middleware in the Hono adapter, cookie Max-Age threading, and `examples/web-demo` (Vite + Playwright virtual-authenticator e2e) are on `main` with a clean tree.

**Why:** Phase 1 = TS server. Phase 2 = JS/TS web client + cookie-mode prerequisites. Phase 3 = Swift/iOS client (separate plan, to be written next). All clients share the contract at `Passkey/spec/protocol.md`.

**How to apply:** Before starting Phase 3 work, read these in order (paths relative to `/Users/mattsmith/Documents/Dev/SDKs/`):
1. `Passkey/docs/superpowers/notes/2026-05-04-phase-2-completion.md` — Phase 2 handoff doc with deviations, gotchas, and what's already exercised end-to-end
2. `Passkey/docs/superpowers/notes/2026-05-04-phase-1-completion.md` — Phase 1 handoff (still relevant: server deviations, requireSession `email: ""`, etc.)
3. `Passkey/spec/protocol.md` — the durable HTTP contract (now includes CSRF, csrf_required, invalid_request)
4. `Passkey/packages/client-web/src/webauthn.ts` — the base64url codec + ceremony wrapper; Swift's `AuthenticationServices` mapping mirrors this 1:1
5. `Passkey/docs/superpowers/specs/2026-05-03-passkey-sdk-design.md` — original cross-platform design (RP-ID/origins reasoning still load-bearing)

**Workflow:** Working directly on `main` is the convention (single-dev personal repo, user authorized). Apply the same pattern unless told otherwise.
```

Save the file.

- [ ] **Step 5: Update `MEMORY.md` index entry**

Edit `/Users/mattsmith/.claude/projects/-Users-mattsmith-Documents-Dev-SDKs/memory/MEMORY.md`. Replace the existing line:

```markdown
- [Passkey SDK Phase 1 status](passkey-sdk-phase-1.md) — Phase 1 server shipped 2026-05-04; read completion notes before starting Phase 2
```

with:

```markdown
- [Passkey SDK Phase 2 status](passkey-sdk-phase-1.md) — Phase 2 web client + cookie-mode prereqs shipped 2026-05-04; read completion notes before starting Phase 3 (Swift)
```

(Filename stays `passkey-sdk-phase-1.md` to keep links stable; the title in the index reflects the current state.)

- [ ] **Step 6: Final verification**

Run from `Passkey/`:

```bash
pnpm test && pnpm --filter hono-app-example test && pnpm --filter web-demo-example test
```

Expected: all green.

Run: `git status --short`
Expected: clean working tree.

Run: `git log --oneline -20`
Expected: ~17 commits added since `e55c515` (Phase 1 completion notes), one per task plus a final completion-notes commit.

- [ ] **Step 7: Done**

Phase 2 is complete. Project memory points Phase 3 (Swift client) at the right artifacts.

---

## Self-Review (executed during plan write)

**Spec coverage:**

| Spec section | Implemented in |
|---|---|
| Scope: web client + CSRF + Max-Age | Tasks 1, 2, 3, 5–13 |
| Repo additions: client-web package | Tasks 5, 6, 7, 8, 9, 10, 11, 12, 13 |
| Touched: hono CSRF + Max-Age | Tasks 1, 2, 3 |
| Touched: spec/protocol.md | Task 4 |
| New: examples/web-demo | Tasks 14, 15, 16 |
| Public API (8 methods) | Tasks 11, 12, 13 |
| Storage modes (cookie/header) | Task 9, integrated in 11 |
| CSRF double-submit (server + client) | Tasks 2, 3, 10 |
| WebAuthn wrapper + base64url codec | Tasks 7, 8 |
| Error mapping (all codes) | Tasks 6, 10 |
| Server v0.1 fixes | Tasks 1, 2, 3 |
| Spec error code additions | Task 4 |
| Testing: ~50 client tests | Tasks 6–13 |
| Playwright e2e with virtual authenticator | Task 16 |
| Hono CSRF coverage in routes test | Task 3 |
| Test-only OTP-peek endpoint | Task 14 |
| Acceptance: completion notes + memory update | Task 17 |

All spec sections have a corresponding task.

**Placeholder scan:** None of "TBD", "TODO", "implement later", "Add appropriate error handling", "similar to Task N" appear anywhere in the plan. Code blocks are present in every step that mutates code. The one bit of conditional language is in Task 16 Step 4 ("If the test fails because of cross-origin cookies, switch to a Vite proxy") — this is a documented contingency with a complete fallback recipe, not a placeholder.

**Type consistency:** `AuthClient` interface is defined in Task 11 and extended (not redefined) in Tasks 12 and 13. Method names match across all tasks: `startEmailSignIn`, `verifyEmailOtp`, `registerPasskey`, `signInWithPasskey`, `getCurrentUser`, `signOut`, `listSessions`, `listPasskeys`, `deletePasskey`. `AuthClientErrorCode` defined in Task 6 is the only error code source. `SessionStorage` interface defined in Task 9 has `load`/`save`/`clear`/`attachToRequest`/`includeCredentials` and is consumed in Task 10 with the same shape. `bufferToBase64url`/`base64urlToBuffer` from Task 7 are imported by Task 8 and Task 12 tests with consistent names.
