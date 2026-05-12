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
