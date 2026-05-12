package passkey

import (
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

type sdkUser struct {
	id    string
	creds []webauthn.Credential
}

func (u *sdkUser) WebAuthnID() []byte                         { return []byte(u.id) }
func (u *sdkUser) WebAuthnName() string                       { return u.id }
func (u *sdkUser) WebAuthnDisplayName() string                { return u.id }
func (u *sdkUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

// loadUser constructs a webauthn.User for `userID` populated with all
// registered credentials from storage.
func loadUser(s storage.Storage, userID string) (*sdkUser, error) {
	pks, err := s.ListPasskeys(userID)
	if err != nil {
		return nil, err
	}
	u := &sdkUser{id: userID}
	for _, p := range pks {
		u.creds = append(u.creds, webauthn.Credential{
			ID:        p.CredentialID,
			PublicKey: p.PublicKey,
			Authenticator: webauthn.Authenticator{
				AAGUID:    p.AAGUID,
				SignCount: p.SignCount,
			},
		})
	}
	return u, nil
}
