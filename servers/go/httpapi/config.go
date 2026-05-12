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
}
