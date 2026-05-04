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

  it("session cookie is not Secure on plain HTTP", async () => {
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
    const setCookie = verify.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(/;\s*Secure/);
  });

  it("session and csrf cookies are Secure when X-Forwarded-Proto is https", async () => {
    const { app, sentOtps } = buildApp();
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ email: "matt@example.com" }),
    });
    const { otpId } = await start.json();
    const verify = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ otpId, code: sentOtps[0]!.code }),
    });
    const setCookie = verify.headers.get("set-cookie") ?? "";
    // Both session and csrf cookies should carry Secure
    expect(setCookie.match(/Secure/g)?.length).toBe(2);
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
