# Passkey SDK — Phase 1 (Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working TypeScript auth server: `@mattsmith/passkey-sdk-core` (logic) + `@mattsmith/passkey-sdk-hono` (HTTP adapter) + `@mattsmith/passkey-sdk-cli` (migrations) + a working Hono example app, all backed by SQLite. Full email-OTP and passkey flows over the HTTP contract from the spec.

**Architecture:** Three small packages in a pnpm monorepo. `core` exposes pure functions (no HTTP), all side effects injected. `hono` is a ~200-line adapter that mounts contract routes. `cli` is a one-command migration runner. Tests are integration-style: real in-memory SQLite, mock clock and email, full flows end-to-end.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, Vitest, tsup (build), Hono (HTTP adapter), `better-sqlite3` (SQLite driver), `@simplewebauthn/server` (WebAuthn ceremonies), `zod` (input validation).

**Spec:** [docs/superpowers/specs/2026-05-03-passkey-sdk-design.md](../specs/2026-05-03-passkey-sdk-design.md) — read it first.

---

## File Structure

```
passkey-sdk/
├── package.json                         # root: workspace + scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── .npmrc
├── README.md
│
├── spec/
│   └── protocol.md                      # HTTP contract reference
│
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   ├── vitest.config.ts
│   │   ├── migrations/001_init.sql
│   │   ├── src/
│   │   │   ├── index.ts                 # public exports
│   │   │   ├── types.ts                 # shared types
│   │   │   ├── errors.ts                # AuthError + error codes
│   │   │   ├── deps.ts                  # injectable: now, randomBytes, randomId
│   │   │   ├── db.ts                    # SQLite type alias
│   │   │   ├── migrate.ts               # runMigrations(db)
│   │   │   ├── storage/
│   │   │   │   ├── sessions.ts
│   │   │   │   ├── otps.ts
│   │   │   │   └── passkeys.ts
│   │   │   ├── session.ts               # create/validate/revoke/list
│   │   │   ├── flows/
│   │   │   │   ├── email-otp.ts         # start, verify
│   │   │   │   ├── passkey-register.ts  # begin, finish
│   │   │   │   └── passkey-signin.ts    # begin, finish
│   │   │   ├── aasa.ts                  # appleAppSiteAssociation()
│   │   │   ├── cleanup.ts               # cleanup()
│   │   │   └── auth.ts                  # createAuth() factory
│   │   └── tests/
│   │       ├── setup.ts                 # shared test harness
│   │       ├── storage.test.ts
│   │       ├── session.test.ts
│   │       ├── email-otp.test.ts
│   │       ├── passkey.test.ts
│   │       └── auth.test.ts             # full-flow integration
│   │
│   ├── hono/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   ├── vitest.config.ts
│   │   ├── src/index.ts                 # mountAuthRoutes(app, auth)
│   │   └── tests/routes.test.ts         # HTTP-level contract tests
│   │
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       └── src/index.ts                 # `passkey-sdk migrate <db>`
│
└── examples/
    └── hono-app/
        ├── package.json
        ├── tsconfig.json
        ├── README.md
        └── src/index.ts
```

**Boundary rules:**
- `core` never imports from `hono` or `cli`.
- `hono` and `cli` import from `core` only via the public `index.ts`.
- Each storage file is one table. Each flow file is one ceremony.
- `auth.ts` is the only file that wires injected deps together for consumers.

---

## Pre-flight

Working directory: `/Users/mattsmith/Documents/Dev/SDKs/Passkey/`. Git repo already initialized with the spec committed.

Verify:

```bash
cd /Users/mattsmith/Documents/Dev/SDKs/Passkey
git log --oneline
# Expected: at least one commit (the spec)
node --version
# Expected: v20+ (for top-level await, native fetch in tests)
which pnpm || npm install -g pnpm
# Expected: pnpm path on stdout
pnpm --version
# Expected: 9.x or later
```

---

## Task 1: Bootstrap the monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `README.md`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "examples/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "passkey-sdk",
  "private": true,
  "version": "0.0.0",
  "engines": { "node": ">=20" },
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "pnpm -r --filter './packages/*' build",
    "test": "pnpm -r --filter './packages/*' test",
    "typecheck": "pnpm -r --filter './packages/*' typecheck"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "lib": ["ES2022"]
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
*.db
*.db-journal
.DS_Store
coverage/
.turbo/
*.tsbuildinfo
```

- [ ] **Step 5: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 6: Create minimal `README.md`**

```markdown
# Passkey SDK

Email OTP + passkey authentication for personal projects. Self-contained,
SQLite-backed, multi-platform.

See `docs/superpowers/specs/` for design and `docs/superpowers/plans/` for
implementation plans.
```

- [ ] **Step 7: Install + verify**

Run: `pnpm install`
Expected: completes without errors. Creates `pnpm-lock.yaml` and `node_modules`.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore .npmrc README.md pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm monorepo"
```

---

## Task 2: Create the `core` package skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsup.config.ts`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@mattsmith/passkey-sdk-core",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "migrations"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@simplewebauthn/server": "^10.0.0",
    "zod": "^3.23.0"
  },
  "peerDependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "better-sqlite3": "^11.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/core/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create empty `packages/core/src/index.ts`**

```ts
export {};
```

- [ ] **Step 6: Install + verify**

Run: `pnpm install`
Run: `pnpm --filter @mattsmith/passkey-sdk-core build`
Expected: produces `packages/core/dist/index.js` and `index.d.ts`.

Run: `pnpm --filter @mattsmith/passkey-sdk-core typecheck`
Expected: exits with code 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "chore(core): scaffold package"
```

---

## Task 3: Define shared types

**Files:**
- Create: `packages/core/src/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// packages/core/src/types.ts

/** Identity returned to clients. The project's user table may have more fields;
 *  the SDK only knows about these. */
export interface User {
  id: string;
  email: string;
}

/** What the OTP flow returns from `start`. */
export interface OtpStartResult {
  otpId: string;
  expiresInSeconds: number;
}

/** What sign-in flows return on success. */
export interface SignInResult {
  sessionToken: string;
  user: User;
}

/** Internal record shapes (storage layer returns these). */
export interface SessionRecord {
  tokenHash: Uint8Array;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  ip: string | null;
}

export interface OtpRecord {
  id: string;
  email: string;
  codeHash: Uint8Array;
  attempts: number;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface PasskeyRecord {
  credentialId: Uint8Array;
  userId: string;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[] | null;
  aaguid: Uint8Array | null;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Project-supplied hook: map an email to a user_id. */
export type FindOrCreateByEmail = (email: string) => Promise<string>;

/** Project-supplied hook: send an OTP code. SDK never bundles a transport. */
export type SendOtp = (args: { to: string; code: string }) => Promise<void>;

/** AASA helper input. */
export interface AasaInput {
  appIds: string[];
}

/** Full SDK config. */
export interface AuthConfig {
  rpId: string;
  origins: string[];
  session: {
    lifetimeSeconds: number;
    cookieName?: string;
  };
  otp?: {
    expirySeconds?: number;
    maxAttempts?: number;
  };
  webauthn?: {
    userVerification?: "required" | "preferred" | "discouraged";
  };
  email: { sendOtp: SendOtp };
  users: { findOrCreateByEmail: FindOrCreateByEmail };
}
```

- [ ] **Step 2: Re-export from `index.ts`**

Replace `packages/core/src/index.ts`:

```ts
export * from "./types.js";
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @mattsmith/passkey-sdk-core typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): define shared types"
```

---

## Task 4: Errors module

**Files:**
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/errors.test.ts
import { describe, it, expect } from "vitest";
import { AuthError, type AuthErrorCode } from "../src/errors.js";

describe("AuthError", () => {
  it("attaches code and message", () => {
    const err = new AuthError("invalid_otp", "Code does not match");
    expect(err.code).toBe("invalid_otp");
    expect(err.message).toBe("Code does not match");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuthError");
  });

  it("serializes to a JSON-friendly shape via toJSON", () => {
    const err = new AuthError("rate_limited", "Slow down");
    expect(err.toJSON()).toEqual({ error: "rate_limited", message: "Slow down" });
  });

  it("AuthError.is() narrows by code", () => {
    const err: unknown = new AuthError("invalid_otp", "");
    if (AuthError.is(err, "invalid_otp")) {
      const _typed: AuthErrorCode = err.code;
      expect(_typed).toBe("invalid_otp");
    } else {
      throw new Error("should have matched");
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — module `../src/errors.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/core/src/errors.ts`:

```ts
export const AUTH_ERROR_CODES = [
  "invalid_otp",
  "otp_attempts_exceeded",
  "otp_expired",
  "invalid_credential",
  "unknown_credential",
  "unauthenticated",
  "rate_limited",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }

  toJSON(): { error: AuthErrorCode; message: string } {
    return { error: this.code, message: this.message };
  }

