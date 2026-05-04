import { describe, it, expect, beforeEach } from "vitest";
import { cleanup } from "../src/cleanup.js";
import { insertSession } from "../src/storage/sessions.js";
import { insertOtp } from "../src/storage/otps.js";
import { createHarness, type Harness } from "./setup.js";

describe("cleanup", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("removes expired sessions and OTPs, leaves live ones", () => {
    h.clock.now = 1000;
    insertSession(h.db, {
      tokenHash: new Uint8Array(32).fill(1), userId: "u_1",
      createdAt: 100, expiresAt: 500, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: new Uint8Array(32).fill(2), userId: "u_1",
      createdAt: 100, expiresAt: 5000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertOtp(h.db, {
      id: "otp_old", email: "x@y", codeHash: new Uint8Array(32),
      attempts: 0, createdAt: 100, expiresAt: 500, consumedAt: null,
    });
    insertOtp(h.db, {
      id: "otp_new", email: "x@y", codeHash: new Uint8Array(32),
      attempts: 0, createdAt: 100, expiresAt: 5000, consumedAt: null,
    });

    const removed = cleanup({ db: h.db, deps: h.deps });
    expect(removed.sessions).toBe(1);
    expect(removed.otps).toBe(1);
  });
});
