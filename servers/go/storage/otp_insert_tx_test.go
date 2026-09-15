package storage

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestCreateSQLiteOTPInHostTransaction(t *testing.T) {
	for _, mode := range []string{"rollback", "commit_failure", "commit"} {
		t.Run(mode, func(t *testing.T) {
			st, err := OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			db := st.(*sqliteStore).db
			if _, err := db.Exec(`CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE marker(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)`); err != nil {
				t.Fatal(err)
			}
			if err := st.CreateOTP(EmailOTP{ID: "older", Email: "user@example.com", CodeHash: []byte{9}, CreatedAt: time.Unix(1699999900, 0), ExpiresAt: time.Unix(1700000060, 0)}); err != nil {
				t.Fatal(err)
			}

			for _, guard := range []struct{ id, email string }{{"other-address", "other@example.com"}, {"consumed", "user@example.com"}} {
				if err := st.CreateOTP(EmailOTP{ID: guard.id, Email: guard.email, CodeHash: []byte{8}, CreatedAt: time.Unix(1699999900, 0), ExpiresAt: time.Unix(1700000060, 0)}); err != nil {
					t.Fatal(err)
				}
			}
			consumedAt := time.Unix(1699999950, 0)
			if err := st.ConsumeOTP("consumed", consumedAt); err != nil {
				t.Fatal(err)
			}

			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			now := time.Unix(1700000000, 0)
			if n, err := InvalidateSQLiteOTPsInTx(context.Background(), tx, "user@example.com", now); err != nil || n != 1 {
				t.Fatalf("invalidate count=%d err=%v", n, err)
			}

			if err := CreateSQLiteOTPInTx(context.Background(), tx, EmailOTP{ID: "host-otp", Email: "user@example.com", CodeHash: []byte{1, 2, 3}, CreatedAt: now, ExpiresAt: now.Add(time.Minute)}); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec("INSERT INTO marker VALUES(1)"); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "commit":
				if _, err := tx.Exec("INSERT INTO parent VALUES(1)"); err != nil {
					t.Fatal(err)
				}
				if err := tx.Commit(); err != nil {
					t.Fatal(err)
				}
			case "commit_failure":
				if err := tx.Commit(); err == nil {
					t.Fatal("expected deferred FK failure")
				}
			default:
				if err := tx.Rollback(); err != nil {
					t.Fatal(err)
				}
			}
			old, err := st.GetOTP("older")
			if err != nil {
				t.Fatal(err)
			}
			if (old.ConsumedAt != nil) != (mode == "commit") {
				t.Fatal("old OTP invalidation did not share transaction")
			}

			other, err := st.GetOTP("other-address")
			if err != nil || other.ConsumedAt != nil {
				t.Fatal("another address changed")
			}
			consumed, err := st.GetOTP("consumed")
			if err != nil || consumed.ConsumedAt == nil || !consumed.ConsumedAt.Equal(consumedAt) {
				t.Fatal("previous consumption timestamp changed")
			}

			got, err := st.GetOTP("host-otp")
			var markers int
			if err := db.QueryRow("SELECT count(*) FROM marker").Scan(&markers); err != nil {
				t.Fatal(err)
			}
			if mode == "commit" {
				if err != nil || got.Email != "user@example.com" || got.ConsumedAt != nil || markers != 1 {
					t.Fatalf("committed OTP=%+v err=%v markers=%d", got, err, markers)
				}
			} else if !errors.Is(err, ErrNotFound) || markers != 0 {
				t.Fatalf("rolled back OTP err=%v markers=%d", err, markers)
			}
		})
	}
	if _, err := InvalidateSQLiteOTPsInTx(context.Background(), nil, "user@example.com", time.Now()); err == nil {
		t.Fatal("nil invalidation transaction accepted")
	}
	if err := CreateSQLiteOTPInTx(context.Background(), nil, EmailOTP{}); err == nil {
		t.Fatal("nil transaction accepted")
	}
}
