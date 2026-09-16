package auth

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

type ManagementOperation string

const (
	ManagementMe            ManagementOperation = "me"
	ManagementSessions      ManagementOperation = "sessions"
	ManagementPasskeys      ManagementOperation = "passkeys"
	ManagementDeletePasskey ManagementOperation = "delete_passkey"
)

// AccountManagement owns current account/session admission together with the
// named read or deletion. Return only after the host transaction ends. Never
// use a preliminary eligibility check followed by an unguarded storage call.
// This opt-in does not cover ceremonies or the initial SDK session lookup/touch.
type AccountManagement func(context.Context, ManagementInput) (ManagementResult, error)
type ManagementInput struct {
	Operation    ManagementOperation
	UserID       string
	SessionHash  []byte
	CredentialID []byte           // only for ManagementDeletePasskey
	Now          func() time.Time // sample after acquiring the lifecycle writer
	Request      *http.Request
}
type ManagementResult struct {
	Sessions []storage.Session
	Passkeys []storage.Passkey
}

// RunManagement bounds host failures and rejects foreign rows before rendering.
// ErrNotFound is public only for deletion; no host failure permits a fallback.
func RunManagement(host AccountManagement, r *http.Request, user string, hash []byte, now func() time.Time, op ManagementOperation, credential []byte) (ManagementResult, error) {
	result, err := host(r.Context(), ManagementInput{Operation: op, UserID: user, SessionHash: append([]byte(nil), hash...), CredentialID: append([]byte(nil), credential...), Now: now, Request: r})
	if err != nil {
		if errors.Is(err, ErrUnauthenticated) {
			return ManagementResult{}, ErrUnauthenticated
		}
		if op == ManagementDeletePasskey && errors.Is(err, storage.ErrNotFound) {
			return ManagementResult{}, storage.ErrNotFound
		}
		return ManagementResult{}, ErrSessionUnavailable
	}
	for _, s := range result.Sessions {
		if s.UserID != user {
			return ManagementResult{}, ErrSessionUnavailable
		}
	}
	for _, p := range result.Passkeys {
		if p.UserID != user {
			return ManagementResult{}, ErrSessionUnavailable
		}
	}
	return result, nil
}
