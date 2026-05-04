import Database from "better-sqlite3";
import { runMigrations } from "@mattsmith/passkey-sdk-core";

const args = process.argv.slice(2);
const cmd = args[0];

function usage(): never {
  console.error("Usage: passkey-sdk migrate <db-path>");
  process.exit(1);
}

if (cmd !== "migrate") usage();
const dbPath = args[1];
if (!dbPath) usage();

const db = new Database(dbPath);
try {
  runMigrations(db);
  console.log(`Migrations applied to ${dbPath}`);
} finally {
  db.close();
}
