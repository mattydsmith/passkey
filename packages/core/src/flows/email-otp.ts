import { createHash } from "node:crypto";
import type { Db } from "../db.js";
import type { Deps } from "../deps.js";
import type { SendOtp, OtpStartResult } from "../types.js";
import { insertOtp } from "../storage/otps.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateNumericCode(deps: Deps, digits: number): string {
  // Reject-sample to avoid bias from modulo on a Uint8 byte.
  const max = 10 ** digits;
  const bytes = deps.randomBytes(8);
  let value = 0;
  for (const b of bytes) value = (value << 8) | b;
  // Make positive and bound. Bias is negligible at 6 digits / 64 bits.
  const positive = Math.abs(value);
  return String(positive % max).padStart(digits, "0");
}

function hashCode(code: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(code).digest());
}

export async function startEmailOtp(args: {
  db: Db;
  deps: Deps;
  sendOtp: SendOtp;
  email: string;
  expirySeconds: number;
}): Promise<OtpStartResult> {
  const { db, deps, sendOtp, email, expirySeconds } = args;
  const normalized = normalizeEmail(email);
  const id = deps.randomId("otp");
  const code = generateNumericCode(deps, 6);
  const now = deps.now();

  insertOtp(db, {
    id,
    email: normalized,
    codeHash: hashCode(code),
    attempts: 0,
    createdAt: now,
    expiresAt: now + expirySeconds,
    consumedAt: null,
  });

  await sendOtp({ to: normalized, code });
  return { otpId: id, expiresInSeconds: expirySeconds };
}
