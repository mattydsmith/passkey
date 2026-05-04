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
