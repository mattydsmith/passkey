import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/migrate.js";
import { bumpSessionLastSeen } from "../src/storage/sessions.js";
import { AuthError, SessionUnavailableError } from "../src/errors.js";

it("refuses a session that disappeared before its last-seen update", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db);
    try { bumpSessionLastSeen(db, new Uint8Array([1]), 1700000000); throw new Error("missing session accepted"); }
    catch (error) { expect(AuthError.is(error, "unauthenticated")).toBe(true); }
  } finally { db.close(); }
});
it("retains local diagnostic cause without putting it in the response", () => {
  const cause = new Error("private storage detail");
  const error = new SessionUnavailableError("touch", cause);
  expect(error.cause).toBe(cause);
  expect(error.operation).toBe("touch");
  expect(error.toJSON()).toEqual({ error: "session_unavailable", message: "Session temporarily unavailable" });
});
