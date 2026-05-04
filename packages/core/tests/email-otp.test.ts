import { describe, it, expect, beforeEach } from "vitest";
import { startEmailOtp } from "../src/flows/email-otp.js";
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
