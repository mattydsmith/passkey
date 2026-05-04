import type { Db } from "../db.js";
import type { OtpRecord } from "../types.js";

interface Row {
  id: string;
  email: string;
  code_hash: Uint8Array;
  attempts: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

function rowToRecord(row: Row): OtpRecord {
  return {
    id: row.id,
    email: row.email,
    codeHash: row.code_hash,
    attempts: row.attempts,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export function insertOtp(db: Db, o: OtpRecord): void {
  db.prepare(
    `INSERT INTO auth_email_otps
     (id, email, code_hash, attempts, created_at, expires_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(o.id, o.email, o.codeHash, o.attempts, o.createdAt, o.expiresAt, o.consumedAt);
}

export function getOtpById(db: Db, id: string): OtpRecord | undefined {
  const row = db
    .prepare("SELECT * FROM auth_email_otps WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function incrementOtpAttempts(db: Db, id: string): void {
  db.prepare("UPDATE auth_email_otps SET attempts = attempts + 1 WHERE id = ?").run(id);
}

export function markOtpConsumed(db: Db, id: string, now: number): void {
  db.prepare("UPDATE auth_email_otps SET consumed_at = ? WHERE id = ?").run(now, id);
}

export function deleteExpiredOtps(db: Db, cutoff: number): number {
  const result = db
    .prepare("DELETE FROM auth_email_otps WHERE expires_at <= ?")
    .run(cutoff);
  return result.changes;
}
