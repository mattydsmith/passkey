package storage

import (
	"database/sql"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestVerifyOTPRollsBackFailedConsumptionAndAttempt(t *testing.T) {
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	raw := s.(*sqliteStore)
	now := time.Unix(1700000000, 0)
	if err := s.CreateOTP(EmailOTP{ID: "otp", Email: "user@example.com", CodeHash: []byte("hash"), CreatedAt: now, ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.db.Exec(`CREATE TRIGGER reject_otp_update BEFORE UPDATE ON auth_email_otps BEGIN SELECT RAISE(ABORT, 'injected update failure'); END`); err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"hash", "wrong"} {
		if _, err := s.VerifyOTP("otp", []byte(code), 5, func() time.Time { return now }); err == nil || errors.Is(err, ErrInvalidOTP) {
			t.Fatalf("write failure masked: %v", err)
		}
		row, err := s.GetOTP("otp")
		if err != nil {
			t.Fatal(err)
		}
		if row.Attempts != 0 || row.ConsumedAt != nil {
			t.Fatalf("failed transaction changed row: %+v", row)
		}
	}
	if _, err := raw.db.Exec(`DROP TRIGGER reject_otp_update`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.VerifyOTP("otp", []byte("hash"), 5, func() time.Time { return now }); err != nil {
		t.Fatalf("retry after rollback: %v", err)
	}
}

func TestVerifyOTPUsesClockAfterWaitingForWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.db")
	a, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	now := time.Unix(1700000000, 0)
	if err := a.CreateOTP(EmailOTP{ID: "otp", Email: "user@example.com", CodeHash: []byte("hash"), CreatedAt: now, ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	tx, err := a.(*sqliteStore).db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var clock atomic.Int64
	clock.Store(now.Unix())
	sampled := make(chan struct{}, 1)
	result := make(chan error, 1)
	go func() {
		_, err := b.VerifyOTP("otp", []byte("hash"), 5, func() time.Time { sampled <- struct{}{}; return time.Unix(clock.Load(), 0) })
		result <- err
	}()
	select {
	case <-sampled:
		t.Fatal("clock sampled before acquiring writer lock")
	case <-time.After(100 * time.Millisecond):
	}
	clock.Store(now.Add(time.Minute).Unix())
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if !errors.Is(err, ErrOTPExpired) {
			t.Fatalf("expired during wait: got %v", err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("verification did not complete")
	}
	row, err := a.GetOTP("otp")
	if err != nil {
		t.Fatal(err)
	}
	if row.ConsumedAt != nil {
		t.Fatal("expired OTP was consumed")
	}
}

func TestSQLiteBusyTimeoutAppliesToEveryConnection(t *testing.T) {
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	db := s.(*sqliteStore).db
	// Hold two connections at once, forcing the pool to open a second one.
	a, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := db.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	for _, c := range []*sql.Conn{a, b} {
		var ms int
		if err := c.QueryRowContext(t.Context(), "PRAGMA busy_timeout").Scan(&ms); err != nil {
			t.Fatal(err)
		}
		if ms != 5000 {
			t.Errorf("busy timeout=%d, want 5000", ms)
		}
	}
}

func TestVerifyOTPRollsBackCommitFailure(t *testing.T) {
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	db := s.(*sqliteStore).db
	db.SetMaxOpenConns(1)
	now := time.Unix(1700000000, 0)
	if err := s.CreateOTP(EmailOTP{ID: "otp", Email: "user@example.com", CodeHash: []byte("hash"), CreatedAt: now, ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE parent (id INTEGER PRIMARY KEY);
 CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
 CREATE TRIGGER fail_commit AFTER UPDATE ON auth_email_otps BEGIN INSERT INTO child VALUES (99); END;`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.VerifyOTP("otp", []byte("hash"), 5, func() time.Time { return now }); err == nil {
		t.Fatal("commit failure reported success")
	}
	row, err := s.GetOTP("otp")
	if err != nil {
		t.Fatal(err)
	}
	if row.ConsumedAt != nil {
		t.Error("failed commit left consumed state visible")
	}
	if _, err := db.Exec(`DROP TRIGGER fail_commit`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.VerifyOTP("otp", []byte("hash"), 5, func() time.Time { return now }); err != nil {
		t.Errorf("retry after commit failure: %v", err)
	}
}
