import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/migrate.js";

describe("runMigrations", () => {
  it("creates all expected tables", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("auth_passkeys");
    expect(names).toContain("auth_sessions");
    expect(names).toContain("auth_email_otps");
    expect(names).toContain("auth_migrations");
  });

  it("is idempotent — running twice doesn't throw", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    const count = db
      .prepare("SELECT COUNT(*) as c FROM auth_migrations")
      .get() as { c: number };
    expect(count.c).toBe(1); // 001 only, recorded once
  });

  it("records each migration in auth_migrations", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const rows = db.prepare("SELECT filename FROM auth_migrations").all() as {
      filename: string;
    }[];
    expect(rows.map((r) => r.filename)).toEqual(["001_init.sql"]);
  });
});
