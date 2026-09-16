package passkey

import (
	"context"
	"net/http"
	"time"
)

// RegistrationStart admits the verified initiating session before a ceremony
// is created. The host must order current account/session/expiry checks with
// account revocation. Return auth.ErrUnauthenticated for ineligibility; other
// failures become session_unavailable. Configured mode reads no passkey data.
// Final RegistrationCommit checks remain a separate host obligation.
type RegistrationStart func(context.Context, RegistrationStartInput) error

type RegistrationStartInput struct {
	UserID      string
	SessionHash []byte
	Now         func() time.Time
	Request     *http.Request
}
