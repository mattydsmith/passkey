// Adapter contract: real session authentication, stubbed core finish. Core
// tests exercise owner binding; Go tests verify real synthetic attestations.
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { createAuth, runMigrations } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "../src/index.js";

describe("registration finish authenticated owner", () => {
  for (const mode of ["bearer", "cookie"]) {
    it(mode, async () => {
      const db = new Database(":memory:");
      try {
        runMigrations(db);
        let code = "";
        const auth = createAuth({
          rpId: "example.com", origins: ["https://example.com"],
          session: { lifetimeSeconds: 3600, cookieName: "session" },
          email: { sendOtp: async (otp) => { code = otp.code; } },
          users: { findOrCreateByEmail: async () => "authenticated-owner" },
        }, { db });
        const app = new Hono();
        mountAuthRoutes(app, auth);
        const request = (path: string, body: unknown, headers = {}) => app.request(path, {
          method: "POST", headers: {"content-type": "application/json", ...headers}, body: JSON.stringify(body),
        });
        const started = await request("/auth/email/start", { email: "owner@example.com" });
        const { otpId } = await started.json();
        const signedIn = await request("/auth/email/verify", { otpId, code });
        expect(signedIn.status).toBe(200);
        const { sessionToken } = await signedIn.json();
        const finish = vi.spyOn(auth, "finishPasskeyRegistration").mockResolvedValue({ passkeyId: "synthetic" });
        const headers = mode === "cookie"
          ? { cookie: `session=${sessionToken}; csrf=synthetic-csrf`, "x-csrf-token": "synthetic-csrf" }
          : { authorization: `Bearer ${sessionToken}` };
        const body = { registrationId: "pending", credential: {}, userId: "body-spoofed-owner" };
        const result = await request("/auth/passkey/register/finish", body, headers);
        expect(result.status).toBe(200);
        expect(finish).toHaveBeenCalledWith(expect.objectContaining({ userId: "authenticated-owner", registrationId: "pending" }));
        expect(finish.mock.calls[0]![0].request?.url).toBe("http://localhost/auth/passkey/register/finish");
        expect(finish.mock.calls[0]![0].request?.bodyUsed).toBe(true);
        finish.mockClear();
        const denied = await request("/auth/passkey/register/finish", body);
        expect(denied.status).toBe(401);
        expect(finish).not.toHaveBeenCalled();
      } finally { db.close(); }
    });
  }
});
