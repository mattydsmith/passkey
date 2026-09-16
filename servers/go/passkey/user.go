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
			// go-webauthn compares the asserted BackupEligible flag against
			// the stored value on every login (webauthn/login.go:371). If we
			// leave Flags zero-valued here, every synced-passkey assertion
			// (BE=1) fails against the zero (BE=0) with "Backup Eligible flag
			// inconsistency detected during login validation".
			Flags: webauthn.CredentialFlags{
				BackupEligible: p.BackupEligible,
				BackupState:    p.BackupState,
			},
		})
	}
	return u, nil
}
