package storage

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestPasskeyReadHostTransaction(t *testing.T) {
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	raw := s.(*sqliteStore)
	ctx := context.Background()
	at := time.Now().Truncate(time.Second)
	name, transports := "synthetic", "[\"internal\"]"
	p := Passkey{CredentialID: []byte("key"), UserID: "owner", PublicKey: []byte("public"), SignCount: 3, AAGUID: []byte("aaguid"), DeviceName: &name, Transports: &transports, BackupEligible: true, BackupState: true, CreatedAt: at, LastUsedAt: &at}
	if _, err = ListSQLitePasskeysInTx(ctx, nil, "owner"); err == nil {
		t.Fatal("nil transaction accepted")
	}
	tx, err := raw.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, user := range []string{"owner", "other"} {
		k := p
		k.UserID = user
		k.CredentialID = []byte(user)
		if err = CreateSQLitePasskeyInTx(ctx, tx, k); err != nil {
			t.Fatal(err)
		}
	}
	got, err := ListSQLitePasskeysInTx(ctx, tx, "owner")
	if err != nil || len(got) != 1 {
		t.Fatalf("transaction snapshot=%d %v", len(got), err)
	}
	p.CredentialID = []byte("owner")
	// SQLite stores integer Unix seconds; compare the complete value with those times normalized.
	p.CreatedAt = time.Unix(at.Unix(), 0)
	used := time.Unix(at.Unix(), 0)
	p.LastUsedAt = &used
	if !reflect.DeepEqual(got[0], p) {
		t.Fatalf("snapshot metadata mismatch: got=%+v want=%+v", got[0], p)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if _, err = ListSQLitePasskeysInTx(ctx, tx, "owner"); !errors.Is(err, sql.ErrTxDone) {
		t.Fatalf("closed transaction=%v", err)
	}
	persisted, err := s.ListPasskeys("owner")
	if err != nil || len(persisted) != 0 {
		t.Fatal("snapshot helper committed caller's transaction")
	}
}
