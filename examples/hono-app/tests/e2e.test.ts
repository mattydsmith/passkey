import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Capture OTP codes by intercepting console.log.
const consoleLogs: string[] = [];
const origLog = console.log;
console.log = (...args: unknown[]) => {
  consoleLogs.push(args.map(String).join(" "));
};

const dbPath = path.resolve("./app.db");

// Clean up any stale DB before importing the module (which opens the DB).
if (fs.existsSync(dbPath)) fs.rmSync(dbPath);

afterAll(() => {
  console.log = origLog;
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
});

const { app } = await import("../src/index.js");

function lastOtp(): string {
  const line = [...consoleLogs].reverse().find((l) => l.includes("OTP for"));
  if (!line) throw new Error("No OTP logged");
  const m = line.match(/OTP for [^:]+: (\d{6})/);
  if (!m) throw new Error("Could not parse OTP from log: " + line);
  return m[1]!;
}

describe("E2E: email-OTP flow against the Hono app", () => {
  it("start → verify → /api/me returns the user", async () => {
    const start = await app.request("/auth/email/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "e2e@example.com" }),
    });
    expect(start.status).toBe(200);
    const { otpId } = await start.json();
    const code = lastOtp();

    const verify = await app.request("/auth/email/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otpId, code }),
    });
    expect(verify.status).toBe(200);
    const { sessionToken, user } = await verify.json();
    expect(user.email).toBe("e2e@example.com");

    const me = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.user.id).toBe(user.id);
  });
});
