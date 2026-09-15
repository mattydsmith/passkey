import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations, createOtpInTransaction, invalidateOtpsInTransaction, createAuth, defaultDeps } from "../src/index.js";

describe("host OTP transaction", () => {
  for (const mode of ["rollback", "commit_failure", "commit"] as const) {
    it(mode, () => {
      const db = new Database(":memory:");
      try {
        runMigrations(db);
        db.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE marker(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)");
        db.transaction(() => createOtpInTransaction(db, { id: "older", email: "user@example.com", codeHash: new Uint8Array([9]), attempts: 0, createdAt: 1699999900, expiresAt: 1700000060 })).immediate();
        db.transaction(() => {
          createOtpInTransaction(db, { id: "other-address", email: "other@example.com", codeHash: new Uint8Array([8]), attempts: 0, createdAt: 1699999900, expiresAt: 1700000060 });
          createOtpInTransaction(db, { id: "consumed", email: "user@example.com", codeHash: new Uint8Array([8]), attempts: 0, createdAt: 1699999900, expiresAt: 1700000060 });
          db.prepare("UPDATE auth_email_otps SET consumed_at=1699999950 WHERE id='consumed'").run();
        }).immediate();
        const operation = db.transaction(() => {
          expect(invalidateOtpsInTransaction(db, "user@example.com", 1700000000)).toBe(1);
          createOtpInTransaction(db, { id: "host-otp", email: "user@example.com", codeHash: new Uint8Array([1,2,3]), attempts: 0, createdAt: 1700000000, expiresAt: 1700000060 });
          db.exec("INSERT INTO marker VALUES(1)");
          if (mode === "rollback") throw new Error("synthetic rollback");
          if (mode === "commit") db.exec("INSERT INTO parent VALUES(1)");
        });
        if (mode === "commit") operation.immediate(); else expect(() => operation.immediate()).toThrow();
        const expected = { n: mode === "commit" ? 1 : 0 };
        expect(db.prepare("SELECT count(*) AS n FROM auth_email_otps").get()).toEqual({ n: mode === "commit" ? 4 : 3 });
        expect(db.prepare("SELECT consumed_at AS consumed FROM auth_email_otps WHERE id='older'").get()).toEqual({ consumed: mode === "commit" ? 1700000000 : null });
        expect(db.prepare("SELECT consumed_at AS consumed FROM auth_email_otps WHERE id='other-address'").get()).toEqual({ consumed: null });
        expect(db.prepare("SELECT consumed_at AS consumed FROM auth_email_otps WHERE id='consumed'").get()).toEqual({ consumed: 1699999950 });
        expect(db.prepare("SELECT count(*) AS n FROM marker").get()).toEqual(expected);
      } finally { db.close(); }
    });
  }
  it("requires an explicit transaction", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      expect(() => invalidateOtpsInTransaction(db,"user@example.com",100)).toThrow("requires transaction");
      expect(() => createOtpInTransaction(db, { id: "x", email: "x@example.com", codeHash: new Uint8Array(), attempts: 0, createdAt: 1, expiresAt: 2 })).toThrow("requires transaction");
      expect(db.prepare("SELECT count(*) AS n FROM auth_email_otps").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });
  it("supports direct host start without invented transport metadata", async () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db);
      const auth = createAuth({ rpId: "example.com", origins: ["https://example.com"], session: { lifetimeSeconds: 600 }, email: {
        sendOtp: async () => { throw new Error("default sender must not run"); },
        start: async (input) => { expect(input.request).toBeUndefined(); expect(input.email).toBe("user@example.com"); expect(input.now()).toBe(100); return { otpId: "direct-host" }; },
      }, users: { findOrCreateByEmail: async () => "unused" } }, { db, deps: { ...defaultDeps, now: () => 100 } });
      expect(await auth.startEmailOtp({ email: " USER@EXAMPLE.COM " })).toEqual({ otpId: "direct-host", expiresInSeconds: 600 });
    } finally { db.close(); }
  });
});
