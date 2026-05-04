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

const lastOtps = new Map<string, string>();

const auth = createAuth(
  {
    rpId: "localhost",
    origins: ["http://localhost:5173", "http://localhost:3000"],
    session: { lifetimeSeconds: 60 * 60 * 24 * 30, cookieName: "session" },
    email: {
      sendOtp: async ({ to, code }) => {
        // Dev: log OTPs to the console. In production, swap for Resend/SES/etc.
        console.log(`\n  📧 OTP for ${to}: ${code}\n`);
        lastOtps.set(to, code);
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

export { app, auth, db };

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`Listening on http://localhost:${port}`);
}
