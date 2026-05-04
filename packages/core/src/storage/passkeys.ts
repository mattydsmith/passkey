import type { Db } from "../db.js";
import type { PasskeyRecord } from "../types.js";

interface Row {
  credential_id: Uint8Array;
  user_id: string;
  public_key: Uint8Array;
  sign_count: number;
  transports: string | null;
  aaguid: Uint8Array | null;
  device_name: string | null;
  created_at: number;
  last_used_at: number | null;
}

function rowToRecord(row: Row): PasskeyRecord {
  return {
    credentialId: row.credential_id,
    userId: row.user_id,
    publicKey: row.public_key,
    signCount: row.sign_count,
    transports: row.transports ? (JSON.parse(row.transports) as string[]) : null,
    aaguid: row.aaguid,
    deviceName: row.device_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export function insertPasskey(db: Db, p: PasskeyRecord): void {
  db.prepare(
    `INSERT INTO auth_passkeys
     (credential_id, user_id, public_key, sign_count, transports, aaguid,
      device_name, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.credentialId,
    p.userId,
    p.publicKey,
    p.signCount,
    p.transports ? JSON.stringify(p.transports) : null,
    p.aaguid,
    p.deviceName,
    p.createdAt,
    p.lastUsedAt
  );
}

export function getPasskeyByCredentialId(
  db: Db,
  credentialId: Uint8Array
): PasskeyRecord | undefined {
  const row = db
    .prepare("SELECT * FROM auth_passkeys WHERE credential_id = ?")
    .get(credentialId) as Row | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function listPasskeysByUser(db: Db, userId: string): PasskeyRecord[] {
  const rows = db
    .prepare("SELECT * FROM auth_passkeys WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Row[];
  return rows.map(rowToRecord);
}

export function updatePasskeySignCount(
  db: Db,
  credentialId: Uint8Array,
  signCount: number,
  now: number
): void {
  db.prepare(
    "UPDATE auth_passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?"
  ).run(signCount, now, credentialId);
}

export function deletePasskey(db: Db, credentialId: Uint8Array): void {
  db.prepare("DELETE FROM auth_passkeys WHERE credential_id = ?").run(credentialId);
}
