import type Database from "better-sqlite3";

/** The SQLite handle the SDK uses. Re-exported so consumers don't have
 *  to depend directly on better-sqlite3 types. */
export type Db = Database.Database;
