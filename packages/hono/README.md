# @mattsmith/passkey-sdk-hono

Hono adapter for the Passkey SDK. Mounts `/auth/*` routes, issues session + CSRF cookies, validates CSRF on non-GET requests in cookie mode, and adds `Secure` to cookies on HTTPS.

The HTTP contract is documented in [`../../spec/protocol.md`](../../spec/protocol.md).

## Install

```bash
pnpm add @mattsmith/passkey-sdk-hono @mattsmith/passkey-sdk-core hono
```

`hono` is a peer dep.

## Usage

```ts
import { Hono } from "hono";
import { createAuth, runMigrations } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "@mattsmith/passkey-sdk-hono";
import Database from "better-sqlite3";

const db = new Database("./app.db");
runMigrations(db);

const auth = createAuth({ /* see core README */ }, { db });

const app = new Hono();
mountAuthRoutes(app, auth);   // mounts /auth/* with CSRF default-on

// Your own routes can use auth.requireSession:
app.get("/api/me", async (c) => {
  const user = await auth.requireSession(c.req.raw, { cookieName: "session" });
  return c.json({ user });
});
```

## Mount options

```ts
mountAuthRoutes(app, auth, {
  prefix: "/auth",          // default: "/auth"
  csrf: true,               // default: true when auth.config.session.cookieName is set
  csrfCookieName: "csrf",   // default: "csrf"
});
```

CSRF is opt-out via `{ csrf: false }` — useful behind a CSRF-handling gateway, or in pure bearer-token deployments without a session cookie.

## Cookie behavior

- `session` cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=lifetimeSeconds`. Adds `Secure` on HTTPS (detected via `X-Forwarded-Proto: https` or an `https://` request URL).
- `csrf` cookie: same as session minus `HttpOnly` (the client must read it). Issued alongside `session` on session-issuing endpoints. Cleared on sign-out.

## Tests

```bash
pnpm --filter @mattsmith/passkey-sdk-hono test
```

HTTP-level tests via `app.request(...)` — covers every route plus CSRF integration cases.
