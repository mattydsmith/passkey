package storage

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestSQLiteOTPAndSessionShareTransaction(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.db")
	s, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// An independent deferred transaction is the host-app composition case.
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	now := time.Unix(1700000000, 0)
	if err := s.CreateOTP(EmailOTP{ID: "otp", Email: "user@example.com", CodeHash: []byte("hash"), CreatedAt: now, ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER fail_session BEFORE INSERT ON auth_sessions BEGIN SELECT RAISE(ABORT, 'synthetic session failure'); END`); err != nil {
		t.Fatal(err)
	}
	issue := func() (err error) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		result, err := VerifySQLiteOTPInTx(ctx, tx, "otp", []byte("hash"), 5, func() time.Time { return now })
		if err != nil {
			return err
		}
		if result.Rejection != nil {
			if err := tx.Commit(); err != nil {
				return err
			}
			return result.Rejection
		}
		if result.Email != "user@example.com" {
			t.Fatalf("identity=%q", result.Email)
		}
		if err := CreateSQLiteSessionInTx(ctx, tx, Session{TokenHash: []byte("token-hash"), UserID: "user", CreatedAt: now, LastSeenAt: now, ExpiresAt: now.Add(time.Hour)}); err != nil {
			return err
		}
		return tx.Commit()
	}
	if err := issue(); err == nil {
		t.Fatal("session failure accepted")
	}
	otp, err := s.GetOTP("otp")
	if err != nil {
		t.Fatal(err)
	}
	if otp.ConsumedAt != nil {
		t.Fatal("failed session burned OTP")
	}
	if _, err := db.Exec(`DROP TRIGGER fail_session`); err != nil {
		t.Fatal(err)
	}
	if err := issue(); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if err := issue(); !errors.Is(err, ErrInvalidOTP) {
		t.Fatalf("replay: %v", err)
	}
	sess, err := s.GetSession([]byte("token-hash"))
	if err != nil || sess.UserID != "user" {
		t.Fatalf("session=%+v err=%v", sess, err)
	}
}

func TestSQLiteOTPTransactionCommitsRejections(t *testing.T) {
	s, err := OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	db := s.(*sqliteStore).db
	ctx := context.Background()
	now := time.Unix(1700000000, 0)
	if err := s.CreateOTP(EmailOTP{ID: "otp", Email: "user@example.com", CodeHash: []byte("hash"), ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	for attempt := 1; attempt <= 6; attempt++ {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		result, err := VerifySQLiteOTPInTx(ctx, tx, "otp", []byte("wrong"), 5, func() time.Time { return now })
		if err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		want := ErrInvalidOTP
		if attempt == 6 {
			want = ErrOTPAttemptsExceeded
		}
		if !errors.Is(result.Rejection, want) || result.Email != "" {
			t.Fatalf("attempt %d: %+v", attempt, result)
		}
	}
	otp, err := s.GetOTP("otp")
	if err != nil {
		t.Fatal(err)
	}
	if otp.Attempts != 5 || otp.ConsumedAt != nil {
		t.Fatalf("wrong-guess ledger: %+v", otp)
	}
}

func TestSQLiteOTPDeferredTransactionWaitsBeforeClock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.db")
	s, err := OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	at := time.Unix(1700000000, 0)
	if err := s.CreateOTP(EmailOTP{ID: "otp", Email: "user@example.com", CodeHash: []byte("hash"), ExpiresAt: at.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	blocker, err := s.(*sqliteStore).db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback()
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var clock atomic.Int64
	clock.Store(at.Unix())
	sampled := make(chan struct{}, 1)
	done := make(chan error, 1)
	go func() {
		result, err := VerifySQLiteOTPInTx(ctx, tx, "otp", []byte("hash"), 5, func() time.Time { sampled <- struct{}{}; return time.Unix(clock.Load(), 0) })
		if err == nil {
			err = result.Rejection
		}
		done <- err
	}()
	select {
	case <-sampled:
		t.Fatal("sampled expiry before acquiring write lock")
	case <-time.After(100 * time.Millisecond):
	}
	clock.Store(at.Add(time.Minute).Unix())
	if err := blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, ErrOTPExpired) {
			t.Fatalf("expiry after wait: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("verification did not finish")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	otp, err := s.GetOTP("otp")
	if err != nil {
		t.Fatal(err)
	}
	if otp.ConsumedAt != nil {
		t.Fatal("expired credential consumed")
	}
}
