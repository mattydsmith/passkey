package auth

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

// On the old implementation every reader sees the same pre-mutation row.
// The atomic implementation never calls this public read/update sequence.
type synchronizedOTPRead struct {
	storage.Storage
	arrived *sync.WaitGroup
}

func (s synchronizedOTPRead) GetOTP(id string) (*storage.EmailOTP, error) {
	o, err := s.Storage.GetOTP(id)
	s.arrived.Done()
	s.arrived.Wait()
	return o, err
}

func TestVerifyOTPConcurrentRedemptionAndAttemptLimit(t *testing.T) {
	for _, correct := range []bool{true, false} {
		name := "wrong codes stop at five"
		if correct {
			name = "one redemption only"
		}
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "shared.db")
			a, err := storage.OpenSQLite(path)
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			b, err := storage.OpenSQLite(path)
			if err != nil {
				t.Fatal(err)
			}
			defer b.Close()
			now := time.Unix(1700000000, 0)
			if err := a.CreateOTP(storage.EmailOTP{ID: "otp", Email: "a@example.com", CodeHash: HashToken("123456"), CreatedAt: now, ExpiresAt: now.Add(time.Minute)}); err != nil {
				t.Fatal(err)
			}
			const count = 20
			var ready sync.WaitGroup
			ready.Add(count)
			stores := []storage.Storage{synchronizedOTPRead{a, &ready}, synchronizedOTPRead{b, &ready}}
			results := make(chan error, count)
			code := "000000"
			if correct {
				code = "123456"
			}
			for i := 0; i < count; i++ {
				go func(i int) { _, err := VerifyEmailOTP(stores[i%2], "otp", code, now); results <- err }(i)
			}
			successes, invalid, limited := 0, 0, 0
			for i := 0; i < count; i++ {
				err := <-results
				switch {
				case err == nil:
					successes++
				case errors.Is(err, ErrInvalidOTP):
					invalid++
				case errors.Is(err, ErrOTPAttemptsExceeded):
					limited++
				default:
					t.Errorf("unexpected verification failure: %v", err)
				}
			}
			row, err := a.GetOTP("otp")
			if err != nil {
				t.Fatal(err)
			}
			if correct {
				if successes != 1 || invalid != count-1 {
					t.Errorf("successes=%d invalid=%d, want 1 and 19", successes, invalid)
				}
			} else if row.Attempts != 5 || invalid != 5 || limited != 15 {
				t.Errorf("attempts=%d invalid=%d limited=%d, want 5,5,15", row.Attempts, invalid, limited)
			}
		})
	}
}

func TestVerifyOTPExactExpiry(t *testing.T) {
	s := newStore(t)
	now := time.Unix(1700000000, 0)
	if err := s.CreateOTP(storage.EmailOTP{ID: "boundary", Email: "a@example.com", CodeHash: HashToken("123456"), CreatedAt: now, ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyEmailOTP(s, "boundary", "123456", now.Add(time.Minute)); !errors.Is(err, ErrOTPExpired) {
		t.Fatalf("expiry boundary: got %v, want otp_expired", err)
	}
}

func TestVerifyOTPStorageFailureIsNotInvalidCode(t *testing.T) {
	s := newStore(t)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyEmailOTP(s, "otp", "123456", time.Now()); err == nil || errors.Is(err, ErrInvalidOTP) {
		t.Fatalf("closed database: got %v, want storage error", err)
	}
}
