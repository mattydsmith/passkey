import Database from "better-sqlite3";
import { runMigrations } from "../src/migrate.js";
import type { Deps } from "../src/deps.js";
import type { SendOtp, FindOrCreateByEmail } from "../src/types.js";

/** Mutable clock — set via `clock.now = X` to control time in tests. */
export interface FakeClock {
  now: number;
}

export interface Harness {
  db: Database.Database;
  clock: FakeClock;
  deps: Deps;
  /** Captures every OTP email send. */
  sentOtps: { to: string; code: string }[];
  sendOtp: SendOtp;
  /** In-memory user table keyed by email. */
  users: Map<string, string>;
  findOrCreateByEmail: FindOrCreateByEmail;
}

export function createHarness(): Harness {
  const db = new Database(":memory:");
  runMigrations(db);

  const clock: FakeClock = { now: 1_700_000_000 };

  // Deterministic-but-distinct ID/byte generation for tests.
  let idCounter = 0;
  let byteCounter = 0;

  const deps: Deps = {
    now: () => clock.now,
    randomBytes: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (byteCounter++) & 0xff;
      return out;
    },
    randomId: (prefix) => `${prefix}_test${++idCounter}`,
  };

  const sentOtps: { to: string; code: string }[] = [];
  const sendOtp: SendOtp = async (args) => {
    sentOtps.push(args);
  };

  const users = new Map<string, string>();
  const findOrCreateByEmail: FindOrCreateByEmail = async (email) => {
    const existing = users.get(email);
    if (existing) return existing;
    const id = `u_${users.size + 1}`;
    users.set(email, id);
    return id;
  };

  return { db, clock, deps, sentOtps, sendOtp, users, findOrCreateByEmail };
}
