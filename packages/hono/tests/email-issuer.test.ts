import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { createAuth, runMigrations, defaultDeps, AuthError, type EmailSignIn } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "../src/index.js";

describe("host email issuer on mounted route", () => {
  for (const mode of ["success", "failure", "rejection", "empty", "invalid"] as const) {
    it(mode, async () => {
      const db = new Database(":memory:");
      try {
        runMigrations(db);
        let calls = 0;
        const signIn: EmailSignIn = async (input) => {
          calls++;
          expect(input).toMatchObject({ otpId: "pending", code: "123456", lifetimeSeconds: 3600, maxAttempts: 5, userAgent: "test-agent", ip: "192.0.2.1" });
          expect(input.now()).toBe(1700000000);
          if (mode === "failure") throw new Error("synthetic commit failure");
          if (mode === "rejection") throw new AuthError("otp_expired", "expired");
          if (mode === "empty") return { sessionToken: "", user: { id: "", email: "" } };
          return { sessionToken: "committed-token", user: { id: "user", email: "user@example.com" } };
        };
        const auth = createAuth({
          rpId: "example.com", origins: ["https://example.com"],
          session: { lifetimeSeconds: 3600, cookieName: "session" },
          email: { sendOtp: async () => {}, signIn },
          users: { findOrCreateByEmail: async () => { throw new Error("legacy resolver called"); } },
        }, { db, deps: { ...defaultDeps, now: () => 1700000000 } });
        // No OTP exists. Any accidental legacy verification would return 401.
        const app = new Hono(); mountAuthRoutes(app, auth);
        const res = await app.request("/auth/email/verify", {
          method: "POST", headers: { "content-type": "application/json", "user-agent": "test-agent", "x-forwarded-for": "192.0.2.1" },
          body: JSON.stringify({ otpId: "pending", code: mode === "invalid" ? "abc" : "123456" }),
        });
        expect(res.status).toBe(mode === "success" ? 200 : mode === "invalid" ? 400 : mode === "rejection" ? 410 : 500);
        expect(calls).toBe(mode === "invalid" ? 0 : 1);
        if (mode === "success") {
          expect(await res.json()).toEqual({ sessionToken: "committed-token", user: { id: "user", email: "user@example.com" } });
          expect(res.headers.get("set-cookie")).toContain("session=committed-token");
          expect(res.headers.get("set-cookie")).toContain("csrf=");
        } else expect(res.headers.get("set-cookie")).toBeNull();
        expect(db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get()).toEqual({ n: 0 });
      } finally { db.close(); }
    });
  }
});
