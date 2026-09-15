import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { createAuth, runMigrations, defaultDeps, type EmailStart } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "../src/index.js";

describe("host email start on the mounted route", () => {
  for (const mode of ["success", "error", "empty", "whitespace", "invalid"] as const) {
    it(mode, async () => {
      const db = new Database(":memory:");
      try {
        runMigrations(db);
        let calls = 0, sends = 0;
        const start: EmailStart = async (input) => {
          calls++;
          expect(input.email).toBe("user@example.com");
          expect(input.expirySeconds).toBe(900);
          expect(input.now()).toBe(1700000000);
          expect(input.request?.headers.get("x-forwarded-for")).toBe("untrusted");
          if (mode === "error") throw new Error("synthetic reservation failure");
          return { otpId: mode === "empty" ? "" : mode === "whitespace" ? "  " : "opaque-host-id" };
        };
        const auth = createAuth({
          rpId: "example.com", origins: ["https://example.com"],
          session: { lifetimeSeconds: 3600, cookieName: "session" }, otp: { expirySeconds: 900 },
          email: { start, sendOtp: async () => { sends++; } },
          users: { findOrCreateByEmail: async () => { throw new Error("unexpected resolver"); } },
        }, { db, deps: { ...defaultDeps, now: () => 1700000000 } });
        const app = new Hono(); mountAuthRoutes(app, auth);
        const res = await app.request("/auth/email/start", {
          method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "untrusted" },
          body: JSON.stringify({ email: mode === "invalid" ? "not-an-email" : " USER@EXAMPLE.COM " }),
        });
        expect(res.status).toBe(mode === "success" ? 200 : mode === "invalid" ? 400 : 500);
        expect(calls).toBe(mode === "invalid" ? 0 : 1);
        expect(sends).toBe(0);
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(db.prepare("SELECT COUNT(*) AS n FROM auth_email_otps").get()).toEqual({ n: 0 });
        if (mode === "success") expect(await res.json()).toEqual({ otpId: "opaque-host-id", expiresInSeconds: 900 });
      } finally { db.close(); }
    });
  }
});
