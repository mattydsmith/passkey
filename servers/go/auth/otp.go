package auth

import (
	"crypto/rand"
	"errors"
	"math/big"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

// OTPMaxAttempts is the cap on `verify` attempts per OTP.
const OTPMaxAttempts = 5

// OTPCodeLength is the digit count for generated codes.
const OTPCodeLength = 6

// ErrInvalidOTP is returned when the code does not match.
var ErrInvalidOTP = errors.New("invalid_otp")

// ErrOTPExpired is returned when the OTP is past its expiry.
var ErrOTPExpired = errors.New("otp_expired")

// ErrOTPAttemptsExceeded is returned after OTPMaxAttempts wrong codes.
var ErrOTPAttemptsExceeded = errors.New("otp_attempts_exceeded")

// StartEmailOTP creates a fresh OTP row and asks emailer to deliver the code.
// Returns the OTP ID and time-to-live in seconds.
func StartEmailOTP(s storage.Storage, emailer EmailSender, email string, ttl time.Duration, now time.Time) (id string, expiresIn int, err error) {
	id, err = RandomToken(16)
	if err != nil {
		return "", 0, err
	}
	code, err := genCode(OTPCodeLength)
	if err != nil {
		return "", 0, err
	}
	if err := s.CreateOTP(storage.EmailOTP{
		ID:        id,
		Email:     email,
		CodeHash:  HashToken(code),
		CreatedAt: now,
		ExpiresAt: now.Add(ttl),
	}); err != nil {
		return "", 0, err
	}
	if err := emailer.SendOTP(email, code); err != nil {
		return "", 0, err
	}
	return id, int(ttl.Seconds()), nil
}

// VerifyEmailOTP returns the user's email if the code matches and is unexpired.
// Increments attempts on mismatch; returns ErrOTPAttemptsExceeded once the cap
// is hit.
func VerifyEmailOTP(s storage.Storage, otpID, code string, now time.Time) (email string, err error) {
	o, err := s.GetOTP(otpID)
	if err != nil {
		return "", ErrInvalidOTP
	}
	if o.ConsumedAt != nil {
		return "", ErrInvalidOTP
	}
	if now.After(o.ExpiresAt) {
		return "", ErrOTPExpired
	}
	if string(HashToken(code)) != string(o.CodeHash) {
		attempts, _ := s.IncrementOTPAttempts(otpID)
		if attempts >= OTPMaxAttempts {
			return "", ErrOTPAttemptsExceeded
		}
		return "", ErrInvalidOTP
	}
	if err := s.ConsumeOTP(otpID, now); err != nil {
		return "", err
	}
	return o.Email, nil
}

func genCode(n int) (string, error) {
	max := big.NewInt(10)
	out := make([]byte, n)
	for i := range out {
		d, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = byte('0' + d.Int64())
	}
	return string(out), nil
}
