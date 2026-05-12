package auth

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

type recordingEmailer struct {
	sent []struct{ to, code string }
}

func (r *recordingEmailer) SendOTP(email, code string) error {
	r.sent = append(r.sent, struct{ to, code string }{email, code})
	return nil
}

func newStore(t *testing.T) storage.Storage {
	t.Helper()
	s, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestStartAndVerifyOTP_HappyPath(t *testing.T) {
	s := newStore(t)
	em := &recordingEmailer{}
	now := time.Unix(1_700_000_000, 0)

	id, ttl, err := StartEmailOTP(s, em, "alice@example.com", 10*time.Minute, now)
	if err != nil {
		t.Fatal(err)
	}
	if ttl != 600 {
		t.Errorf("ttl seconds = %d, want 600", ttl)
	}
	if len(em.sent) != 1 || em.sent[0].to != "alice@example.com" {
		t.Fatalf("emailer didn't get the code: %+v", em.sent)
	}
	code := em.sent[0].code

	email, err := VerifyEmailOTP(s, id, code, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if email != "alice@example.com" {
		t.Errorf("got %q", email)
	}
}

func TestVerifyOTP_WrongCode_AttemptsExceeded(t *testing.T) {
	s := newStore(t)
	em := &recordingEmailer{}
	now := time.Unix(1_700_000_000, 0)
	id, _, _ := StartEmailOTP(s, em, "alice@example.com", 10*time.Minute, now)

	// OTPMaxAttempts wrong codes each return ErrInvalidOTP (attempts go from 0
	// to OTPMaxAttempts). The (OTPMaxAttempts+1)th call finds attempts >=
	// OTPMaxAttempts at the top of the function and returns ErrOTPAttemptsExceeded.
	// This mirrors the TS verifyEmailOtp semantics.
	for i := 0; i < OTPMaxAttempts; i++ {
		if _, err := VerifyEmailOTP(s, id, "000000", now); err != ErrInvalidOTP {
			t.Fatalf("attempt %d: want ErrInvalidOTP, got %v", i, err)
		}
	}
	if _, err := VerifyEmailOTP(s, id, "000000", now); err != ErrOTPAttemptsExceeded {
		t.Errorf("final: want ErrOTPAttemptsExceeded, got %v", err)
	}
}

func TestVerifyOTP_Expired(t *testing.T) {
	s := newStore(t)
	em := &recordingEmailer{}
	now := time.Unix(1_700_000_000, 0)
	id, _, _ := StartEmailOTP(s, em, "alice@example.com", 10*time.Minute, now)
	code := em.sent[0].code

	later := now.Add(11 * time.Minute)
	if _, err := VerifyEmailOTP(s, id, code, later); err != ErrOTPExpired {
		t.Errorf("want ErrOTPExpired, got %v", err)
	}
}