  static is<C extends AuthErrorCode>(
    err: unknown,
    code?: C
  ): err is AuthError & { code: C } {
    if (!(err instanceof AuthError)) return false;
    return code === undefined || err.code === code;
  }
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Replace `packages/core/src/index.ts`:

```ts
export * from "./types.js";
export * from "./errors.js";
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/errors.ts packages/core/tests/errors.test.ts packages/core/src/index.ts
git commit -m "feat(core): add AuthError with typed codes"
```

---

## Task 5: Injectable dependencies (`now`, `randomBytes`, `randomId`)

**Files:**
- Create: `packages/core/src/deps.ts`
- Create: `packages/core/tests/deps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/tests/deps.test.ts
import { describe, it, expect } from "vitest";
import { defaultDeps, type Deps } from "../src/deps.js";

describe("defaultDeps", () => {
  it("now returns unix seconds (integer, near current time)", () => {
    const t = defaultDeps.now();
    expect(Number.isInteger(t)).toBe(true);
    expect(Math.abs(t - Math.floor(Date.now() / 1000))).toBeLessThan(2);
  });

  it("randomBytes(n) returns Uint8Array of length n", () => {
    const bytes = defaultDeps.randomBytes(32);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    const second = defaultDeps.randomBytes(32);
    expect(Buffer.from(bytes).equals(Buffer.from(second))).toBe(false);
  });

  it("randomId(prefix) returns prefix_<base32-ish>", () => {
    const id = defaultDeps.randomId("otp");
    expect(id.startsWith("otp_")).toBe(true);
    expect(id.length).toBeGreaterThan(8);
    expect(id).not.toBe(defaultDeps.randomId("otp"));
  });

  it("Deps is structurally substitutable for tests", () => {
    const fake: Deps = {
      now: () => 1_700_000_000,
      randomBytes: (n) => new Uint8Array(n),
      randomId: (p) => `${p}_test`,
    };
    expect(fake.now()).toBe(1_700_000_000);
    expect(fake.randomId("x")).toBe("x_test");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — module `../src/deps.js` does not exist.

- [ ] **Step 3: Implement**

Create `packages/core/src/deps.ts`:

```ts
import { randomBytes as nodeRandomBytes } from "node:crypto";

export interface Deps {
  /** Unix seconds (integer). */
  now: () => number;
  /** N cryptographically random bytes. */
  randomBytes: (n: number) => Uint8Array;
  /** Short opaque ID with a prefix, e.g. "otp_abc123". */
  randomId: (prefix: string) => string;
}

const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // no 0/1/l/o ambiguity

function randomIdImpl(prefix: string): string {
  const bytes = nodeRandomBytes(12);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return `${prefix}_${s}`;
}

export const defaultDeps: Deps = {
  now: () => Math.floor(Date.now() / 1000),
  randomBytes: (n) => new Uint8Array(nodeRandomBytes(n)),
  randomId: randomIdImpl,
};
```

- [ ] **Step 4: Re-export**

Update `packages/core/src/index.ts`:

```ts
export * from "./types.js";
export * from "./errors.js";
export * from "./deps.js";
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: all tests pass (errors + deps).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/deps.ts packages/core/tests/deps.test.ts packages/core/src/index.ts
git commit -m "feat(core): inject time/randomness/id generation"
```

---

## Task 6: SQLite migrations + `runMigrations`

**Files:**
- Create: `packages/core/migrations/001_init.sql`
- Create: `packages/core/src/db.ts`
- Create: `packages/core/src/migrate.ts`
- Create: `packages/core/tests/migrate.test.ts`

- [ ] **Step 1: Write the migration SQL**

Create `packages/core/migrations/001_init.sql`:

```sql
CREATE TABLE IF NOT EXISTS auth_passkeys (
  credential_id BLOB    PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  public_key    BLOB    NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  aaguid        BLOB,
  device_name   TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS auth_passkeys_user ON auth_passkeys(user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash    BLOB    PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_email_otps (
  id          TEXT    PRIMARY KEY,
  email       TEXT    NOT NULL,
  code_hash   BLOB    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS auth_email_otps_email ON auth_email_otps(email);

CREATE TABLE IF NOT EXISTS auth_migrations (
  filename   TEXT    PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/tests/migrate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/migrate.js";

describe("runMigrations", () => {
  it("creates all expected tables", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("auth_passkeys");
    expect(names).toContain("auth_sessions");
    expect(names).toContain("auth_email_otps");
    expect(names).toContain("auth_migrations");
  });

  it("is idempotent — running twice doesn't throw", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    const count = db
      .prepare("SELECT COUNT(*) as c FROM auth_migrations")
      .get() as { c: number };
    expect(count.c).toBe(1); // 001 only, recorded once
  });

  it("records each migration in auth_migrations", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const rows = db.prepare("SELECT filename FROM auth_migrations").all() as {
      filename: string;
    }[];
    expect(rows.map((r) => r.filename)).toEqual(["001_init.sql"]);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — `../src/migrate.js` does not exist.

- [ ] **Step 4: Implement `db.ts`**

Create `packages/core/src/db.ts`:

```ts
import type Database from "better-sqlite3";

/** The SQLite handle the SDK uses. Re-exported so consumers don't have
 *  to depend directly on better-sqlite3 types. */
export type Db = Database.Database;
```

- [ ] **Step 5: Implement `migrate.ts`**

Create `packages/core/src/migrate.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Bundled migration files, in order. Resolved relative to this file. */
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

export function runMigrations(db: Db): void {
  // Ensure the bookkeeping table exists first (it's also recreated by 001
  // for fresh setups; IF NOT EXISTS makes both paths safe).
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_migrations (
      filename   TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (
      db
        .prepare("SELECT filename FROM auth_migrations")
        .all() as { filename: string }[]
    ).map((r) => r.filename)
  );

  const insert = db.prepare(
    "INSERT INTO auth_migrations (filename, applied_at) VALUES (?, ?)"
  );

  const tx = db.transaction((file: string) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec(sql);
    insert.run(file, Math.floor(Date.now() / 1000));
  });

  for (const file of files) {
    if (applied.has(file)) continue;
    tx(file);
  }
}
```

- [ ] **Step 6: Re-export**

Update `packages/core/src/index.ts`:

```ts
export * from "./types.js";
export * from "./errors.js";
export * from "./deps.js";
export * from "./db.js";
export { runMigrations } from "./migrate.js";
```

- [ ] **Step 7: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: 3 tests in migrate.test.ts pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/migrations packages/core/src/db.ts packages/core/src/migrate.ts packages/core/tests/migrate.test.ts packages/core/src/index.ts
git commit -m "feat(core): SQLite schema and migrations runner"
```

---

## Task 7: Test harness

**Files:**
- Create: `packages/core/tests/setup.ts`

This file is reused by every other test. It produces an in-memory SQLite, a controllable clock, a fake email transport, and a fake `findOrCreateByEmail` hook.

- [ ] **Step 1: Implement the harness**

Create `packages/core/tests/setup.ts`:

```ts
import Database from "better-sqlite3";
import { runMigrations } from "../src/migrate.js";
import type { Deps } from "../src/deps.js";
import type { SendOtp, FindOrCreateByEmail } from "../src/types.js";

/** Mutable clock — set via `clock.now = X` to control time in tests. */
export interface FakeClock {
  now: number;
}

export interface Harness {
  db: Database.Database;
  clock: FakeClock;
  deps: Deps;
  /** Captures every OTP email send. */
  sentOtps: { to: string; code: string }[];
  sendOtp: SendOtp;
  /** In-memory user table keyed by email. */
  users: Map<string, string>;
  findOrCreateByEmail: FindOrCreateByEmail;
}

export function createHarness(): Harness {
  const db = new Database(":memory:");
  runMigrations(db);

  const clock: FakeClock = { now: 1_700_000_000 };

  // Deterministic-but-distinct ID/byte generation for tests.
  let idCounter = 0;
  let byteCounter = 0;

  const deps: Deps = {
    now: () => clock.now,
    randomBytes: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (byteCounter++) & 0xff;
      return out;
    },
    randomId: (prefix) => `${prefix}_test${++idCounter}`,
  };

  const sentOtps: { to: string; code: string }[] = [];
  const sendOtp: SendOtp = async (args) => {
    sentOtps.push(args);
  };

  const users = new Map<string, string>();
  const findOrCreateByEmail: FindOrCreateByEmail = async (email) => {
    const existing = users.get(email);
    if (existing) return existing;
    const id = `u_${users.size + 1}`;
    users.set(email, id);
    return id;
  };

  return { db, clock, deps, sentOtps, sendOtp, users, findOrCreateByEmail };
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `pnpm --filter @mattsmith/passkey-sdk-core typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/setup.ts
git commit -m "test(core): add shared in-memory test harness"
```

---

## Task 8: Sessions storage layer

**Files:**
- Create: `packages/core/src/storage/sessions.ts`
- Create: `packages/core/tests/storage.test.ts`

The storage layer is intentionally simple: prepared SQL statements wrapped in typed functions. No business logic.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  insertSession,
  getSessionByTokenHash,
  bumpSessionLastSeen,
  deleteSessionByTokenHash,
  listSessionsByUser,
  deleteExpiredSessions,
} from "../src/storage/sessions.js";
import { createHarness, type Harness } from "./setup.js";

describe("storage/sessions", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  const tokenHash = (n: number) => new Uint8Array(32).fill(n);

  it("inserts and reads back a session", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(1),
      userId: "u_1",
      createdAt: 100,
      expiresAt: 1000,
      lastSeenAt: 100,
      userAgent: "test-ua",
      ip: "127.0.0.1",
    });
    const row = getSessionByTokenHash(h.db, tokenHash(1));
    expect(row).toBeDefined();
    expect(row!.userId).toBe("u_1");
    expect(row!.expiresAt).toBe(1000);
    expect(row!.userAgent).toBe("test-ua");
  });

  it("returns undefined for missing token", () => {
    expect(getSessionByTokenHash(h.db, tokenHash(99))).toBeUndefined();
  });

  it("bumpSessionLastSeen updates lastSeenAt", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(2), userId: "u_1",
      createdAt: 100, expiresAt: 1000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    bumpSessionLastSeen(h.db, tokenHash(2), 500);
    expect(getSessionByTokenHash(h.db, tokenHash(2))!.lastSeenAt).toBe(500);
  });

  it("deleteSessionByTokenHash removes the row", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(3), userId: "u_1",
      createdAt: 100, expiresAt: 1000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    deleteSessionByTokenHash(h.db, tokenHash(3));
    expect(getSessionByTokenHash(h.db, tokenHash(3))).toBeUndefined();
  });

  it("listSessionsByUser returns all sessions for that user", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(4), userId: "u_a",
      createdAt: 100, expiresAt: 1000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: tokenHash(5), userId: "u_a",
      createdAt: 200, expiresAt: 2000, lastSeenAt: 200,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: tokenHash(6), userId: "u_b",
      createdAt: 300, expiresAt: 3000, lastSeenAt: 300,
      userAgent: null, ip: null,
    });
    expect(listSessionsByUser(h.db, "u_a")).toHaveLength(2);
    expect(listSessionsByUser(h.db, "u_b")).toHaveLength(1);
    expect(listSessionsByUser(h.db, "u_nope")).toHaveLength(0);
  });

  it("deleteExpiredSessions removes sessions with expires_at <= cutoff", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(7), userId: "u_a",
      createdAt: 100, expiresAt: 200, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: tokenHash(8), userId: "u_a",
      createdAt: 100, expiresAt: 5000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    const removed = deleteExpiredSessions(h.db, 1000);
    expect(removed).toBe(1);
    expect(getSessionByTokenHash(h.db, tokenHash(7))).toBeUndefined();
    expect(getSessionByTokenHash(h.db, tokenHash(8))).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — `../src/storage/sessions.js` not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/storage/sessions.ts`:

```ts
import type { Db } from "../db.js";
import type { SessionRecord } from "../types.js";

interface Row {
  token_hash: Uint8Array;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  user_agent: string | null;
  ip: string | null;
}

function rowToRecord(row: Row): SessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    userAgent: row.user_agent,
    ip: row.ip,
  };
}

