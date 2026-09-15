package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestPasskeyInsertHostTransaction(t *testing.T) {
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	raw := s.(*sqliteStore)
	ctx := context.Background()
	at := time.Now().Truncate(time.Second)
	name, transport := "synthetic-device", "[\"internal\"]"
	p := Passkey{CredentialID: []byte("credential"), UserID: "owner", PublicKey: []byte("key"), SignCount: 3, AAGUID: []byte("aaguid"), DeviceName: &name, Transports: &transport, BackupEligible: true, BackupState: true, CreatedAt: at, LastUsedAt: &at}
	if err = CreateSQLitePasskeyInTx(ctx, nil, p); err == nil {
		t.Fatal("nil transaction accepted")
	}
	tx, err := raw.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = CreateSQLitePasskeyInTx(ctx, tx, p); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GetPasskey(p.CredentialID); err != ErrNotFound {
		t.Fatalf("rollback persisted: %v", err)
	}
	tx, err = raw.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = CreateSQLitePasskeyInTx(ctx, tx, p); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	saved, err := s.GetPasskey(p.CredentialID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.UserID != p.UserID || saved.SignCount != 3 || !saved.BackupEligible || !saved.BackupState || saved.DeviceName == nil || *saved.DeviceName != name || saved.Transports == nil || *saved.Transports != transport || saved.LastUsedAt == nil || !saved.LastUsedAt.Equal(at) {
		t.Fatal("persisted metadata changed")
	}
}
