import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import type { Deps } from "./deps.js";
import type { SessionRecord } from "./types.js";
import { AuthError } from "./errors.js";
import {
  insertSession,
  getSessionByTokenHash,
  bumpSessionLastSeen,
  deleteSessionByTokenHash,
  listSessionsByUser,
} from "./storage/sessions.js";

const TOKEN_BYTES = 32;

function hashToken(token: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(token).digest());
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export interface CreateSessionInput {
  db: Db;
  deps: Deps;
  userId: string;
  lifetimeSeconds: number;
  userAgent: string | null;
  ip: string | null;
}

export interface CreateSessionResult {
  sessionToken: string;
  expiresAt: number;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  const { db, deps, userId, lifetimeSeconds, userAgent, ip } = input;
  const raw = deps.randomBytes(TOKEN_BYTES);
  const sessionToken = `tok_${bytesToBase64Url(raw)}`;
  const tokenHash = hashToken(sessionToken);
  const now = deps.now();
  const expiresAt = now + lifetimeSeconds;

  insertSession(db, {
    tokenHash,
    userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    userAgent,
    ip,
  });

  return { sessionToken, expiresAt };
}

export interface ValidateSessionResult {
  userId: string;
  expiresAt: number;
}

export function validateAndBumpSession(args: {
  db: Db;
  deps: Deps;
  sessionToken: string;
}): ValidateSessionResult {
  const { db, deps, sessionToken } = args;
  const tokenHash = hashToken(sessionToken);
  const row = getSessionByTokenHash(db, tokenHash);
  const now = deps.now();
  if (!row || row.expiresAt <= now) {
    throw new AuthError("unauthenticated", "unauthenticated");
  }
  bumpSessionLastSeen(db, tokenHash, now);
  return { userId: row.userId, expiresAt: row.expiresAt };
}

export function revokeSession(args: { db: Db; sessionToken: string }): void {
  deleteSessionByTokenHash(args.db, hashToken(args.sessionToken));
}

export function listSessionsForUser(db: Db, userId: string): SessionRecord[] {
  return listSessionsByUser(db, userId);
}
