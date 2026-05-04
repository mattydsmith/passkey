import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Bundled migration files, in order. Resolved relative to this file. */
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

export function runMigrations(db: Db): void {
  // Ensure the bookkeeping table exists first (it's also recreated by 001
  // for fresh setups; IF NOT EXISTS makes both paths safe).
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_migrations (
      filename   TEXT    PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (
      db
        .prepare("SELECT filename FROM auth_migrations")
        .all() as { filename: string }[]
    ).map((r) => r.filename)
  );

  const insert = db.prepare(
    "INSERT INTO auth_migrations (filename, applied_at) VALUES (?, ?)"
  );

  const tx = db.transaction((file: string) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    db.exec(sql);
    insert.run(file, Math.floor(Date.now() / 1000));
  });

  for (const file of files) {
    if (applied.has(file)) continue;
    tx(file);
  }
}
