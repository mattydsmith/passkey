// Package storage owns the persistence schema for sessions, passkeys, and
// pending email OTPs. The Storage interface is the seam between the SDK and
// any backing store; only a SQLite impl ships today.
package storage

import "time"

// Session represents a server-side session row.
type Session struct {
	TokenHash  []byte
	UserID     string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastSeenAt time.Time
	UserAgent  *string
	IP         *string
}

// EmailOTP represents a pending email OTP row.
type EmailOTP struct {
	ID         string
	Email      string
	CodeHash   []byte
	Attempts   int
	CreatedAt  time.Time
	ExpiresAt  time.Time
	ConsumedAt *time.Time
}

// Passkey represents a registered WebAuthn credential.
type Passkey struct {
	CredentialID []byte
	UserID       string
	PublicKey    []byte
	SignCount    uint32
	Transports   *string // JSON-encoded []string, matches TS wire format (e.g. `["usb","nfc"]`)
	AAGUID       []byte
	DeviceName   *string
	CreatedAt    time.Time
	LastUsedAt   *time.Time
}

// Storage is the persistence interface. All methods MUST be safe for
// concurrent use; the sqlite impl serialises writes via a mutex.
type Storage interface {
	// Sessions
	CreateSession(s Session) error
	GetSession(tokenHash []byte) (*Session, error)
	TouchSession(tokenHash []byte, at time.Time) error
	DeleteSession(tokenHash []byte) error
	ListSessions(userID string) ([]Session, error)

	// Email OTPs
	CreateOTP(o EmailOTP) error
	GetOTP(id string) (*EmailOTP, error)
	IncrementOTPAttempts(id string) (int, error)
	ConsumeOTP(id string, at time.Time) error
	ForceExpireOTP(id string) error // test-only helper

	// Passkeys
	CreatePasskey(p Passkey) error
	GetPasskey(credentialID []byte) (*Passkey, error)
	ListPasskeys(userID string) ([]Passkey, error)
	UpdatePasskeySignCount(credentialID []byte, signCount uint32, at time.Time) error
	DeletePasskey(credentialID []byte) error

	// Lifecycle
	Close() error
}

// ErrNotFound is returned by lookups when no row matches.
var ErrNotFound = errNotFound{}

type errNotFound struct{}

func (errNotFound) Error() string { return "storage: not found" }
