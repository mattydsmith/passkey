package passkey

import (
	"context"
	"github.com/mattydsmith/passkey/servers/go/storage"
	"net/http"
	"time"
)

// RegistrationCommit owns persistence after WebAuthn verification. Recheck the
// account and initiating session under the host lifecycle writer, then persist
// the credential atomically. A failure never invokes default SDK persistence.
// The challenge is already spent, so retry requires a fresh ceremony.
type RegistrationCommit func(context.Context, RegistrationInput) error

type RegistrationInput struct {
	Credential  storage.Passkey
	SessionHash []byte
	Now         func() time.Time
	Request     *http.Request // metadata only; the body is decoded
}
