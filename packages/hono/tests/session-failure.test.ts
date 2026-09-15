import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { createAuth, runMigrations } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "../src/index.js";

for (const failure of ["touch", "lookup"] as const) describe(`session ${failure} failure`, () => {
  it("returns retryable errors across authenticated routes and keeps the session for retry", async () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      let code = "";
      const auth = createAuth({ rpId: "example.com", origins: ["https://example.com"], session: { lifetimeSeconds: 3600, cookieName: "session" }, email: { sendOtp: async (mail) => { code = mail.code; } }, users: { findOrCreateByEmail: async () => "user" } }, { db });
      const otp = await auth.startEmailOtp({ email: "user@example.com" });
      const signed = await auth.verifyEmailOtp({ otpId: otp.otpId, code });
      const app = new Hono(); mountAuthRoutes(app, auth);
      if (failure === "touch") db.exec("CREATE TRIGGER fail_touch BEFORE UPDATE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'synthetic touch failure'); END");
      else db.exec("ALTER TABLE auth_sessions RENAME TO saved_sessions");
      for (const mode of ["bearer", "cookie"] as const) {
      for (const [method, path] of [["GET", "/auth/me"], ["GET", "/auth/sessions"], ["GET", "/auth/passkeys"], ["DELETE", "/auth/passkeys/AA"], ["POST", "/auth/passkey/register/start"], ["POST", "/auth/passkey/register/finish"]] as const) {
        const res = await app.request(path, { method, headers: mode === "bearer" ? { authorization: `Bearer ${signed.sessionToken}` } : { cookie: `session=${signed.sessionToken}; csrf=matching`, "x-csrf-token": "matching" } });
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "session_unavailable", message: "Session temporarily unavailable" });
        expect(res.headers.get("retry-after")).toBe("1");
        expect(res.headers.get("set-cookie")).toBeNull();
      }
      }
      if (failure === "touch") db.exec("DROP TRIGGER fail_touch");
      else db.exec("ALTER TABLE saved_sessions RENAME TO auth_sessions");
      const retry = await app.request("/auth/me", { headers: { authorization: `Bearer ${signed.sessionToken}` } });
      expect(retry.status).toBe(200);
      const invalid = await app.request("/auth/me", { headers: { authorization: "Bearer invalid" } });
      expect(invalid.status).toBe(401);
      expect(invalid.headers.get("retry-after")).toBeNull();
    } finally { db.close(); }
  });
});
