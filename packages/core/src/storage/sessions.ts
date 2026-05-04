import type { Db } from "../db.js";
import type { SessionRecord } from "../types.js";

interface Row {
  token_hash: Uint8Array;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  user_agent: string | null;
  ip: string | null;
}

function rowToRecord(row: Row): SessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    userAgent: row.user_agent,
    ip: row.ip,
  };
}

export function insertSession(db: Db, s: SessionRecord): void {
  db.prepare(
    `INSERT INTO auth_sessions
     (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    s.tokenHash,
    s.userId,
    s.createdAt,
    s.expiresAt,
    s.lastSeenAt,
    s.userAgent,
    s.ip
  );
}

export function getSessionByTokenHash(
  db: Db,
  tokenHash: Uint8Array
): SessionRecord | undefined {
  const row = db
    .prepare("SELECT * FROM auth_sessions WHERE token_hash = ?")
    .get(tokenHash) as Row | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function bumpSessionLastSeen(
  db: Db,
  tokenHash: Uint8Array,
  now: number
): void {
  db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").run(
    now,
    tokenHash
  );
}

export function deleteSessionByTokenHash(db: Db, tokenHash: Uint8Array): void {
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
}

export function listSessionsByUser(db: Db, userId: string): SessionRecord[] {
  const rows = db
    .prepare("SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Row[];
  return rows.map(rowToRecord);
}

export function deleteExpiredSessions(db: Db, cutoff: number): number {
  const result = db
    .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
    .run(cutoff);
  return result.changes;
}
