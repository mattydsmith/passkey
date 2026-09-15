// Package httpapi exposes the public Mount entrypoint that wires the
// Passkey SDK HTTP routes onto a chi router.
package httpapi

import (
	"context"
	"time"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// Config controls how Mount wires routes. All fields except Storage are
// optional — defaults are applied in Mount.
type Config struct {
	RPID              string
	RPName            string
	Origins           []string
	Storage           storage.Storage
	EmailSender       auth.EmailSender
	SessionCookieName string        // empty disables cookie mode
	CSRFCookieName    string        // defaults to "csrf"
	OTPTTL            time.Duration // defaults to 10m
	SessionTTL        time.Duration // defaults to 30 * 24h
	Now               func() time.Time

	// GetOrCreateUserID resolves an email to a stable userID. Host apps own
	// the user table; the SDK never persists email -> userID itself. If nil,
	// Mount uses a no-op that returns the email itself as the userID (fine
	// for demo/parity, NOT recommended for production).
	GetOrCreateUserID func(email string) (string, error)

	// EmailSignIn optionally replaces the complete OTP verification, identity
	// resolution and session insertion sequence. It must return only after its
	// transaction commits. Errors never fall back to the default issuer. The
	// host owns eligibility, attempt accounting and atomicity when configured.
	EmailSignIn func(context.Context, EmailSignInInput) (EmailSignInResult, error)
}

// EmailSignInInput contains validated request fields and the effective policy.
// Now must be sampled after acquiring the transaction's database write lock.
type EmailSignInInput struct {
	OTPID, Code   string
	SessionTTL    time.Duration
	MaxAttempts   int
	Now           func() time.Time
	UserAgent, IP *string
}

// EmailSignInResult uses the existing successful HTTP response shape.
type EmailSignInResult struct {
	SessionToken string          `json:"sessionToken"`
	User         EmailSignInUser `json:"user"`
}

type EmailSignInUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}
