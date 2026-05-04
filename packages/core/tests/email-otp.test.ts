import { describe, it, expect, beforeEach } from "vitest";
import { startEmailOtp, verifyEmailOtp } from "../src/flows/email-otp.js";
import { AuthError } from "../src/errors.js";
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
    expect(result.id).toBe("u_1");
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