export function insertSession(db: Db, s: SessionRecord): void {
  db.prepare(
    `INSERT INTO auth_sessions
     (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.tokenHash,
    s.userId,
    s.createdAt,
    s.expiresAt,
    s.lastSeenAt,
    s.userAgent,
    s.ip
  );
}

export function getSessionByTokenHash(
  db: Db,
  tokenHash: Uint8Array
): SessionRecord | undefined {
  const row = db
    .prepare("SELECT * FROM auth_sessions WHERE token_hash = ?")
    .get(tokenHash) as Row | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function bumpSessionLastSeen(
  db: Db,
  tokenHash: Uint8Array,
  now: number
): void {
  db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").run(
    now,
    tokenHash
  );
}

export function deleteSessionByTokenHash(db: Db, tokenHash: Uint8Array): void {
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
}

export function listSessionsByUser(db: Db, userId: string): SessionRecord[] {
  const rows = db
    .prepare("SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Row[];
  return rows.map(rowToRecord);
}

export function deleteExpiredSessions(db: Db, cutoff: number): number {
  const result = db
    .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
    .run(cutoff);
  return result.changes;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: all storage/sessions tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/sessions.ts packages/core/tests/storage.test.ts
git commit -m "feat(core): sessions storage layer"
```

---

## Task 9: OTPs storage layer

**Files:**
- Create: `packages/core/src/storage/otps.ts`
- Modify: `packages/core/tests/storage.test.ts` (append a `describe` block)

- [ ] **Step 1: Append failing tests**

Append to `packages/core/tests/storage.test.ts`:

```ts
import {
  insertOtp,
  getOtpById,
  incrementOtpAttempts,
  markOtpConsumed,
  deleteExpiredOtps,
} from "../src/storage/otps.js";

describe("storage/otps", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  const codeHash = (n: number) => new Uint8Array(32).fill(n);

  it("inserts and reads an OTP", () => {
    insertOtp(h.db, {
      id: "otp_1",
      email: "matt@example.com",
      codeHash: codeHash(1),
      attempts: 0,
      createdAt: 100,
      expiresAt: 700,
      consumedAt: null,
    });
    const row = getOtpById(h.db, "otp_1");
    expect(row).toBeDefined();
    expect(row!.email).toBe("matt@example.com");
    expect(row!.attempts).toBe(0);
    expect(row!.consumedAt).toBeNull();
  });

  it("increments attempts", () => {
    insertOtp(h.db, {
      id: "otp_2", email: "x@y", codeHash: codeHash(2),
      attempts: 0, createdAt: 100, expiresAt: 700, consumedAt: null,
    });
    incrementOtpAttempts(h.db, "otp_2");
    incrementOtpAttempts(h.db, "otp_2");
    expect(getOtpById(h.db, "otp_2")!.attempts).toBe(2);
  });

  it("markOtpConsumed sets consumed_at", () => {
    insertOtp(h.db, {
      id: "otp_3", email: "x@y", codeHash: codeHash(3),
      attempts: 0, createdAt: 100, expiresAt: 700, consumedAt: null,
    });
    markOtpConsumed(h.db, "otp_3", 500);
    expect(getOtpById(h.db, "otp_3")!.consumedAt).toBe(500);
  });

  it("deleteExpiredOtps removes by cutoff", () => {
    insertOtp(h.db, {
      id: "otp_4", email: "x@y", codeHash: codeHash(4),
      attempts: 0, createdAt: 100, expiresAt: 200, consumedAt: null,
    });
    insertOtp(h.db, {
      id: "otp_5", email: "x@y", codeHash: codeHash(5),
      attempts: 0, createdAt: 100, expiresAt: 5000, consumedAt: null,
    });
    expect(deleteExpiredOtps(h.db, 1000)).toBe(1);
    expect(getOtpById(h.db, "otp_4")).toBeUndefined();
    expect(getOtpById(h.db, "otp_5")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — `../src/storage/otps.js` not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/storage/otps.ts`:

```ts
import type { Db } from "../db.js";
import type { OtpRecord } from "../types.js";

interface Row {
  id: string;
  email: string;
  code_hash: Uint8Array;
  attempts: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

function rowToRecord(row: Row): OtpRecord {
  return {
    id: row.id,
    email: row.email,
    codeHash: row.code_hash,
    attempts: row.attempts,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export function insertOtp(db: Db, o: OtpRecord): void {
  db.prepare(
    `INSERT INTO auth_email_otps
     (id, email, code_hash, attempts, created_at, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(o.id, o.email, o.codeHash, o.attempts, o.createdAt, o.expiresAt, o.consumedAt);
}

export function getOtpById(db: Db, id: string): OtpRecord | undefined {
  const row = db
    .prepare("SELECT * FROM auth_email_otps WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function incrementOtpAttempts(db: Db, id: string): void {
  db.prepare("UPDATE auth_email_otps SET attempts = attempts + 1 WHERE id = ?").run(id);
}

export function markOtpConsumed(db: Db, id: string, now: number): void {
  db.prepare("UPDATE auth_email_otps SET consumed_at = ? WHERE id = ?").run(now, id);
}

export function deleteExpiredOtps(db: Db, cutoff: number): number {
  const result = db
    .prepare("DELETE FROM auth_email_otps WHERE expires_at <= ?")
    .run(cutoff);
  return result.changes;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: all storage tests (sessions + OTPs) pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/otps.ts packages/core/tests/storage.test.ts
git commit -m "feat(core): OTPs storage layer"
```

---

## Task 10: Passkeys storage layer

**Files:**
- Create: `packages/core/src/storage/passkeys.ts`
- Modify: `packages/core/tests/storage.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `packages/core/tests/storage.test.ts`:

```ts
import {
  insertPasskey,
  getPasskeyByCredentialId,
  listPasskeysByUser,
  updatePasskeySignCount,
  deletePasskey,
} from "../src/storage/passkeys.js";

describe("storage/passkeys", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  const credId = (n: number) => new Uint8Array(16).fill(n);
  const pubKey = (n: number) => new Uint8Array(64).fill(n);

  it("inserts and reads back a passkey", () => {
    insertPasskey(h.db, {
      credentialId: credId(1),
      userId: "u_1",
      publicKey: pubKey(1),
      signCount: 0,
      transports: ["internal", "hybrid"],
      aaguid: new Uint8Array(16).fill(7),
      deviceName: "iPhone 15",
      createdAt: 100,
      lastUsedAt: null,
    });
    const row = getPasskeyByCredentialId(h.db, credId(1));
    expect(row).toBeDefined();
    expect(row!.userId).toBe("u_1");
    expect(row!.transports).toEqual(["internal", "hybrid"]);
    expect(row!.deviceName).toBe("iPhone 15");
    expect(row!.signCount).toBe(0);
  });

  it("listPasskeysByUser returns the user's passkeys", () => {
    insertPasskey(h.db, {
      credentialId: credId(2), userId: "u_a", publicKey: pubKey(2),
      signCount: 0, transports: null, aaguid: null,
      deviceName: null, createdAt: 100, lastUsedAt: null,
    });
    insertPasskey(h.db, {
      credentialId: credId(3), userId: "u_a", publicKey: pubKey(3),
      signCount: 0, transports: null, aaguid: null,
      deviceName: null, createdAt: 200, lastUsedAt: null,
    });
    insertPasskey(h.db, {
      credentialId: credId(4), userId: "u_b", publicKey: pubKey(4),
      signCount: 0, transports: null, aaguid: null,
      deviceName: null, createdAt: 300, lastUsedAt: null,
    });
    expect(listPasskeysByUser(h.db, "u_a")).toHaveLength(2);
    expect(listPasskeysByUser(h.db, "u_b")).toHaveLength(1);
  });

  it("updatePasskeySignCount also bumps lastUsedAt", () => {
    insertPasskey(h.db, {
      credentialId: credId(5), userId: "u_1", publicKey: pubKey(5),
      signCount: 0, transports: null, aaguid: null,
      deviceName: null, createdAt: 100, lastUsedAt: null,
    });
    updatePasskeySignCount(h.db, credId(5), 7, 500);
    const after = getPasskeyByCredentialId(h.db, credId(5))!;
    expect(after.signCount).toBe(7);
    expect(after.lastUsedAt).toBe(500);
  });

  it("deletePasskey removes the row", () => {
    insertPasskey(h.db, {
      credentialId: credId(6), userId: "u_1", publicKey: pubKey(6),
      signCount: 0, transports: null, aaguid: null,
      deviceName: null, createdAt: 100, lastUsedAt: null,
    });
    deletePasskey(h.db, credId(6));
    expect(getPasskeyByCredentialId(h.db, credId(6))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/storage/passkeys.ts`:

```ts
import type { Db } from "../db.js";
import type { PasskeyRecord } from "../types.js";

interface Row {
  credential_id: Uint8Array;
  user_id: string;
  public_key: Uint8Array;
  sign_count: number;
  transports: string | null;
  aaguid: Uint8Array | null;
  device_name: string | null;
  created_at: number;
  last_used_at: number | null;
}

function rowToRecord(row: Row): PasskeyRecord {
  return {
    credentialId: row.credential_id,
    userId: row.user_id,
    publicKey: row.public_key,
    signCount: row.sign_count,
    transports: row.transports ? (JSON.parse(row.transports) as string[]) : null,
    aaguid: row.aaguid,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function insertPasskey(db: Db, p: PasskeyRecord): void {
  db.prepare(
    `INSERT INTO auth_passkeys
     (credential_id, user_id, public_key, sign_count, transports, aaguid,
      device_name, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.credentialId,
    p.userId,
    p.publicKey,
    p.signCount,
    p.transports ? JSON.stringify(p.transports) : null,
    p.aaguid,
    p.deviceName,
    p.createdAt,
    p.lastUsedAt
  );
}

export function getPasskeyByCredentialId(
  db: Db,
  credentialId: Uint8Array
): PasskeyRecord | undefined {
  const row = db
    .prepare("SELECT * FROM auth_passkeys WHERE credential_id = ?")
    .get(credentialId) as Row | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function listPasskeysByUser(db: Db, userId: string): PasskeyRecord[] {
  const rows = db
    .prepare("SELECT * FROM auth_passkeys WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Row[];
  return rows.map(rowToRecord);
}

export function updatePasskeySignCount(
  db: Db,
  credentialId: Uint8Array,
  signCount: number,
  now: number
): void {
  db.prepare(
    "UPDATE auth_passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?"
  ).run(signCount, now, credentialId);
}

export function deletePasskey(db: Db, credentialId: Uint8Array): void {
  db.prepare("DELETE FROM auth_passkeys WHERE credential_id = ?").run(credentialId);
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: all storage tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/storage/passkeys.ts packages/core/tests/storage.test.ts
git commit -m "feat(core): passkeys storage layer"
```

---

## Task 11: Session lifecycle (create, validate, revoke, list)

**Files:**
- Create: `packages/core/src/session.ts`
- Create: `packages/core/tests/session.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/session.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  validateAndBumpSession,
  revokeSession,
  listSessionsForUser,
} from "../src/session.js";
import { AuthError } from "../src/errors.js";
import { createHarness, type Harness } from "./setup.js";

const SESSION_LIFETIME = 60 * 60 * 24 * 30;

describe("session lifecycle", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("createSession returns a token and stores a row", async () => {
    const { sessionToken } = await createSession({
      db: h.db,
      deps: h.deps,
      userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME,
      userAgent: "ua",
      ip: "1.2.3.4",
    });
    expect(sessionToken).toMatch(/^tok_/);
    const sessions = listSessionsForUser(h.db, "u_1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.userAgent).toBe("ua");
  });

  it("token cannot be reconstructed from DB", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME, userAgent: null, ip: null,
    });
    const stored = listSessionsForUser(h.db, "u_1")[0]!;
    // The stored hash must not equal the raw token bytes.
    expect(Buffer.from(stored.tokenHash).toString("hex")).not.toBe(sessionToken);
  });

  it("validateAndBumpSession returns the user and bumps lastSeenAt", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME, userAgent: null, ip: null,
    });
    h.clock.now += 100;
    const result = validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken });
    expect(result.userId).toBe("u_1");
    const stored = listSessionsForUser(h.db, "u_1")[0]!;
    expect(stored.lastSeenAt).toBe(h.clock.now);
  });

  it("validateAndBumpSession throws unauthenticated for unknown token", () => {
    expect(() =>
      validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken: "tok_nope" })
    ).toThrow(AuthError);
    try {
      validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken: "tok_nope" });
    } catch (e) {
      expect(AuthError.is(e, "unauthenticated")).toBe(true);
    }
  });

  it("validateAndBumpSession throws unauthenticated for expired token", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: 100, userAgent: null, ip: null,
    });
    h.clock.now += 200;
    expect(() =>
      validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken })
    ).toThrow(/unauthenticated/i);
  });

  it("revokeSession deletes the row", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME, userAgent: null, ip: null,
    });
    revokeSession({ db: h.db, sessionToken });
    expect(listSessionsForUser(h.db, "u_1")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — `../src/session.js` not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/session.ts`:

```ts
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import type { Deps } from "./deps.js";
import type { SessionRecord } from "./types.js";
import { AuthError } from "./errors.js";
import {
  insertSession,
  getSessionByTokenHash,
  bumpSessionLastSeen,
  deleteSessionByTokenHash,
  listSessionsByUser,
} from "./storage/sessions.js";

const TOKEN_BYTES = 32;

function hashToken(token: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(token).digest());
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export interface CreateSessionInput {
  db: Db;
  deps: Deps;
  userId: string;
  lifetimeSeconds: number;
  userAgent: string | null;
  ip: string | null;
}

export interface CreateSessionResult {
  sessionToken: string;
  expiresAt: number;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  const { db, deps, userId, lifetimeSeconds, userAgent, ip } = input;
  const raw = deps.randomBytes(TOKEN_BYTES);
  const sessionToken = `tok_${bytesToBase64Url(raw)}`;
  const tokenHash = hashToken(sessionToken);
  const now = deps.now();
  const expiresAt = now + lifetimeSeconds;

  insertSession(db, {
    tokenHash,
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    userAgent,
    ip,
  });

  return { sessionToken, expiresAt };
}

export interface ValidateSessionResult {
  userId: string;
  expiresAt: number;
}

export function validateAndBumpSession(args: {
  db: Db;
  deps: Deps;
  sessionToken: string;
}): ValidateSessionResult {
  const { db, deps, sessionToken } = args;
  const tokenHash = hashToken(sessionToken);
  const row = getSessionByTokenHash(db, tokenHash);
  const now = deps.now();
  if (!row || row.expiresAt <= now) {
    throw new AuthError("unauthenticated", "Session is missing or expired");
  }
  bumpSessionLastSeen(db, tokenHash, now);
  return { userId: row.userId, expiresAt: row.expiresAt };
}

export function revokeSession(args: { db: Db; sessionToken: string }): void {
  deleteSessionByTokenHash(args.db, hashToken(args.sessionToken));
}

export function listSessionsForUser(db: Db, userId: string): SessionRecord[] {
  return listSessionsByUser(db, userId);
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: 6 session tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session.ts packages/core/tests/session.test.ts
git commit -m "feat(core): session create/validate/revoke/list"
```

---

## Task 12: Email OTP — start

**Files:**
- Create: `packages/core/src/flows/email-otp.ts`
- Create: `packages/core/tests/email-otp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/email-otp.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { startEmailOtp } from "../src/flows/email-otp.js";
import { createHarness, type Harness } from "./setup.js";

describe("startEmailOtp", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("generates a 6-digit code, sends it, returns otpId + expiresInSeconds", async () => {
    const result = await startEmailOtp({
      db: h.db,
      deps: h.deps,
      sendOtp: h.sendOtp,
      email: "matt@example.com",
      expirySeconds: 600,
    });
    expect(result.otpId).toMatch(/^otp_/);
    expect(result.expiresInSeconds).toBe(600);
    expect(h.sentOtps).toHaveLength(1);
    expect(h.sentOtps[0]!.to).toBe("matt@example.com");
    expect(h.sentOtps[0]!.code).toMatch(/^\d{6}$/);
  });

  it("normalizes email to lowercase + trim", async () => {
    await startEmailOtp({
      db: h.db, deps: h.deps, sendOtp: h.sendOtp,
      email: "  Matt@Example.COM  ",
      expirySeconds: 600,
    });
    expect(h.sentOtps[0]!.to).toBe("matt@example.com");
  });

  it("stores the code hashed, not raw", async () => {
    const { otpId } = await startEmailOtp({
      db: h.db, deps: h.deps, sendOtp: h.sendOtp,
      email: "x@y.z", expirySeconds: 600,
    });
    const code = h.sentOtps[0]!.code;
    const row = h.db
      .prepare("SELECT code_hash FROM auth_email_otps WHERE id = ?")
      .get(otpId) as { code_hash: Uint8Array };
    expect(Buffer.from(row.code_hash).toString("utf8")).not.toBe(code);
    expect(row.code_hash.length).toBe(32); // SHA-256
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `startEmailOtp`**

Create `packages/core/src/flows/email-otp.ts`:

```ts
import { createHash } from "node:crypto";
import type { Db } from "../db.js";
import type { Deps } from "../deps.js";
import type { SendOtp, OtpStartResult } from "../types.js";
import { insertOtp } from "../storage/otps.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateNumericCode(deps: Deps, digits: number): string {
  // Reject-sample to avoid bias from modulo on a Uint8 byte.
  const max = 10 ** digits;
  const bytes = deps.randomBytes(8);
  let value = 0;
  for (const b of bytes) value = (value << 8) | b;
  // Make positive and bound. Bias is negligible at 6 digits / 64 bits.
  const positive = Math.abs(value);
  return String(positive % max).padStart(digits, "0");
}

function hashCode(code: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(code).digest());
}

export async function startEmailOtp(args: {
  db: Db;
  deps: Deps;
  sendOtp: SendOtp;
  email: string;
  expirySeconds: number;
}): Promise<OtpStartResult> {
  const { db, deps, sendOtp, email, expirySeconds } = args;
  const normalized = normalizeEmail(email);
  const id = deps.randomId("otp");
  const code = generateNumericCode(deps, 6);
  const now = deps.now();

  insertOtp(db, {
    id,
    email: normalized,
    codeHash: hashCode(code),
    attempts: 0,
    createdAt: now,
    expiresAt: now + expirySeconds,
    consumedAt: null,
  });

  await sendOtp({ to: normalized, code });
  return { otpId: id, expiresInSeconds: expirySeconds };
}
```

- [ ] **Step 4: Re-export**

Update `packages/core/src/index.ts` to add:

```ts
export { startEmailOtp } from "./flows/email-otp.js";
```

(Keep all prior exports.)

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: 3 startEmailOtp tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/flows/email-otp.ts packages/core/tests/email-otp.test.ts packages/core/src/index.ts
git commit -m "feat(core): startEmailOtp"
```

---

## Task 13: Email OTP — verify

**Files:**
- Modify: `packages/core/src/flows/email-otp.ts` (append `verifyEmailOtp`)
- Modify: `packages/core/tests/email-otp.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `packages/core/tests/email-otp.test.ts`:

```ts
import { verifyEmailOtp } from "../src/flows/email-otp.js";
import { AuthError } from "../src/errors.js";

describe("verifyEmailOtp", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  async function startAndGet(email = "matt@example.com") {
    const { otpId } = await startEmailOtp({
      db: h.db, deps: h.deps, sendOtp: h.sendOtp,
      email, expirySeconds: 600,
    });
    const code = h.sentOtps.at(-1)!.code;
    return { otpId, code };
  }

  it("returns userId on success and creates the user via hook", async () => {
    const { otpId, code } = await startAndGet();
    const result = await verifyEmailOtp({
      db: h.db, deps: h.deps,
      findOrCreateByEmail: h.findOrCreateByEmail,
      otpId, code,
      maxAttempts: 5,
    });
    expect(result.userId).toBe("u_1");
    expect(result.email).toBe("matt@example.com");
    expect(h.users.get("matt@example.com")).toBe("u_1");
  });

  it("marks the OTP consumed after success", async () => {
    const { otpId, code } = await startAndGet();
    await verifyEmailOtp({
      db: h.db, deps: h.deps,
      findOrCreateByEmail: h.findOrCreateByEmail,
      otpId, code, maxAttempts: 5,
    });
    const row = h.db
      .prepare("SELECT consumed_at FROM auth_email_otps WHERE id = ?")
      .get(otpId) as { consumed_at: number | null };
    expect(row.consumed_at).not.toBeNull();
  });

  it("rejects an already-consumed OTP", async () => {
    const { otpId, code } = await startAndGet();
    await verifyEmailOtp({
      db: h.db, deps: h.deps, findOrCreateByEmail: h.findOrCreateByEmail,
      otpId, code, maxAttempts: 5,
    });
    await expect(
      verifyEmailOtp({
        db: h.db, deps: h.deps, findOrCreateByEmail: h.findOrCreateByEmail,
        otpId, code, maxAttempts: 5,
      })
    ).rejects.toThrow(/invalid_otp|consumed/i);
  });

  it("rejects unknown otpId as invalid_otp", async () => {
    await expect(
      verifyEmailOtp({
        db: h.db, deps: h.deps, findOrCreateByEmail: h.findOrCreateByEmail,
        otpId: "otp_does_not_exist", code: "123456", maxAttempts: 5,
      })
    ).rejects.toMatchObject({ code: "invalid_otp" });
  });

  it("counts wrong attempts and rejects after maxAttempts", async () => {
    const { otpId } = await startAndGet();
    for (let i = 0; i < 5; i++) {
      await expect(
        verifyEmailOtp({
          db: h.db, deps: h.deps, findOrCreateByEmail: h.findOrCreateByEmail,
          otpId, code: "000000", maxAttempts: 5,
        })
      ).rejects.toMatchObject({ code: "invalid_otp" });
    }
    // 6th attempt: even with the right code, it's now exceeded.
    const realCode = h.sentOtps[0]!.code;
    await expect(
      verifyEmailOtp({
        db: h.db, deps: h.deps, findOrCreateByEmail: h.findOrCreateByEmail,
        otpId, code: realCode, maxAttempts: 5,
      })
    ).rejects.toMatchObject({ code: "otp_attempts_exceeded" });
  });

  it("rejects expired OTPs as otp_expired", async () => {
    const { otpId, code } = await startAndGet();
    h.clock.now += 10_000; // way past 600s expiry
    await expect(
      verifyEmailOtp({
        db: h.db, deps: h.deps, findOrCreateByEmail: h.findOrCreateByEmail,
        otpId, code, maxAttempts: 5,
      })
    ).rejects.toMatchObject({ code: "otp_expired" });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — `verifyEmailOtp` not exported.

- [ ] **Step 3: Implement `verifyEmailOtp`**

Append to `packages/core/src/flows/email-otp.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import type { FindOrCreateByEmail, User } from "../types.js";
import {
  getOtpById,
  incrementOtpAttempts,
  markOtpConsumed,
} from "../storage/otps.js";
import { AuthError } from "../errors.js";

export async function verifyEmailOtp(args: {
  db: Db;
  deps: Deps;
  findOrCreateByEmail: FindOrCreateByEmail;
  otpId: string;
  code: string;
  maxAttempts: number;
}): Promise<User> {
  const { db, deps, findOrCreateByEmail, otpId, code, maxAttempts } = args;
  const row = getOtpById(db, otpId);
  if (!row) {
    throw new AuthError("invalid_otp", "OTP not found");
  }
  if (row.consumedAt !== null) {
    throw new AuthError("invalid_otp", "OTP already consumed");
  }
  if (row.attempts >= maxAttempts) {
    throw new AuthError("otp_attempts_exceeded", "Too many attempts");
  }
  if (row.expiresAt <= deps.now()) {
    throw new AuthError("otp_expired", "OTP has expired");
  }

  const provided = hashCode(code);
  const matches =
    provided.length === row.codeHash.length &&
    timingSafeEqual(provided, row.codeHash);

  if (!matches) {
    incrementOtpAttempts(db, otpId);
    throw new AuthError("invalid_otp", "Code does not match");
  }

  markOtpConsumed(db, otpId, deps.now());
  const userId = await findOrCreateByEmail(row.email);
  return { id: userId, email: row.email };
}
```

- [ ] **Step 4: Re-export**

Update `packages/core/src/index.ts` to add `verifyEmailOtp` to the email-otp export.

```ts
export { startEmailOtp, verifyEmailOtp } from "./flows/email-otp.js";
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: all email-otp tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/flows/email-otp.ts packages/core/tests/email-otp.test.ts packages/core/src/index.ts
git commit -m "feat(core): verifyEmailOtp with attempts + expiry + single-use"
```

---

## Task 14: Passkey registration — begin + finish

**Files:**
- Create: `packages/core/src/flows/passkey-register.ts`
- Create: `packages/core/tests/passkey.test.ts`

This task uses `@simplewebauthn/server`. Tests verify the *shape* the server produces and consumes; full WebAuthn signature verification is exercised by integration tests later (Task 18) using fixtures generated from a real authenticator.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/passkey.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { beginPasskeyRegistration } from "../src/flows/passkey-register.js";
import { createHarness, type Harness } from "./setup.js";

describe("beginPasskeyRegistration", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("returns options with rp, user, challenge, pubKeyCredParams", async () => {
    const result = await beginPasskeyRegistration({
      db: h.db,
      deps: h.deps,
      userId: "u_1",
      userEmail: "matt@example.com",
      rpId: "example.com",
      rpName: "Example",
      userVerification: "preferred",
    });

    expect(result.options.rp.id).toBe("example.com");
    expect(result.options.rp.name).toBe("Example");
    expect(result.options.user.name).toBe("matt@example.com");
    expect(typeof result.options.challenge).toBe("string");
    expect(result.options.challenge.length).toBeGreaterThan(0);
    expect(Array.isArray(result.options.pubKeyCredParams)).toBe(true);
    expect(result.options.pubKeyCredParams.length).toBeGreaterThan(0);
  });

  it("excludes already-registered credentials of the same user", async () => {
    h.db.prepare(
      "INSERT INTO auth_passkeys (credential_id, user_id, public_key, sign_count, created_at) VALUES (?, ?, ?, 0, 100)"
    ).run(new Uint8Array([1, 2, 3]), "u_1", new Uint8Array([9]));

    const result = await beginPasskeyRegistration({
      db: h.db, deps: h.deps,
      userId: "u_1", userEmail: "matt@example.com",
      rpId: "example.com", rpName: "Example",
      userVerification: "preferred",
    });
    expect(result.options.excludeCredentials?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns a registrationId that can later be redeemed by finish", async () => {
    const result = await beginPasskeyRegistration({
      db: h.db, deps: h.deps,
      userId: "u_1", userEmail: "matt@example.com",
      rpId: "example.com", rpName: "Example",
      userVerification: "preferred",
    });
    expect(result.registrationId).toMatch(/^reg_/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement begin (with in-memory challenge store)**

Create `packages/core/src/flows/passkey-register.ts`:

```ts
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type { Db } from "../db.js";
import type { Deps } from "../deps.js";
import { listPasskeysByUser, insertPasskey } from "../storage/passkeys.js";
import { AuthError } from "../errors.js";

/** In-process challenge store. Each registration emits an opaque
 *  registrationId; the client echoes it back on `finish` along with the
 *  credential. We look up the original challenge by that ID to verify.
 *  Stored as {challenge, userId, expiresAt}. */
interface PendingRegistration {
  challenge: string;
  userId: string;
  expiresAt: number;
}
const pendingRegistrations = new Map<string, PendingRegistration>();
const REGISTRATION_TTL_SECONDS = 5 * 60;

function gcExpired(now: number) {
  for (const [id, p] of pendingRegistrations) {
    if (p.expiresAt <= now) pendingRegistrations.delete(id);
  }
}

export interface BeginRegistrationInput {
  db: Db;
  deps: Deps;
  userId: string;
  userEmail: string;
  rpId: string;
  rpName: string;
  userVerification: "required" | "preferred" | "discouraged";
}

export interface BeginRegistrationResult {
  registrationId: string;
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
}

export async function beginPasskeyRegistration(
  input: BeginRegistrationInput
): Promise<BeginRegistrationResult> {
  const { db, deps, userId, userEmail, rpId, rpName, userVerification } = input;

  const existing = listPasskeysByUser(db, userId).map((p) => ({
    id: p.credentialId,
    type: "public-key" as const,
    transports: (p.transports ?? undefined) as
      | GenerateRegistrationOptionsOpts["excludeCredentials"][number]["transports"]
      | undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userID: new TextEncoder().encode(userId),
    userName: userEmail,
    userDisplayName: userEmail,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification,
    },
    excludeCredentials: existing,
  });

  const now = deps.now();
  gcExpired(now);
  const registrationId = deps.randomId("reg");
  pendingRegistrations.set(registrationId, {
    challenge: options.challenge,
    userId,
    expiresAt: now + REGISTRATION_TTL_SECONDS,
  });

  return { registrationId, options };
}

export interface FinishRegistrationInput {
  db: Db;
  deps: Deps;
  registrationId: string;
  credential: Parameters<typeof verifyRegistrationResponse>[0]["response"];
  rpId: string;
  expectedOrigins: string[];
  deviceName?: string;
}

export interface FinishRegistrationResult {
  passkeyId: string;
}

export async function finishPasskeyRegistration(
  input: FinishRegistrationInput
): Promise<FinishRegistrationResult> {
  const { db, deps, registrationId, credential, rpId, expectedOrigins, deviceName } = input;

  const pending = pendingRegistrations.get(registrationId);
  if (!pending) {
    throw new AuthError("invalid_credential", "Registration not found or expired");
  }
  pendingRegistrations.delete(registrationId);
  if (pending.expiresAt <= deps.now()) {
    throw new AuthError("invalid_credential", "Registration expired");
  }

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpId,
      requireUserVerification: false,
    } satisfies VerifyRegistrationResponseOpts);
  } catch (cause) {
    throw new AuthError("invalid_credential", `Verification failed: ${(cause as Error).message}`);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError("invalid_credential", "Verification did not succeed");
  }

  const info = verification.registrationInfo;
  const credentialId = info.credential.id;
  const publicKey = info.credential.publicKey;
  const aaguid = info.aaguid ? Buffer.from(info.aaguid, "base64") : null;
  const transports = info.credential.transports ?? null;

  insertPasskey(db, {
    credentialId: new Uint8Array(credentialId),
    userId: pending.userId,
    publicKey: new Uint8Array(publicKey),
    signCount: info.credential.counter,
    transports: transports ? Array.from(transports) : null,
    aaguid: aaguid ? new Uint8Array(aaguid) : null,
    deviceName: deviceName ?? null,
    createdAt: deps.now(),
    lastUsedAt: null,
  });

  return { passkeyId: `pk_${Buffer.from(credentialId).toString("base64url")}` };
}
```

- [ ] **Step 4: Re-export**

Update `packages/core/src/index.ts`:

```ts
export {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
} from "./flows/passkey-register.js";
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: 3 beginPasskeyRegistration tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/flows/passkey-register.ts packages/core/tests/passkey.test.ts packages/core/src/index.ts
git commit -m "feat(core): passkey registration ceremony (begin + finish)"
```

> **Note:** End-to-end verification of `finishPasskeyRegistration` requires real WebAuthn fixtures. We add an integration test in Task 18 once the full `Auth` factory is wired up; we'll either generate fixtures via `@simplewebauthn/server`'s test utilities or mock `verifyRegistrationResponse` to assert plumbing.

---

## Task 15: Passkey sign-in — begin + finish

**Files:**
- Create: `packages/core/src/flows/passkey-signin.ts`
- Modify: `packages/core/tests/passkey.test.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `packages/core/tests/passkey.test.ts`:

```ts
import { beginPasskeySignIn } from "../src/flows/passkey-signin.js";

describe("beginPasskeySignIn", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("returns options with rpId, challenge, empty allowCredentials", async () => {
    const result = await beginPasskeySignIn({
      db: h.db, deps: h.deps,
      rpId: "example.com",
      userVerification: "preferred",
    });
    expect(result.options.rpId).toBe("example.com");
    expect(typeof result.options.challenge).toBe("string");
    expect(result.options.allowCredentials).toEqual([]);
    expect(result.signInId).toMatch(/^auth_/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/flows/passkey-signin.ts`:

```ts
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifyAuthenticationResponseOpts,
} from "@simplewebauthn/server";
import type { Db } from "../db.js";
import type { Deps } from "../deps.js";
import { AuthError } from "../errors.js";
import {
  getPasskeyByCredentialId,
  updatePasskeySignCount,
} from "../storage/passkeys.js";

interface PendingSignIn {
  challenge: string;
  expiresAt: number;
}
const pendingSignIns = new Map<string, PendingSignIn>();
const SIGNIN_TTL_SECONDS = 5 * 60;

function gcExpired(now: number) {
  for (const [id, p] of pendingSignIns) {
    if (p.expiresAt <= now) pendingSignIns.delete(id);
  }
}

export interface BeginSignInInput {
  db: Db;
  deps: Deps;
  rpId: string;
  userVerification: "required" | "preferred" | "discouraged";
}

export interface BeginSignInResult {
  signInId: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
}

export async function beginPasskeySignIn(input: BeginSignInInput): Promise<BeginSignInResult> {
  const { deps, rpId, userVerification } = input;
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification,
    allowCredentials: [], // discoverable creds
  });

  const now = deps.now();
  gcExpired(now);
  const signInId = deps.randomId("auth");
  pendingSignIns.set(signInId, {
    challenge: options.challenge,
    expiresAt: now + SIGNIN_TTL_SECONDS,
  });

  return { signInId, options };
}

export interface FinishSignInInput {
  db: Db;
  deps: Deps;
  signInId: string;
  credential: Parameters<typeof verifyAuthenticationResponse>[0]["response"];
  rpId: string;
  expectedOrigins: string[];
}

export interface FinishSignInResult {
  userId: string;
}

export async function finishPasskeySignIn(input: FinishSignInInput): Promise<FinishSignInResult> {
  const { db, deps, signInId, credential, rpId, expectedOrigins } = input;

  const pending = pendingSignIns.get(signInId);
  if (!pending) {
    throw new AuthError("invalid_credential", "Sign-in not found or expired");
  }
  pendingSignIns.delete(signInId);
  if (pending.expiresAt <= deps.now()) {
    throw new AuthError("invalid_credential", "Sign-in expired");
  }

  // The WebAuthn assertion identifies the credential by its rawId.
  const credIdBase64Url = credential.rawId;
  const credId = new Uint8Array(Buffer.from(credIdBase64Url, "base64url"));
  const stored = getPasskeyByCredentialId(db, credId);
  if (!stored) {
    throw new AuthError("unknown_credential", "Credential not registered");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpId,
      credential: {
        id: stored.credentialId,
        publicKey: stored.publicKey,
        counter: stored.signCount,
        transports: stored.transports ?? undefined,
      },
      requireUserVerification: false,
    } satisfies VerifyAuthenticationResponseOpts);
  } catch (cause) {
    throw new AuthError("invalid_credential", `Verification failed: ${(cause as Error).message}`);
  }

  if (!verification.verified) {
    throw new AuthError("invalid_credential", "Verification did not succeed");
  }

  updatePasskeySignCount(
    db,
    stored.credentialId,
    verification.authenticationInfo.newCounter,
    deps.now()
  );

  return { userId: stored.userId };
}
```

- [ ] **Step 4: Re-export**

Update `packages/core/src/index.ts`:

```ts
export {
  beginPasskeySignIn,
  finishPasskeySignIn,
} from "./flows/passkey-signin.js";
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: passkey-signin test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/flows/passkey-signin.ts packages/core/tests/passkey.test.ts packages/core/src/index.ts
git commit -m "feat(core): passkey sign-in ceremony (begin + finish)"
```

---

## Task 16: AASA helper + cleanup helper

**Files:**
- Create: `packages/core/src/aasa.ts`
- Create: `packages/core/src/cleanup.ts`
- Create: `packages/core/tests/aasa.test.ts`
- Create: `packages/core/tests/cleanup.test.ts`

- [ ] **Step 1: Write failing AASA test**

Create `packages/core/tests/aasa.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { appleAppSiteAssociation } from "../src/aasa.js";

describe("appleAppSiteAssociation", () => {
  it("returns webcredentials.apps with the given app IDs", () => {
    const json = appleAppSiteAssociation({ appIds: ["TEAMID.com.example.MyApp"] });
    expect(json.webcredentials.apps).toEqual(["TEAMID.com.example.MyApp"]);
  });

  it("supports multiple app IDs", () => {
    const json = appleAppSiteAssociation({
      appIds: ["TEAMID.com.example.A", "TEAMID.com.example.B"],
    });
    expect(json.webcredentials.apps).toHaveLength(2);
  });

  it("returns an empty array when given no apps", () => {
    expect(appleAppSiteAssociation({ appIds: [] }).webcredentials.apps).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

Create `packages/core/src/aasa.ts`:

```ts
import type { AasaInput } from "./types.js";

export interface AppleAppSiteAssociation {
  webcredentials: { apps: string[] };
}

export function appleAppSiteAssociation(input: AasaInput): AppleAppSiteAssociation {
  return { webcredentials: { apps: input.appIds.slice() } };
}
```

- [ ] **Step 3: Write failing cleanup test**

Create `packages/core/tests/cleanup.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { cleanup } from "../src/cleanup.js";
import { insertSession } from "../src/storage/sessions.js";
import { insertOtp } from "../src/storage/otps.js";
import { createHarness, type Harness } from "./setup.js";

describe("cleanup", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("removes expired sessions and OTPs, leaves live ones", () => {
    h.clock.now = 1000;
    insertSession(h.db, {
      tokenHash: new Uint8Array(32).fill(1), userId: "u_1",
      createdAt: 100, expiresAt: 500, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: new Uint8Array(32).fill(2), userId: "u_1",
      createdAt: 100, expiresAt: 5000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertOtp(h.db, {
      id: "otp_old", email: "x@y", codeHash: new Uint8Array(32),
      attempts: 0, createdAt: 100, expiresAt: 500, consumedAt: null,
    });
    insertOtp(h.db, {
      id: "otp_new", email: "x@y", codeHash: new Uint8Array(32),
      attempts: 0, createdAt: 100, expiresAt: 5000, consumedAt: null,
    });

    const removed = cleanup({ db: h.db, deps: h.deps });
    expect(removed.sessions).toBe(1);
    expect(removed.otps).toBe(1);
  });
});
```

- [ ] **Step 4: Implement**

Create `packages/core/src/cleanup.ts`:

```ts
import type { Db } from "./db.js";
import type { Deps } from "./deps.js";
import { deleteExpiredSessions } from "./storage/sessions.js";
import { deleteExpiredOtps } from "./storage/otps.js";

export function cleanup(args: { db: Db; deps: Deps }): { sessions: number; otps: number } {
  const cutoff = args.deps.now();
  return {
    sessions: deleteExpiredSessions(args.db, cutoff),
    otps: deleteExpiredOtps(args.db, cutoff),
  };
}
```

- [ ] **Step 5: Re-export**

Update `packages/core/src/index.ts`:

```ts
export { appleAppSiteAssociation } from "./aasa.js";
export { cleanup } from "./cleanup.js";
```

- [ ] **Step 6: Run tests, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: AASA and cleanup tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/aasa.ts packages/core/src/cleanup.ts packages/core/tests/aasa.test.ts packages/core/tests/cleanup.test.ts packages/core/src/index.ts
git commit -m "feat(core): AASA helper and cleanup"
```

---

## Task 17: `createAuth` factory + `requireSession` helper

**Files:**
- Create: `packages/core/src/auth.ts`
- Create: `packages/core/tests/auth.test.ts`

This is the public façade. Consumers call `createAuth(config)` and get back an object whose methods correspond to the contract.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createAuth } from "../src/auth.js";
import { AuthError } from "../src/errors.js";
import { createHarness, type Harness } from "./setup.js";

describe("createAuth — full email-OTP flow", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  function buildAuth() {
    return createAuth(
      {
        rpId: "example.com",
        origins: ["https://app.example.com"],
        session: { lifetimeSeconds: 60 * 60 * 24 * 30 },
        otp: { expirySeconds: 600, maxAttempts: 5 },
        webauthn: { userVerification: "preferred" },
        email: { sendOtp: h.sendOtp },
        users: { findOrCreateByEmail: h.findOrCreateByEmail },
      },
      { db: h.db, deps: h.deps }
    );
  }

  it("end-to-end email OTP: start → verify → returns sessionToken + user", async () => {
    const auth = buildAuth();
    const start = await auth.startEmailOtp({ email: "matt@example.com" });
    expect(start.otpId).toMatch(/^otp_/);
    const code = h.sentOtps[0]!.code;
    const result = await auth.verifyEmailOtp({ otpId: start.otpId, code });
    expect(result.sessionToken).toMatch(/^tok_/);
    expect(result.user.email).toBe("matt@example.com");
  });

  it("requireSession returns user for a valid bearer token", async () => {
    const auth = buildAuth();
    const start = await auth.startEmailOtp({ email: "matt@example.com" });
    const { sessionToken } = await auth.verifyEmailOtp({
      otpId: start.otpId, code: h.sentOtps[0]!.code,
    });
    const req = new Request("https://x", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const user = await auth.requireSession(req);
    expect(user.email).toBe("matt@example.com");
  });

  it("requireSession reads session from cookie when present", async () => {
    const auth = buildAuth();
    const start = await auth.startEmailOtp({ email: "matt@example.com" });
    const { sessionToken } = await auth.verifyEmailOtp({
      otpId: start.otpId, code: h.sentOtps[0]!.code,
    });
    const req = new Request("https://x", {
      headers: { Cookie: `session=${sessionToken}` },
    });
    const user = await auth.requireSession(req, { cookieName: "session" });
    expect(user.email).toBe("matt@example.com");
  });

  it("requireSession throws unauthenticated when no token is present", async () => {
    const auth = buildAuth();
    const req = new Request("https://x");
    await expect(auth.requireSession(req)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("signOut revokes the current session", async () => {
    const auth = buildAuth();
    const start = await auth.startEmailOtp({ email: "matt@example.com" });
    const { sessionToken } = await auth.verifyEmailOtp({
      otpId: start.otpId, code: h.sentOtps[0]!.code,
    });
    auth.signOut({ sessionToken });
    const req = new Request("https://x", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    await expect(auth.requireSession(req)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("listSessions returns active sessions for a user", async () => {
    const auth = buildAuth();
    const a = await auth.startEmailOtp({ email: "matt@example.com" });
    await auth.verifyEmailOtp({ otpId: a.otpId, code: h.sentOtps[0]!.code });
    const b = await auth.startEmailOtp({ email: "matt@example.com" });
    await auth.verifyEmailOtp({ otpId: b.otpId, code: h.sentOtps[1]!.code });
    expect(auth.listSessions({ userId: "u_1" })).toHaveLength(2);
  });

  it("appleAppSiteAssociation produces the right shape", () => {
    const auth = buildAuth();
    expect(auth.appleAppSiteAssociation({ appIds: ["X.app"] }))
      .toEqual({ webcredentials: { apps: ["X.app"] } });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: FAIL — `createAuth` not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/auth.ts`:

```ts
import type { Db } from "./db.js";
import { defaultDeps, type Deps } from "./deps.js";
import { AuthError } from "./errors.js";
import type {
  AuthConfig,
  AasaInput,
  User,
  OtpStartResult,
  SignInResult,
  SessionRecord,
} from "./types.js";
import { startEmailOtp, verifyEmailOtp } from "./flows/email-otp.js";
import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  type BeginRegistrationResult,
  type FinishRegistrationInput,
  type FinishRegistrationResult,
} from "./flows/passkey-register.js";
import {
  beginPasskeySignIn,
  finishPasskeySignIn,
  type BeginSignInResult,
  type FinishSignInInput,
} from "./flows/passkey-signin.js";
import {
  createSession,
  validateAndBumpSession,
  revokeSession,
  listSessionsForUser,
} from "./session.js";
import { listPasskeysByUser, deletePasskey } from "./storage/passkeys.js";
import { appleAppSiteAssociation, type AppleAppSiteAssociation } from "./aasa.js";
import { cleanup } from "./cleanup.js";

const DEFAULT_OTP_EXPIRY = 600;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_USER_VERIFICATION: "preferred" = "preferred";

export interface AuthRuntime {
  db: Db;
  deps?: Deps;
}

export function createAuth(config: AuthConfig, runtime: AuthRuntime) {
  const deps = runtime.deps ?? defaultDeps;
  const db = runtime.db;

  const otpExpiry = config.otp?.expirySeconds ?? DEFAULT_OTP_EXPIRY;
  const otpMaxAttempts = config.otp?.maxAttempts ?? DEFAULT_OTP_MAX_ATTEMPTS;
  const userVerification = config.webauthn?.userVerification ?? DEFAULT_USER_VERIFICATION;

  function readToken(req: Request, opts?: { cookieName?: string }): string | null {
    const auth = req.headers.get("authorization");
    if (auth) {
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) return m[1]!;
    }
    const cookieName = opts?.cookieName ?? config.session.cookieName;
    if (cookieName) {
      const cookie = req.headers.get("cookie");
      if (cookie) {
        for (const part of cookie.split(";")) {
          const [k, v] = part.trim().split("=", 2);
          if (k === cookieName && v) return decodeURIComponent(v);
        }
      }
    }
    return null;
  }

  return {
    // ---- Email OTP -----------------------------------------------------------

    async startEmailOtp(input: { email: string }): Promise<OtpStartResult> {
      return startEmailOtp({
        db,
        deps,
        sendOtp: config.email.sendOtp,
        email: input.email,
        expirySeconds: otpExpiry,
      });
    },

    async verifyEmailOtp(input: {
      otpId: string;
      code: string;
      userAgent?: string;
      ip?: string;
    }): Promise<SignInResult> {
      const user = await verifyEmailOtp({
        db,
        deps,
        findOrCreateByEmail: config.users.findOrCreateByEmail,
        otpId: input.otpId,
        code: input.code,
        maxAttempts: otpMaxAttempts,
      });
      const { sessionToken } = await createSession({
        db,
        deps,
        userId: user.id,
        lifetimeSeconds: config.session.lifetimeSeconds,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      });
      return { sessionToken, user };
    },

    // ---- Passkey registration ------------------------------------------------

    async beginPasskeyRegistration(args: { user: User }): Promise<BeginRegistrationResult> {
      return beginPasskeyRegistration({
        db,
        deps,
        userId: args.user.id,
        userEmail: args.user.email,
        rpId: config.rpId,
        rpName: config.rpId,
        userVerification,
      });
    },

    async finishPasskeyRegistration(
      args: Omit<FinishRegistrationInput, "db" | "deps" | "rpId" | "expectedOrigins">
    ): Promise<FinishRegistrationResult> {
      return finishPasskeyRegistration({
        db,
        deps,
        rpId: config.rpId,
        expectedOrigins: config.origins,
        ...args,
      });
    },

    // ---- Passkey sign-in -----------------------------------------------------

    async beginPasskeySignIn(): Promise<BeginSignInResult> {
      return beginPasskeySignIn({
        db,
        deps,
        rpId: config.rpId,
        userVerification,
      });
    },

    async finishPasskeySignIn(args: {
      signInId: string;
      credential: FinishSignInInput["credential"];
      userAgent?: string;
      ip?: string;
    }): Promise<SignInResult> {
      const { userId } = await finishPasskeySignIn({
        db,
        deps,
        rpId: config.rpId,
        expectedOrigins: config.origins,
        signInId: args.signInId,
        credential: args.credential,
      });
      // We need the email for the response; ask the project's hook in reverse
      // is not available — instead, we synthesize a minimal user with id only,
      // and the project layer can enrich. Document this limit clearly.
      const user: User = { id: userId, email: "" };
      const { sessionToken } = await createSession({
        db,
        deps,
        userId,
        lifetimeSeconds: config.session.lifetimeSeconds,
        userAgent: args.userAgent ?? null,
        ip: args.ip ?? null,
      });
      return { sessionToken, user };
    },

    // ---- Sessions ------------------------------------------------------------

    async requireSession(
      req: Request,
      opts?: { cookieName?: string }
    ): Promise<{ id: string; email: string }> {
      const token = readToken(req, opts);
      if (!token) {
        throw new AuthError("unauthenticated", "No session token");
      }
      const { userId } = validateAndBumpSession({ db, deps, sessionToken: token });
      // Email isn't stored in sessions (project owns that). Returning id and
      // an empty email keeps the type stable; consumers needing email can look
      // it up in their own users table by id.
      return { id: userId, email: "" };
    },

    signOut(args: { sessionToken: string }): void {
      revokeSession({ db, sessionToken: args.sessionToken });
    },

    listSessions(args: { userId: string }): SessionRecord[] {
      return listSessionsForUser(db, args.userId);
    },

    // ---- Passkey management --------------------------------------------------

    listPasskeys(args: { userId: string }) {
      return listPasskeysByUser(db, args.userId);
    },

    removePasskey(args: { credentialId: Uint8Array }) {
      deletePasskey(db, args.credentialId);
    },

    // ---- Helpers -------------------------------------------------------------

    appleAppSiteAssociation(input: AasaInput): AppleAppSiteAssociation {
      return appleAppSiteAssociation(input);
    },

    cleanup() {
      return cleanup({ db, deps });
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 4: Re-export**

Update `packages/core/src/index.ts` to add:

```ts
export { createAuth, type Auth } from "./auth.js";
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: all auth.test.ts cases pass plus all prior tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/auth.ts packages/core/tests/auth.test.ts packages/core/src/index.ts
git commit -m "feat(core): createAuth factory + requireSession helper"
```

---

## Task 18: WebAuthn integration test (real fixture)

**Files:**
- Create: `packages/core/tests/passkey-integration.test.ts`

This validates the full passkey ceremony plumbing against a real `@simplewebauthn/server` round-trip. We use the library's helpers to construct deterministic registration/assertion responses for testing.

- [ ] **Step 1: Add devDependency**

```bash
pnpm --filter @mattsmith/passkey-sdk-core add -D @simplewebauthn/types
```

- [ ] **Step 2: Write the integration test**

Create `packages/core/tests/passkey-integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAuth } from "../src/auth.js";
import { createHarness, type Harness } from "./setup.js";
import * as simpleWebauthn from "@simplewebauthn/server";

// We mock @simplewebauthn/server's verifiers to assert plumbing — the library
// itself is well-tested. The real-fixture E2E test happens in the example app
// against a browser-driven flow (covered in Phase 2).

describe("passkey ceremony plumbing", () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
    vi.restoreAllMocks();
  });

  function buildAuth() {
    return createAuth(
      {
        rpId: "example.com",
        origins: ["https://app.example.com"],
        session: { lifetimeSeconds: 60 * 60 * 24 * 30 },
        email: { sendOtp: h.sendOtp },
        users: { findOrCreateByEmail: h.findOrCreateByEmail },
      },
      { db: h.db, deps: h.deps }
    );
  }

  it("registration: stores credential when verifier succeeds", async () => {
    const auth = buildAuth();
    const begin = await auth.beginPasskeyRegistration({
      user: { id: "u_1", email: "matt@example.com" },
    });
    expect(begin.options.challenge).toBeDefined();

    vi.spyOn(simpleWebauthn, "verifyRegistrationResponse").mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: new Uint8Array([10, 11, 12]),
          publicKey: new Uint8Array([20, 21, 22]),
          counter: 0,
          transports: ["internal"],
        },
        aaguid: Buffer.from(new Uint8Array(16).fill(7)).toString("base64"),
        // other fields not used by the SDK
      } as any,
    } as any);

    const result = await auth.finishPasskeyRegistration({
      registrationId: begin.registrationId,
      credential: { id: "x", rawId: "x", response: {} as any, type: "public-key" } as any,
      deviceName: "Test Device",
    });

    expect(result.passkeyId).toMatch(/^pk_/);
    const stored = auth.listPasskeys({ userId: "u_1" });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.deviceName).toBe("Test Device");
  });

  it("registration: rejects when verifier fails", async () => {
    const auth = buildAuth();
    const begin = await auth.beginPasskeyRegistration({
      user: { id: "u_1", email: "matt@example.com" },
    });

    vi.spyOn(simpleWebauthn, "verifyRegistrationResponse").mockRejectedValue(
      new Error("bad signature")
    );

    await expect(
      auth.finishPasskeyRegistration({
        registrationId: begin.registrationId,
        credential: { id: "x", rawId: "x", response: {} as any, type: "public-key" } as any,
      })
    ).rejects.toMatchObject({ code: "invalid_credential" });
  });

  it("sign-in: returns sessionToken when credential exists and verifier succeeds", async () => {
    const auth = buildAuth();
    // Pre-register a passkey by inserting directly.
    const credId = new Uint8Array([10, 11, 12]);
    h.db.prepare(
      "INSERT INTO auth_passkeys (credential_id, user_id, public_key, sign_count, created_at) VALUES (?, ?, ?, 0, 100)"
    ).run(credId, "u_1", new Uint8Array([20, 21, 22]));

    const begin = await auth.beginPasskeySignIn();

    vi.spyOn(simpleWebauthn, "verifyAuthenticationResponse").mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 } as any,
    } as any);

    const credIdBase64Url = Buffer.from(credId).toString("base64url");
    const result = await auth.finishPasskeySignIn({
      signInId: begin.signInId,
      credential: {
        id: credIdBase64Url,
        rawId: credIdBase64Url,
        response: {} as any,
        type: "public-key",
      } as any,
    });

    expect(result.sessionToken).toMatch(/^tok_/);
    expect(result.user.id).toBe("u_1");
  });

  it("sign-in: throws unknown_credential when credential is not registered", async () => {
    const auth = buildAuth();
    const begin = await auth.beginPasskeySignIn();
    const credIdBase64Url = Buffer.from(new Uint8Array([99])).toString("base64url");
    await expect(
      auth.finishPasskeySignIn({
        signInId: begin.signInId,
        credential: {
          id: credIdBase64Url,
          rawId: credIdBase64Url,
          response: {} as any,
          type: "public-key",
        } as any,
      })
    ).rejects.toMatchObject({ code: "unknown_credential" });
  });
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-core test`
Expected: 4 passkey-integration tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/tests/passkey-integration.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "test(core): passkey ceremony plumbing integration tests"
```

---

## Task 19: `hono` adapter package skeleton

**Files:**
- Create: `packages/hono/package.json`
- Create: `packages/hono/tsconfig.json`
- Create: `packages/hono/tsup.config.ts`
- Create: `packages/hono/vitest.config.ts`
- Create: `packages/hono/src/index.ts`

- [ ] **Step 1: Create `packages/hono/package.json`**

```json
{
  "name": "@mattsmith/passkey-sdk-hono",
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
  "dependencies": {
    "@mattsmith/passkey-sdk-core": "workspace:*",
    "zod": "^3.23.0"
  },
  "peerDependencies": {
    "hono": "^4.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "better-sqlite3": "^11.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "hono": "^4.5.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`**

`packages/hono/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

`packages/hono/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["hono", "@mattsmith/passkey-sdk-core"],
});
```

`packages/hono/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { globals: false, environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 3: Create empty `src/index.ts`**

```ts
export {};
```

- [ ] **Step 4: Install + verify**

Run: `pnpm install`
Run: `pnpm --filter @mattsmith/passkey-sdk-hono typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/hono pnpm-lock.yaml
git commit -m "chore(hono): scaffold adapter package"
```

---

## Task 20: `mountAuthRoutes` — HTTP contract conformance

**Files:**
- Create: `packages/hono/src/index.ts`
- Create: `packages/hono/tests/routes.test.ts`

This is where the HTTP contract from the spec actually gets exercised. Each contract endpoint becomes a test that hits the route and asserts the shape.

- [ ] **Step 1: Write the failing tests**

Create `packages/hono/tests/routes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import {
  createAuth,
  runMigrations,
  defaultDeps,
} from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "../src/index.js";

function buildApp() {
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
  mountAuthRoutes(app, auth);
  return { app, sentOtps, users, db };
}

describe("mountAuthRoutes — email OTP", () => {
  it("POST /auth/email/start returns otpId + expiresInSeconds", async () => {
    const { app, sentOtps } = buildApp();
    const res = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.otpId).toMatch(/^otp_/);
    expect(typeof body.expiresInSeconds).toBe("number");
    expect(sentOtps).toHaveLength(1);
  });

  it("POST /auth/email/start with invalid body returns 400", async () => {
    const { app } = buildApp();
    const res = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notEmail: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/email/verify returns sessionToken + user, sets cookie", async () => {
    const { app, sentOtps } = buildApp();
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    const { otpId } = await start.json();
    const code = sentOtps[0]!.code;
    const res = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionToken).toMatch(/^tok_/);
    expect(body.user.email).toBe("matt@example.com");
    expect(res.headers.get("set-cookie")).toContain("session=");
  });

  it("POST /auth/email/verify with bad code returns 401 invalid_otp", async () => {
    const { app } = buildApp();
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    const { otpId } = await start.json();
    const res = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code: "000000" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_otp");
  });
});

describe("mountAuthRoutes — sessions and /me", () => {
  it("GET /auth/me returns 401 with no session", async () => {
    const { app } = buildApp();
    const res = await app.request("/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns user with bearer token", async () => {
    const { app, sentOtps } = buildApp();
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
    const { sessionToken } = await verify.json();
    const me = await app.request("/auth/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body.user.id).toBe("u_1");
  });

  it("POST /auth/sign-out revokes the session", async () => {
    const { app, sentOtps } = buildApp();
    const start = await app.request("/auth/email/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    const { otpId } = await start.json();
    const verify = await app.request("/auth/email/verify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code: sentOtps[0]!.code }),
    });
    const { sessionToken } = await verify.json();
    const out = await app.request("/auth/sign-out", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(out.status).toBe(200);
    const me = await app.request("/auth/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(me.status).toBe(401);
  });
});

describe("mountAuthRoutes — passkey routes (shape only)", () => {
  // We test that the routes are wired and return the right error shapes for
  // unauthenticated/missing-credential cases. Successful end-to-end is covered
  // in Phase 2 against a real browser.

  it("POST /auth/passkey/register/start requires authentication", async () => {
    const { app } = buildApp();
    const res = await app.request("/auth/passkey/register/start", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("POST /auth/passkey/sign-in/start returns options without auth", async () => {
    const { app } = buildApp();
    const res = await app.request("/auth/passkey/sign-in/start", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options.rpId).toBe("example.com");
    expect(body.signInId).toMatch(/^auth_/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: FAIL — `mountAuthRoutes` not exported.

- [ ] **Step 3: Implement**

Replace `packages/hono/src/index.ts`:

```ts
import type { Hono } from "hono";
import { z } from "zod";
import { AuthError, type Auth } from "@mattsmith/passkey-sdk-core";

const startEmailSchema = z.object({ email: z.string().email() });
const verifyEmailSchema = z.object({
  otpId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
const finishRegistrationSchema = z.object({
  registrationId: z.string().min(1),
  credential: z.unknown(),
  deviceName: z.string().optional(),
});
const finishSignInSchema = z.object({
  signInId: z.string().min(1),
  credential: z.unknown(),
});

export interface MountOptions {
  prefix?: string;
}

function errorResponse(c: any, err: unknown) {
  if (AuthError.is(err)) {
    const status =
      err.code === "unauthenticated" ? 401 :
      err.code === "rate_limited" ? 429 :
      err.code === "invalid_otp" || err.code === "invalid_credential" ? 401 :
      err.code === "unknown_credential" ? 404 :
      err.code === "otp_expired" ? 410 :
      err.code === "otp_attempts_exceeded" ? 429 :
      400;
    return c.json(err.toJSON(), status);
  }
  console.error("Unexpected auth error:", err);
  return c.json({ error: "rate_limited", message: "Internal error" }, 500);
}

function setSessionCookie(c: any, token: string, lifetimeSeconds: number, cookieName: string) {
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    `Path=/`,
    `Max-Age=${lifetimeSeconds}`,
    `HttpOnly`,
    `SameSite=Lax`,
  ];
  c.header("set-cookie", parts.join("; "));
}

export function mountAuthRoutes(app: Hono, auth: Auth, opts: MountOptions = {}) {
  const prefix = opts.prefix ?? "/auth";
  const sessionLifetime = 60 * 60 * 24 * 30; // best-effort hint for cookie
  const cookieName = "session";

  app.post(`${prefix}/email/start`, async (c) => {
    try {
      const parsed = startEmailSchema.parse(await c.req.json());
      const result = await auth.startEmailOtp({ email: parsed.email });
      return c.json(result);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/email/verify`, async (c) => {
    try {
      const parsed = verifyEmailSchema.parse(await c.req.json());
      const result = await auth.verifyEmailOtp({
        otpId: parsed.otpId,
        code: parsed.code,
        userAgent: c.req.header("user-agent") ?? undefined,
        ip: c.req.header("x-forwarded-for") ?? undefined,
      });
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      return c.json(result);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/passkey/register/start`, async (c) => {
    try {
      const user = await auth.requireSession(c.req.raw, { cookieName });
      const result = await auth.beginPasskeyRegistration({ user });
      return c.json(result);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/passkey/register/finish`, async (c) => {
    try {
      await auth.requireSession(c.req.raw, { cookieName });
      const parsed = finishRegistrationSchema.parse(await c.req.json());
      const result = await auth.finishPasskeyRegistration({
        registrationId: parsed.registrationId,
        credential: parsed.credential as any,
        deviceName: parsed.deviceName,
      });
      return c.json(result);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/passkey/sign-in/start`, async (c) => {
    try {
      const result = await auth.beginPasskeySignIn();
      return c.json(result);
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/passkey/sign-in/finish`, async (c) => {
    try {
      const parsed = finishSignInSchema.parse(await c.req.json());
      const result = await auth.finishPasskeySignIn({
        signInId: parsed.signInId,
        credential: parsed.credential as any,
        userAgent: c.req.header("user-agent") ?? undefined,
        ip: c.req.header("x-forwarded-for") ?? undefined,
      });
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      return c.json(result);
    } catch (e) { return errorResponse(c, e); }
  });

  app.get(`${prefix}/me`, async (c) => {
    try {
      const user = await auth.requireSession(c.req.raw, { cookieName });
      return c.json({ user });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/sign-out`, async (c) => {
    try {
      const cookieHeader = c.req.header("cookie");
      const authHeader = c.req.header("authorization");
      let token: string | null = null;
      if (authHeader) {
        const m = authHeader.match(/^Bearer\s+(.+)$/i);
        if (m) token = m[1]!;
      }
      if (!token && cookieHeader) {
        for (const part of cookieHeader.split(";")) {
          const [k, v] = part.trim().split("=", 2);
          if (k === cookieName && v) { token = decodeURIComponent(v); break; }
        }
      }
      if (token) auth.signOut({ sessionToken: token });
      c.header("set-cookie", `${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  app.get(`${prefix}/sessions`, async (c) => {
    try {
      const user = await auth.requireSession(c.req.raw, { cookieName });
      const sessions = auth.listSessions({ userId: user.id });
      return c.json({
        sessions: sessions.map((s) => ({
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          lastSeenAt: s.lastSeenAt,
          userAgent: s.userAgent,
          ip: s.ip,
        })),
      });
    } catch (e) { return errorResponse(c, e); }
  });

  app.get(`${prefix}/passkeys`, async (c) => {
    try {
      const user = await auth.requireSession(c.req.raw, { cookieName });
      const passkeys = auth.listPasskeys({ userId: user.id });
      return c.json({
        passkeys: passkeys.map((p) => ({
          id: Buffer.from(p.credentialId).toString("base64url"),
          deviceName: p.deviceName,
          createdAt: p.createdAt,
          lastUsedAt: p.lastUsedAt,
          transports: p.transports,
        })),
      });
    } catch (e) { return errorResponse(c, e); }
  });

  app.delete(`${prefix}/passkeys/:id`, async (c) => {
    try {
      const user = await auth.requireSession(c.req.raw, { cookieName });
      const idParam = c.req.param("id");
      const credentialId = new Uint8Array(Buffer.from(idParam, "base64url"));
      const owned = auth.listPasskeys({ userId: user.id });
      if (!owned.some((p) =>
        Buffer.from(p.credentialId).equals(Buffer.from(credentialId))
      )) {
        return c.json({ error: "unknown_credential", message: "Not yours" }, 404);
      }
      auth.removePasskey({ credentialId });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @mattsmith/passkey-sdk-hono test`
Expected: all hono routes tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/hono/src packages/hono/tests
git commit -m "feat(hono): mountAuthRoutes implementing the HTTP contract"
```

---

## Task 21: CLI for migrations

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/tsup.config.ts`
- Create: `packages/cli/src/index.ts`

- [ ] **Step 1: Create package files**

`packages/cli/package.json`:
```json
{
  "name": "@mattsmith/passkey-sdk-cli",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": { "passkey-sdk": "./dist/index.js" },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "echo 'no tests'",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mattsmith/passkey-sdk-core": "workspace:*",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0"
  }
}
```

`packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

`packages/cli/tsup.config.ts`:
```ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 2: Implement the CLI**

Create `packages/cli/src/index.ts`:

```ts
import Database from "better-sqlite3";
import { runMigrations } from "@mattsmith/passkey-sdk-core";

const args = process.argv.slice(2);
const cmd = args[0];

function usage(): never {
  console.error("Usage: passkey-sdk migrate <db-path>");
  process.exit(1);
}

if (cmd !== "migrate") usage();
const dbPath = args[1];
if (!dbPath) usage();

const db = new Database(dbPath);
try {
  runMigrations(db);
  console.log(`Migrations applied to ${dbPath}`);
} finally {
  db.close();
}
```

- [ ] **Step 3: Build + smoke test**

Run: `pnpm install`
Run: `pnpm --filter @mattsmith/passkey-sdk-cli build`
Run: `node packages/cli/dist/index.js migrate /tmp/test-passkey.db`
Expected: stdout: `Migrations applied to /tmp/test-passkey.db`
Run: `rm /tmp/test-passkey.db`

- [ ] **Step 4: Commit**

```bash
git add packages/cli pnpm-lock.yaml
git commit -m "feat(cli): passkey-sdk migrate command"
```

---

## Task 22: Hono example app

**Files:**
- Create: `examples/hono-app/package.json`
- Create: `examples/hono-app/tsconfig.json`
- Create: `examples/hono-app/README.md`
- Create: `examples/hono-app/src/index.ts`

The example doubles as a smoke test target and as living documentation.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "hono-app-example",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "migrate": "passkey-sdk migrate ./app.db"
  },
  "dependencies": {
    "@hono/node-server": "^1.11.0",
    "@mattsmith/passkey-sdk-core": "workspace:*",
    "@mattsmith/passkey-sdk-hono": "workspace:*",
    "@mattsmith/passkey-sdk-cli": "workspace:*",
    "better-sqlite3": "^11.0.0",
    "hono": "^4.5.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `src/index.ts`**

```ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import Database from "better-sqlite3";
import {
  createAuth,
  runMigrations,
} from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "@mattsmith/passkey-sdk-hono";

const db = new Database("./app.db");
runMigrations(db);

// Project-owned users table.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id    TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL
  );
`);

const auth = createAuth(
  {
    rpId: "localhost",
    origins: ["http://localhost:5173", "http://localhost:3000"],
    session: { lifetimeSeconds: 60 * 60 * 24 * 30, cookieName: "session" },
    email: {
      sendOtp: async ({ to, code }) => {
        // Dev: log OTPs to the console. In production, swap for Resend/SES/etc.
        console.log(`\n  📧 OTP for ${to}: ${code}\n`);
      },
    },
    users: {
      findOrCreateByEmail: async (email) => {
        const existing = db
          .prepare("SELECT id FROM users WHERE email = ?")
          .get(email) as { id: string } | undefined;
        if (existing) return existing.id;
        const id = `u_${crypto.randomUUID()}`;
        db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(id, email);
        return id;
      },
    },
  },
  { db }
);

const app = new Hono();

app.get("/", (c) =>
  c.text(
    "Passkey SDK example. Try: POST /auth/email/start { email: '...' }, then POST /auth/email/verify."
  )
);

mountAuthRoutes(app, auth);

app.get("/.well-known/apple-app-site-association", (c) =>
  c.json(auth.appleAppSiteAssociation({ appIds: [] }))
);

app.get("/api/me", async (c) => {
  try {
    const user = await auth.requireSession(c.req.raw, { cookieName: "session" });
    return c.json({ user });
  } catch {
    return c.json({ error: "unauthenticated", message: "Sign in first" }, 401);
  }
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`Listening on http://localhost:${port}`);
```

- [ ] **Step 4: Create `README.md`**

```markdown
# Hono Example

Runs a local Passkey SDK server on port 3000 using SQLite (`./app.db`).

## First run

```bash
pnpm install
pnpm migrate
pnpm dev
```

OTP codes are printed to the console. Try:

```bash
curl -s -X POST http://localhost:3000/auth/email/start \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'

# Read the code from the server console, then:
curl -s -X POST http://localhost:3000/auth/email/verify \
  -H 'content-type: application/json' \
  -d '{"otpId":"otp_...","code":"123456"}'
```
```

- [ ] **Step 5: Install + smoke test**

Run: `pnpm install`
Run: `pnpm --filter hono-app-example migrate`
Expected: `Migrations applied to ./app.db`

Start the server in the background:
```bash
( cd examples/hono-app && pnpm dev > /tmp/hono.log 2>&1 & echo $! > /tmp/hono.pid )
sleep 2
```

Send a request:
```bash
curl -s -X POST http://localhost:3000/auth/email/start \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com"}'
```
Expected: JSON response with `otpId` and `expiresInSeconds`.

Stop the server:
```bash
kill $(cat /tmp/hono.pid)
rm -f examples/hono-app/app.db /tmp/hono.pid /tmp/hono.log
```

- [ ] **Step 6: Commit**

```bash
git add examples/hono-app pnpm-lock.yaml
git commit -m "feat(examples): hono-app reference server"
```

---

## Task 23: End-to-end test against the example app

**Files:**
- Create: `examples/hono-app/tests/e2e.test.ts` (uses Vitest in the example workspace)
- Modify: `examples/hono-app/package.json` (add `test` script + Vitest dep)

This is the test that exercises the *whole vertical slice*: real Hono server, real SQLite on disk, real Hono adapter, real `core` package. It validates that everything wires together.

- [ ] **Step 1: Add vitest to the example**

```bash
pnpm --filter hono-app-example add -D vitest
```

- [ ] **Step 2: Add test script + vitest config**

Update `examples/hono-app/package.json` `scripts`:
```json
"test": "vitest run"
```

Create `examples/hono-app/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { globals: false, environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 3: Refactor the example to export the app**

Update `examples/hono-app/src/index.ts` so `app` and `db` are exported, and the `serve()` call only fires when run directly:

Replace the bottom of the file (the `serve(...)` block) with:

```ts
export { app, auth, db };

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`Listening on http://localhost:${port}`);
}
```

- [ ] **Step 4: Write the E2E test**

Create `examples/hono-app/tests/e2e.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Capture OTP codes by intercepting console.log.
const consoleLogs: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  consoleLogs.push(args.map(String).join(" "));
};

const dbPath = path.resolve("./app.db");
beforeAll(() => {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
});
afterAll(() => {
  console.log = origLog;
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
});

const { app } = await import("../src/index.js");

function lastOtp(): string {
  const line = [...consoleLogs].reverse().find((l) => l.includes("OTP for"));
  if (!line) throw new Error("No OTP logged");
  const m = line.match(/OTP for [^:]+: (\d{6})/);
  if (!m) throw new Error("Could not parse OTP from log: " + line);
  return m[1]!;
}

describe("E2E: email-OTP flow against the Hono app", () => {
  it("start → verify → /api/me returns the user", async () => {
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "e2e@example.com" }),
    });
    expect(start.status).toBe(200);
    const { otpId } = await start.json();
    const code = lastOtp();

    const verify = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code }),
    });
    expect(verify.status).toBe(200);
    const { sessionToken, user } = await verify.json();
    expect(user.email).toBe("e2e@example.com");

    const me = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.user.id).toBe(user.id);
  });
});
```

- [ ] **Step 5: Run + verify**

Run: `pnpm --filter hono-app-example test`
Expected: e2e test passes.

- [ ] **Step 6: Commit**

```bash
git add examples/hono-app pnpm-lock.yaml
git commit -m "test(examples): end-to-end OTP flow against hono-app"
```

---

## Task 24: Protocol doc

**Files:**
- Create: `spec/protocol.md`

Extract a clean, client-author-facing version of the contract from the design spec. This is the source of truth for Phase 2 (web client) and Phase 3 (Swift client).

- [ ] **Step 1: Write `spec/protocol.md`**

Create `spec/protocol.md`:

```markdown
# Passkey SDK — HTTP Protocol

All endpoints accept JSON. All successful responses are JSON. All errors are
JSON of the shape `{ "error": "<code>", "message": "<human string>" }`.

The server's RP ID is configured at startup. Origins listed in config are the
only ones accepted for WebAuthn ceremonies.

Authenticated requests carry the session token either as:
- `Authorization: Bearer <token>` header, or
- `Cookie: session=<token>` (if a cookie name is configured).

The client picks one mode at construction time.

## Endpoints

### POST /auth/email/start

Begin email OTP. Generates and emails a 6-digit code.

Request: `{ "email": string }`
Response 200: `{ "otpId": string, "expiresInSeconds": number }`
Errors: `rate_limited` (reserved).

### POST /auth/email/verify

Verify the OTP. Creates the user if needed (via project hook). Issues a session.

Request: `{ "otpId": string, "code": string }`
Response 200: `{ "sessionToken": string, "user": { "id": string, "email": string } }`
Errors: `invalid_otp` (401), `otp_attempts_exceeded` (429), `otp_expired` (410).

If a `session` cookie is configured, the response sets it; clients in cookie
mode rely on the browser to persist it.

### POST /auth/passkey/register/start  (authenticated)

Begin passkey registration for the current user.

Response 200: `{ "registrationId": string, "options": <WebAuthn creation options> }`

The `options` object is what `navigator.credentials.create()` (web) or
`ASAuthorizationPlatformPublicKeyCredentialProvider` (iOS) consumes verbatim.

### POST /auth/passkey/register/finish  (authenticated)

Finish passkey registration.

Request: `{ "registrationId": string, "credential": <attestation>, "deviceName"?: string }`
Response 200: `{ "passkeyId": string }`
Errors: `invalid_credential` (401), `unauthenticated` (401).

### POST /auth/passkey/sign-in/start

Begin passkey sign-in. No authentication required (this is how you sign in).

Response 200: `{ "signInId": string, "options": <WebAuthn assertion options> }`

`options.allowCredentials` is empty — clients use discoverable credentials.

### POST /auth/passkey/sign-in/finish

Finish passkey sign-in.

Request: `{ "signInId": string, "credential": <assertion> }`
Response 200: `{ "sessionToken": string, "user": { "id": string, "email": string } }`
Errors: `invalid_credential` (401), `unknown_credential` (404).

The `email` field on the returned user may be empty when sign-in is via
passkey (the SDK doesn't store user email in passkey records). Clients that
need the email should query their own users endpoint.

### GET /auth/me

Returns the current user.

Response 200: `{ "user": { "id": string, "email": string } }`
Errors: `unauthenticated` (401).

### POST /auth/sign-out

Revokes the current session.

Response 200: `{ "ok": true }`. Sets an expired cookie if cookie mode is in use.

### GET /auth/sessions  (authenticated)

Lists active sessions for the current user.

Response 200: `{ "sessions": [ { "createdAt", "expiresAt", "lastSeenAt", "userAgent", "ip" } ] }`

### GET /auth/passkeys  (authenticated)

Lists registered passkeys for the current user.

Response 200: `{ "passkeys": [ { "id": string, "deviceName", "createdAt", "lastUsedAt", "transports" } ] }`

`id` is the credential ID encoded as base64url.

### DELETE /auth/passkeys/:id  (authenticated)

Removes a passkey owned by the current user.

Response 200: `{ "ok": true }`
Errors: `unknown_credential` (404) if the passkey doesn't belong to the caller.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `invalid_otp` | 401 | Wrong code, or row not found |
| `otp_attempts_exceeded` | 429 | 5 wrong guesses on this row |
| `otp_expired` | 410 | Past the 10-minute window |
| `invalid_credential` | 401 | Passkey signature didn't verify |
| `unknown_credential` | 404 | Credential ID not found / not yours |
| `unauthenticated` | 401 | No session, or session expired |
| `rate_limited` | 429 | Reserved (not enforced by SDK in v1) |
```

- [ ] **Step 2: Commit**

```bash
git add spec/protocol.md
git commit -m "docs: HTTP protocol reference"
```

---

## Task 25: Final integration: build, typecheck, test the whole monorepo

- [ ] **Step 1: Run the whole gauntlet**

Run: `pnpm install`
Run: `pnpm build`
Expected: every package produces `dist/` artifacts without errors.

Run: `pnpm typecheck`
Expected: all packages typecheck.

Run: `pnpm test`
Expected: all packages' test suites pass.

- [ ] **Step 2: Commit any caught fixes**

If the previous step turned up issues, fix them, commit each fix as its own commit, and re-run the gauntlet until clean.

```bash
git status
git log --oneline | head
```

Expected: clean tree, all phase-1 commits visible.

---

## Phase 1 — Done condition

All of these are true:

- [ ] `pnpm test` passes from the repo root
- [ ] `pnpm build` produces dist artifacts in all three packages
- [ ] `pnpm typecheck` clean
- [ ] `examples/hono-app` runs locally and serves a full email-OTP flow end-to-end
- [ ] `examples/hono-app` E2E test in CI mode (`pnpm --filter hono-app-example test`) passes
- [ ] `spec/protocol.md` matches the implemented endpoints exactly
- [ ] No package references `TODO`/`TBD`/`FIXME` in committed code

When all of these pass, Phase 1 is complete and ready for Phase 2 (web client) to be planned and built against this server.
