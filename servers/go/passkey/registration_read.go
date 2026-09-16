package passkey

import (
	"context"
	"net/http"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

// RegistrationRead returns the passkey snapshot admitted for this initiating
// session. The host must order its current account/session/expiry checks and
// the snapshot read together with account revocation. Return ErrUnauthenticated
// for an ineligible session; other failures are reported as session_unavailable.
// Once selected, failure never falls back to unguarded SDK storage reads.
// This does not replace RegistrationCommit's final persistence checks.
type RegistrationRead func(context.Context, RegistrationReadInput) ([]storage.Passkey, error)

type RegistrationReadInput struct {
	UserID      string
	SessionHash []byte
	Now         func() time.Time
	Request     *http.Request
}
