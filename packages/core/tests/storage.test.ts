import { describe, it, expect, beforeEach } from "vitest";
import {
  insertSession,
  getSessionByTokenHash,
  bumpSessionLastSeen,
  deleteSessionByTokenHash,
  listSessionsByUser,
  deleteExpiredSessions,
} from "../src/storage/sessions.js";
import { createHarness, type Harness } from "./setup.js";

describe("storage/sessions", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  const tokenHash = (n: number) => new Uint8Array(32).fill(n);

  it("inserts and reads back a session", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(1),
      userId: "u_1",
      createdAt: 100,
      expiresAt: 1000,
      lastSeenAt: 100,
      userAgent: "test-ua",
      ip: "127.0.0.1",
    });
    const row = getSessionByTokenHash(h.db, tokenHash(1));
    expect(row).toBeDefined();
    expect(row!.userId).toBe("u_1");
    expect(row!.expiresAt).toBe(1000);
    expect(row!.userAgent).toBe("test-ua");
  });

  it("returns undefined for missing token", () => {
    expect(getSessionByTokenHash(h.db, tokenHash(99))).toBeUndefined();
  });

  it("bumpSessionLastSeen updates lastSeenAt", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(2), userId: "u_1",
      createdAt: 100, expiresAt: 1000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    bumpSessionLastSeen(h.db, tokenHash(2), 500);
    expect(getSessionByTokenHash(h.db, tokenHash(2))!.lastSeenAt).toBe(500);
  });

  it("deleteSessionByTokenHash removes the row", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(3), userId: "u_1",
      createdAt: 100, expiresAt: 1000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    deleteSessionByTokenHash(h.db, tokenHash(3));
    expect(getSessionByTokenHash(h.db, tokenHash(3))).toBeUndefined();
  });

  it("listSessionsByUser returns all sessions for that user", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(4), userId: "u_a",
      createdAt: 100, expiresAt: 1000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: tokenHash(5), userId: "u_a",
      createdAt: 200, expiresAt: 2000, lastSeenAt: 200,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: tokenHash(6), userId: "u_b",
      createdAt: 300, expiresAt: 3000, lastSeenAt: 300,
      userAgent: null, ip: null,
    });
    expect(listSessionsByUser(h.db, "u_a")).toHaveLength(2);
    expect(listSessionsByUser(h.db, "u_b")).toHaveLength(1);
    expect(listSessionsByUser(h.db, "u_nope")).toHaveLength(0);
  });

  it("deleteExpiredSessions removes sessions with expires_at <= cutoff", () => {
    insertSession(h.db, {
      tokenHash: tokenHash(7), userId: "u_a",
      createdAt: 100, expiresAt: 200, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    insertSession(h.db, {
      tokenHash: tokenHash(8), userId: "u_a",
      createdAt: 100, expiresAt: 5000, lastSeenAt: 100,
      userAgent: null, ip: null,
    });
    const removed = deleteExpiredSessions(h.db, 1000);
    expect(removed).toBe(1);
    expect(getSessionByTokenHash(h.db, tokenHash(7))).toBeUndefined();
    expect(getSessionByTokenHash(h.db, tokenHash(8))).toBeDefined();
  });
});
