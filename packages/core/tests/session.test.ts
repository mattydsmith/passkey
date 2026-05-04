import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  validateAndBumpSession,
  revokeSession,
  listSessionsForUser,
} from "../src/session.js";
import { AuthError } from "../src/errors.js";
import { createHarness, type Harness } from "./setup.js";

const SESSION_LIFETIME = 60 * 60 * 24 * 30;

describe("session lifecycle", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("createSession returns a token and stores a row", async () => {
    const { sessionToken } = await createSession({
      db: h.db,
      deps: h.deps,
      userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME,
      userAgent: "ua",
      ip: "1.2.3.4",
    });
    expect(sessionToken).toMatch(/^tok_/);
    const sessions = listSessionsForUser(h.db, "u_1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.userAgent).toBe("ua");
  });

  it("token cannot be reconstructed from DB", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME, userAgent: null, ip: null,
    });
    const stored = listSessionsForUser(h.db, "u_1")[0]!;
    // The stored hash must not equal the raw token bytes.
    expect(Buffer.from(stored.tokenHash).toString("hex")).not.toBe(sessionToken);
  });

  it("validateAndBumpSession returns the user and bumps lastSeenAt", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME, userAgent: null, ip: null,
    });
    h.clock.now += 100;
    const result = validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken });
    expect(result.userId).toBe("u_1");
    const stored = listSessionsForUser(h.db, "u_1")[0]!;
    expect(stored.lastSeenAt).toBe(h.clock.now);
  });

  it("validateAndBumpSession throws unauthenticated for unknown token", () => {
    expect(() =>
      validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken: "tok_nope" })
    ).toThrow(AuthError);
    try {
      validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken: "tok_nope" });
    } catch (e) {
      expect(AuthError.is(e, "unauthenticated")).toBe(true);
    }
  });

  it("validateAndBumpSession throws unauthenticated for expired token", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: 100, userAgent: null, ip: null,
    });
    h.clock.now += 200;
    expect(() =>
      validateAndBumpSession({ db: h.db, deps: h.deps, sessionToken })
    ).toThrow(/unauthenticated/i);
  });

  it("revokeSession deletes the row", async () => {
    const { sessionToken } = await createSession({
      db: h.db, deps: h.deps, userId: "u_1",
      lifetimeSeconds: SESSION_LIFETIME, userAgent: null, ip: null,
    });
    revokeSession({ db: h.db, sessionToken });
    expect(listSessionsForUser(h.db, "u_1")).toHaveLength(0);
  });
});
