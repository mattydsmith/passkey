package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func TestSQLite_SessionLifecycle(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenSQLite(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	now := time.Unix(1_700_000_000, 0)
	sess := Session{
		TokenHash:  []byte{0x01, 0x02, 0x03},
		UserID:     "user-1",
		CreatedAt:  now,
		ExpiresAt:  now.Add(24 * time.Hour),
		LastSeenAt: now,
	}
	if err := s.CreateSession(sess); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetSession([]byte{0x01, 0x02, 0x03})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.UserID != "user-1" {
		t.Errorf("UserID = %q, want user-1", got.UserID)
	}

	if err := s.DeleteSession([]byte{0x01, 0x02, 0x03}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetSession([]byte{0x01, 0x02, 0x03}); err == nil {
		t.Error("expected ErrNotFound after delete")
	}
}

func TestSQLite_OTPLifecycle(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenSQLite(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	now := time.Unix(1_700_000_000, 0)
	otp := EmailOTP{
		ID:        "otp-1",
		Email:     "alice@example.com",
		CodeHash:  []byte{0xAA, 0xBB},
		CreatedAt: now,
		ExpiresAt: now.Add(10 * time.Minute),
	}
	if err := s.CreateOTP(otp); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := s.GetOTP("otp-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Email != "alice@example.com" {
		t.Errorf("Email = %q", got.Email)
	}
	if n, err := s.IncrementOTPAttempts("otp-1"); err != nil || n != 1 {
		t.Errorf("attempts: n=%d err=%v", n, err)
	}
	if err := s.ConsumeOTP("otp-1", now.Add(time.Minute)); err != nil {
		t.Fatalf("consume: %v", err)
	}
}

func TestSQLite_PasskeyLifecycle(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenSQLite(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	now := time.Unix(1_700_000_000, 0)
	credID := []byte{0xDE, 0xAD, 0xBE, 0xEF}
	transports := `["usb","nfc"]`
	deviceName := "MacBook"

	// Two passkeys, with and without nullable fields, to exercise both paths.
	// pk1 carries BE=true,BS=true (synced authenticator like iCloud Keychain);
	// pk2 leaves both flags zero (platform-only / security-key shape).
	pk1 := Passkey{
		CredentialID:   credID,
		UserID:         "user-1",
		PublicKey:      []byte{0x01, 0x02},
		SignCount:      0,
		Transports:     &transports,
		AAGUID:         []byte{0x10, 0x20, 0x30},
		DeviceName:     &deviceName,
		BackupEligible: true,
		BackupState:    true,
		CreatedAt:      now,
	}
	pk2 := Passkey{
		CredentialID: []byte{0xCA, 0xFE},
		UserID:       "user-1",
		PublicKey:    []byte{0x03, 0x04},
		SignCount:    7,
		// Transports, AAGUID (empty slice), DeviceName, Backup* all absent.
		AAGUID:    []byte{},
		CreatedAt: now.Add(time.Minute),
	}

	if err := s.CreatePasskey(pk1); err != nil {
		t.Fatalf("create pk1: %v", err)
	}
	if err := s.CreatePasskey(pk2); err != nil {
		t.Fatalf("create pk2: %v", err)
	}

	got, err := s.GetPasskey(credID)
	if err != nil {
		t.Fatalf("get pk1: %v", err)
	}
	if got.UserID != "user-1" || got.SignCount != 0 {
		t.Errorf("pk1 mismatch: %+v", got)
	}
	if got.Transports == nil || *got.Transports != transports {
		t.Errorf("pk1 transports round-trip lost: %v", got.Transports)
	}
	if got.DeviceName == nil || *got.DeviceName != deviceName {
		t.Errorf("pk1 deviceName round-trip lost: %v", got.DeviceName)
	}
	if len(got.AAGUID) != 3 {
		t.Errorf("pk1 AAGUID = %x, want 3 bytes", got.AAGUID)
	}
	if !got.BackupEligible || !got.BackupState {
		t.Errorf("pk1 backup flags lost on round-trip: BE=%v BS=%v", got.BackupEligible, got.BackupState)
	}

	gotEmpty, err := s.GetPasskey([]byte{0xCA, 0xFE})
	if err != nil {
		t.Fatalf("get pk2: %v", err)
	}
	if gotEmpty.Transports != nil {
		t.Errorf("pk2 transports should be nil, got %v", *gotEmpty.Transports)
	}
	if gotEmpty.DeviceName != nil {
		t.Errorf("pk2 deviceName should be nil, got %v", *gotEmpty.DeviceName)
	}
	if gotEmpty.AAGUID != nil {
		// Empty AAGUID written via nullBytes should come back as nil, NOT an empty slice.
		t.Errorf("pk2 AAGUID should be nil after nullBytes round-trip, got %v (len=%d)", gotEmpty.AAGUID, len(gotEmpty.AAGUID))
	}
	if gotEmpty.BackupEligible || gotEmpty.BackupState {
		t.Errorf("pk2 backup flags should default to false, got BE=%v BS=%v", gotEmpty.BackupEligible, gotEmpty.BackupState)
	}

	list, err := s.ListPasskeys("user-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("list len = %d, want 2", len(list))
	}
	// Plan: ORDER BY created_at DESC — pk2 (later) first.
	if string(list[0].CredentialID) != string([]byte{0xCA, 0xFE}) {
		t.Errorf("list order wrong: first = %x, want CAFE", list[0].CredentialID)
	}

	// UpdatePasskeySignCount + LastUsedAt round-trip
	later := now.Add(time.Hour)
	if err := s.UpdatePasskeySignCount(credID, 42, later); err != nil {
		t.Fatalf("update sign count: %v", err)
	}
	got2, _ := s.GetPasskey(credID)
	if got2.SignCount != 42 {
		t.Errorf("SignCount after update = %d, want 42", got2.SignCount)
	}
	if got2.LastUsedAt == nil || !got2.LastUsedAt.Equal(later) {
		t.Errorf("LastUsedAt = %v, want %v", got2.LastUsedAt, later)
	}

	// Delete
	if err := s.DeletePasskey(credID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.GetPasskey(credID); err == nil {
		t.Error("expected ErrNotFound after delete")
	}
}
