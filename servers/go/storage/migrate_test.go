package storage

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRunMigrations_FreshDB(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := runMigrations(db); err != nil {
		t.Fatalf("runMigrations: %v", err)
	}

	wantTables := []string{
		"auth_passkeys", "auth_sessions", "auth_email_otps", "auth_migrations",
	}
	for _, name := range wantTables {
		var got string
		err := db.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?",
			name,
		).Scan(&got)
		if err != nil {
			t.Errorf("table %s missing: %v", name, err)
		}
	}
}

func TestRunMigrations_Idempotent(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if err := runMigrations(db); err != nil {
		t.Fatal(err)
	}
	if err := runMigrations(db); err != nil {
		t.Fatalf("re-run failed: %v", err)
	}

	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM auth_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("auth_migrations row count = %d, want 1", count)
	}
}
