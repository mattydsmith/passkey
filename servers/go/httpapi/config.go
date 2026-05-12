// Package httpapi exposes the public Mount entrypoint that wires the
// Passkey SDK HTTP routes onto a chi router.
package httpapi

import (
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
}
