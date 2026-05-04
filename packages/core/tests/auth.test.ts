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
    expect(user.id).toBe("u_1");
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
    expect(user.id).toBe("u_1");
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
