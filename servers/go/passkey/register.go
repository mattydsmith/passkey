package passkey

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// HandleRegisterStart begins a passkey registration ceremony. Requires an
// authenticated session.
func HandleRegisterStart(s storage.Storage, wa *webauthn.WebAuthn, pending *PendingRegistrations, cookieName string, now func() time.Time, admit ...RegistrationStart) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, sessionHash, err := auth.RequireSessionWithHash(s, r, cookieName, now())
		if err != nil {
			writeSessionError(w, err)
			return
		}
		var u *sdkUser
		if len(admit) > 0 && admit[0] != nil {
			err = admit[0](r.Context(), RegistrationStartInput{UserID: userID, SessionHash: append([]byte(nil), sessionHash...), Now: now, Request: r})
			if err != nil {
				if !errors.Is(err, auth.ErrUnauthenticated) {
					err = auth.ErrSessionUnavailable
				}
				writeSessionError(w, err)
				return
			}
			// BeginRegistration uses identity only; existing keys are not needed.
			u = &sdkUser{id: userID}
		} else {
			u, err = loadUser(s, userID)
			if err != nil {
				writeJSONError(w, 500, "internal_error", "Failed to load user")
				return
			}
		}
		creation, sessionData, err := wa.BeginRegistration(u,
			webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
				ResidentKey:      protocol.ResidentKeyRequirementPreferred,
				UserVerification: protocol.VerificationPreferred,
			}),
		)
		if err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		regID, err := auth.RandomToken(16)
		if err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		pending.PutForSession(regID, userID, sessionHash, *sessionData)
		writeJSON(w, 200, map[string]any{
			"registrationId": regID,
			"options":        creation.Response,
		})
	}
}

// HandleRegisterFinish completes a passkey registration ceremony.
func HandleRegisterFinish(s storage.Storage, wa *webauthn.WebAuthn, pending *PendingRegistrations, cookieName string, now func() time.Time, commit ...RegistrationCommit) http.HandlerFunc {
	type req struct {
		RegistrationID string          `json:"registrationId"`
		Credential     json.RawMessage `json:"credential"`
		DeviceName     *string         `json:"deviceName,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		userID, sessionHash, err := auth.RequireSessionWithHash(s, r, cookieName, now())
		if err != nil {
			writeSessionError(w, err)
			return
		}
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, 400, "invalid_request", "bad body")
			return
		}
		var sess webauthn.SessionData
		var ok bool
		var host RegistrationCommit
		if len(commit) > 0 {
			host = commit[0]
		}
		if host != nil {
			sess, ok = pending.TakeForSession(body.RegistrationID, userID, sessionHash)
		} else {
			sess, ok = pending.TakeForUser(body.RegistrationID, userID)
		}
		if !ok {
			writeJSONError(w, 401, "invalid_credential", "Registration not available")
			return
		}
		u, err := loadUser(s, userID)
		if err != nil {
			writeJSONError(w, 500, "internal_error", "Failed to load user")
			return
		}
		parsedReq, err := http.NewRequest("POST", r.URL.String(), bytes.NewReader(body.Credential))
		if err != nil {
			writeJSONError(w, 400, "invalid_credential", err.Error())
			return
		}
		parsedReq.Header.Set("Content-Type", "application/json")
		cred, err := wa.FinishRegistration(u, sess, parsedReq)
		if err != nil {
			writeJSONError(w, 401, "invalid_credential", err.Error())
			return
		}
		verified := storage.Passkey{
			CredentialID:   cred.ID,
			UserID:         userID,
			PublicKey:      cred.PublicKey,
			SignCount:      cred.Authenticator.SignCount,
			AAGUID:         cred.Authenticator.AAGUID,
			DeviceName:     body.DeviceName,
			BackupEligible: cred.Flags.BackupEligible,
			BackupState:    cred.Flags.BackupState,
			CreatedAt:      now(),
		}
		if host != nil {
			err = host(r.Context(), RegistrationInput{Credential: verified, SessionHash: sessionHash, Now: now, Request: r})
		} else {
			err = s.CreatePasskey(verified)
		}
		if err != nil {
			if errors.Is(err, auth.ErrSessionUnavailable) {
				writeSessionError(w, err)
			} else if errors.Is(err, ErrSignInDenied) || errors.Is(err, auth.ErrUnauthenticated) {
				writeJSONError(w, 401, "invalid_credential", "Registration not allowed")
			} else {
				writeJSONError(w, 500, "internal_error", "Registration failed")
			}
			return
		}
		writeJSON(w, 200, map[string]string{"passkeyId": CredIDToString(cred.ID)})
	}
}
