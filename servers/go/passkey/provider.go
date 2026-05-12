// Package passkey owns the WebAuthn ceremonies and the in-memory pending
// challenge maps. Built on github.com/go-webauthn/webauthn.
package passkey

import "github.com/go-webauthn/webauthn/webauthn"

// NewProvider builds a *webauthn.WebAuthn configured for this RP.
func NewProvider(rpID, rpName string, origins []string) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: rpName,
		RPOrigins:     origins,
	})
}
