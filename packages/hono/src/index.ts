import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { AuthError, type Auth } from "@mattsmith/passkey-sdk-core";
import { csrfMiddleware } from "./csrf.js";

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
  csrf?: boolean;            // default: true when cookieName is configured
  csrfCookieName?: string;   // default: "csrf"
}

function errorResponse(c: any, err: unknown) {
  if (err instanceof z.ZodError) {
    return c.json({ error: "invalid_request", message: err.message }, 400);
  }
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
  const sessionLifetime = auth.config.session.lifetimeSeconds;
  const cookieName = auth.config.session.cookieName ?? "session";
  const csrfCookieName = opts.csrfCookieName ?? "csrf";
  const csrfEnabled = (opts.csrf ?? true) && Boolean(auth.config.session.cookieName);

  if (csrfEnabled) {
    app.use(`${prefix}/*`, csrfMiddleware({
      sessionCookieName: cookieName,
      csrfCookieName,
    }));
  }

  function setCsrfCookie(c: any) {
    const token = randomBytes(32).toString("base64url");
    const parts = [
      `${csrfCookieName}=${token}`,
      `Path=/`,
      `Max-Age=${sessionLifetime}`,
      `SameSite=Lax`,
    ];
    c.header("set-cookie", parts.join("; "), { append: true });
    return token;
  }

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
      const ua = c.req.header("user-agent");
      const ip = c.req.header("x-forwarded-for");
      const result = await auth.verifyEmailOtp({
        otpId: parsed.otpId,
        code: parsed.code,
        ...(ua !== undefined ? { userAgent: ua } : {}),
        ...(ip !== undefined ? { ip } : {}),
      });
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      if (csrfEnabled) setCsrfCookie(c);
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
        ...(parsed.deviceName !== undefined ? { deviceName: parsed.deviceName } : {}),
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
      const siUa = c.req.header("user-agent");
      const siIp = c.req.header("x-forwarded-for");
      const result = await auth.finishPasskeySignIn({
        signInId: parsed.signInId,
        credential: parsed.credential as any,
        ...(siUa !== undefined ? { userAgent: siUa } : {}),
        ...(siIp !== undefined ? { ip: siIp } : {}),
      });
      setSessionCookie(c, result.sessionToken, sessionLifetime, cookieName);
      if (csrfEnabled) setCsrfCookie(c);
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
      if (csrfEnabled) {
        c.header("set-cookie", `${csrfCookieName}=; Path=/; Max-Age=0; SameSite=Lax`, { append: true });
      }
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
