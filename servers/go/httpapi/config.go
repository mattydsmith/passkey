// Package httpapi exposes the public Mount entrypoint that wires the
// Passkey SDK HTTP routes onto a chi router.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/passkey"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// Config controls how Mount wires routes. All fields except Storage are
// optional — defaults are applied in Mount.
type Config struct {
	// AccountManagement owns current admission and metadata reads/passkey deletion.
	// Nil preserves the default SDK behavior.
	AccountManagement auth.AccountManagement
	// PasskeyRegistration commits a verified registration with host lifecycle and
	// initiating-session checks. It must commit before success; no fallback.
	PasskeyRegistration passkey.RegistrationCommit
	// PasskeyRegistrationStart optionally owns start-side account/session admission.
	// Configured mode needs no passkey data read; nil retains default behavior.
	PasskeyRegistrationStart passkey.RegistrationStart
	// PasskeySignIn owns eligibility, credential recheck, counter update and session
	// commit after successful WebAuthn verification. Never falls back on error.
	PasskeySignIn     passkey.SignInIssuer
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

	// EmailStart optionally owns the complete email-start policy, reservation,
	// delivery and activation flow. No default storage or sender runs when set.
	// The host must return only after its decision is durable. For refused
	// addresses, return an opaque ID with the same public shape when required
	// by the host's enumeration policy. Errors never fall back to default start.
	EmailStart func(context.Context, EmailStartInput) (EmailStartResult, error)

	// EmailSignIn optionally replaces the complete OTP verification, identity
	// resolution and session insertion sequence. It must return only after its
	// transaction commits. Errors never fall back to the default issuer. The
	// host owns eligibility, attempt accounting and atomicity when configured.
	EmailSignIn func(context.Context, EmailSignInInput) (EmailSignInResult, error)
}

// EmailSignInInput contains validated request fields and the effective policy.
// Now must be sampled after acquiring the transaction's database write lock.
type EmailSignInInput struct {
	// Request is metadata only; its body is already decoded. Legacy IP and
	// forwarding headers are untrusted until the host establishes proxy trust.
	Request       *http.Request
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

// EmailStartInput carries normalized validated email and effective policy.
// Request is for metadata only (body already decoded). Forwarded headers are
// untrusted: the host must establish its own transport/proxy trust boundary.
// Sample Now only after acquiring any database writer used by host policy.
type EmailStartInput struct {
	// OriginalEmail preserves input before trimming or Unicode case folding.
	// Use it for policies that reject characters normalization would erase.
	OriginalEmail string
	Email         string
	OTPTTL        time.Duration
	Now           func() time.Time
	Request       *http.Request
}

// EmailStartResult leaves the public lifetime fixed to the configured policy.
type EmailStartResult struct{ OTPID string }
