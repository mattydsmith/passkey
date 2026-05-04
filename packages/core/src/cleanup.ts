import type { Db } from "./db.js";
import type { Deps } from "./deps.js";
import { deleteExpiredSessions } from "./storage/sessions.js";
import { deleteExpiredOtps } from "./storage/otps.js";

export function cleanup(args: { db: Db; deps: Deps }): { sessions: number; otps: number } {
  const cutoff = args.deps.now();
  return {
    sessions: deleteExpiredSessions(args.db, cutoff),
    otps: deleteExpiredOtps(args.db, cutoff),
  };
}
