package storage

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// runMigrations applies any pending SQL migrations bundled under
// migrations/. It uses an auth_migrations bookkeeping table to skip
// already-applied files, matching the TS impl exactly.
func runMigrations(db *sql.DB) error {
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS auth_migrations (
			filename   TEXT    PRIMARY KEY,
			applied_at INTEGER NOT NULL
		);
	`); err != nil {
		return fmt.Errorf("bootstrap auth_migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	applied := map[string]bool{}
	rows, err := db.Query("SELECT filename FROM auth_migrations")
	if err != nil {
		return fmt.Errorf("read applied: %w", err)
	}
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			rows.Close()
			return err
		}
		applied[f] = true
	}
	rows.Close()

	for _, f := range files {
		if applied[f] {
			continue
		}
		sqlBytes, err := fs.ReadFile(migrationsFS, "migrations/"+f)
		if err != nil {
			return fmt.Errorf("read %s: %w", f, err)
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(sqlBytes)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply %s: %w", f, err)
		}
		if _, err := tx.Exec(
			"INSERT INTO auth_migrations (filename, applied_at) VALUES (?, ?)",
			f, time.Now().Unix(),
		); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
