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

func TestManagementTransaction(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "auth.db")
	raw, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	at := time.Unix(100, 0)
	later := at.Add(time.Hour)
	ua, ip, name, transports := "agent", "192.0.2.1", "Test key", `["usb"]`
	session := Session{UserID: "owner", TokenHash: []byte("hash"), CreatedAt: at, ExpiresAt: later, LastSeenAt: at, UserAgent: &ua, IP: &ip}
	key := Passkey{UserID: "owner", CredentialID: []byte("owner-key"), PublicKey: []byte("public"), SignCount: 3, Transports: &transports, AAGUID: []byte("aaguid"), DeviceName: &name, BackupEligible: true, BackupState: true, CreatedAt: at, LastUsedAt: &later}
	if err = raw.CreateSession(session); err != nil {
		t.Fatal(err)
	}
	if err = raw.CreatePasskey(key); err != nil {
		t.Fatal(err)
	}
	// SDK insertion does not persist LastUsedAt; exercise the stored update representation.
	if err = raw.UpdatePasskeySignCount(key.CredentialID, 3, later); err != nil {
		t.Fatal(err)
	}
	other := key
	other.UserID = "other"
	other.CredentialID = []byte("other-key")
	if err = raw.CreatePasskey(other); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET last_seen_at=last_seen_at WHERE 0`); err != nil {
		t.Fatal(err)
	}
	sessions, err := ListSQLiteSessionsInTx(ctx, tx, "owner")
	if err != nil || !reflect.DeepEqual(sessions, []Session{session}) {
		t.Fatalf("sessions=%+v err=%v", sessions, err)
	}
	keys, err := ListSQLitePasskeysInTx(ctx, tx, "owner")
	if err != nil || !reflect.DeepEqual(keys, []Passkey{key}) {
		t.Fatalf("keys=%+v err=%v", keys, err)
	}
	if err = DeleteSQLiteOwnedPasskeyInTx(ctx, tx, "owner", other.CredentialID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign=%v", err)
	}
	if err = DeleteSQLiteOwnedPasskeyInTx(ctx, tx, "owner", []byte("missing")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing=%v", err)
	}
	if err = DeleteSQLiteOwnedPasskeyInTx(ctx, tx, "owner", key.CredentialID); err != nil {
		t.Fatal(err)
	}
	keys, err = ListSQLitePasskeysInTx(ctx, tx, "owner")
	if err != nil || len(keys) != 0 {
		t.Fatal("delete absent inside transaction")
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if _, err = raw.GetPasskey(key.CredentialID); err != nil {
		t.Fatal("helper committed deletion")
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = DeleteSQLiteOwnedPasskeyInTx(ctx, tx, "owner", key.CredentialID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err = raw.GetPasskey(key.CredentialID); !errors.Is(err, ErrNotFound) {
		t.Fatal("commit did not delete")
	}
	if _, err = raw.GetPasskey(other.CredentialID); err != nil {
		t.Fatal("foreign key changed")
	}
	if _, err = ListSQLiteSessionsInTx(ctx, tx, "owner"); err == nil {
		t.Fatal("closed transaction read succeeded")
	}
	if _, err = ListSQLiteSessionsInTx(ctx, nil, "owner"); err == nil {
		t.Fatal("nil sessions transaction accepted")
	}
	if _, err = ListSQLitePasskeysInTx(ctx, nil, "owner"); err == nil {
		t.Fatal("nil keys transaction accepted")
	}
	if err = DeleteSQLiteOwnedPasskeyInTx(ctx, nil, "owner", key.CredentialID); err == nil {
		t.Fatal("nil deletion transaction accepted")
	}
}
