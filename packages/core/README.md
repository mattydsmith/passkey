# @mattsmith/passkey-sdk-core

Pure-TS server core for the Passkey SDK. Email OTP + WebAuthn ceremonies + sessions, backed by SQLite via `better-sqlite3`. Knows nothing about HTTP — that lives in the framework adapter packages (`@mattsmith/passkey-sdk-hono`).

The HTTP contract this enables is documented in [`../../spec/protocol.md`](../../spec/protocol.md).

## Install

```bash
pnpm add @mattsmith/passkey-sdk-core better-sqlite3
```

`better-sqlite3` is a peer dep.

## Usage

```ts
import Database from "better-sqlite3";
import { createAuth, runMigrations } from "@mattsmith/passkey-sdk-core";

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
      // Project owns the users table. Return a user_id (string).
    },
  },
}, { db });

// Use auth.{startEmailOtp, verifyEmailOtp, beginPasskeyRegistration,
// finishPasskeyRegistration, beginPasskeySignIn, finishPasskeySignIn,
// requireSession, signOut, listSessions, listPasskeys, removePasskey,
// appleAppSiteAssociation, cleanup}.
```

For an HTTP server you almost certainly want the Hono adapter — see [`../hono`](../hono).

## What it owns

Three SQLite tables: `auth_passkeys`, `auth_sessions`, `auth_email_otps`. The project's own users table is untouched; the SDK only references `user_id` strings supplied by the `findOrCreateByEmail` hook.

## Tests

```bash
pnpm --filter @mattsmith/passkey-sdk-core test
```

In-memory SQLite, integration-style coverage of every public method.
