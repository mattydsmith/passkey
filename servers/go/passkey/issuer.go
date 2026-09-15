package passkey

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// ErrSignInDenied is a host eligibility refusal after valid WebAuthn proof.
var ErrSignInDenied = errors.New("passkey sign-in denied")

// SignInIssuer replaces counter persistence and session issuance, only after
// cryptographic verification. Commit before returning. Recheck the credential
// and host eligibility in the same transaction as counter/session persistence.
// Errors never fall back; a failed request's challenge has already been spent.
type SignInIssuer func(context.Context, SignInInput) (SignInResult, error)

type SignInInput struct {
	UserID                  string
	CredentialID, PublicKey []byte
	SignCount               uint32
	SessionTTL              time.Duration
	Now                     func() time.Time
	// Metadata only; body decoded. Forwarding headers are not trusted peer data.
	Request       *http.Request
	UserAgent, IP *string
}

type SignInResult struct {
	SessionToken string
	UserID       string
}
