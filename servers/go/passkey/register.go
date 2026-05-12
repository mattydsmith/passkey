package passkey

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// HandleRegisterStart begins a passkey registration ceremony. Requires an
// authenticated session.
func HandleRegisterStart(s storage.Storage, wa *webauthn.WebAuthn, pending *PendingRegistrations, cookieName string, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := auth.RequireSession(s, r, cookieName, now())
		if err != nil {
			writeJSONError(w, 401, "unauthenticated", "Authentication required")
			return
		}
		u, err := loadUser(s, userID)
		if err != nil {
			writeJSONError(w, 500, "internal_error", "Failed to load user")
			return
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
		pending.Put(regID, userID, *sessionData)
		writeJSON(w, 200, map[string]any{
			"registrationId": regID,
			"options":        creation.Response,
		})
	}
}

// HandleRegisterFinish completes a passkey registration ceremony.
func HandleRegisterFinish(s storage.Storage, wa *webauthn.WebAuthn, pending *PendingRegistrations, cookieName string, now func() time.Time) http.HandlerFunc {
	type req struct {
		RegistrationID string          `json:"registrationId"`
		Credential     json.RawMessage `json:"credential"`
		DeviceName     *string         `json:"deviceName,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := auth.RequireSession(s, r, cookieName, now()); err != nil {
			writeJSONError(w, 401, "unauthenticated", "Authentication required")
			return
		}
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, 400, "invalid_request", "bad body")
			return
		}
		userID, sess, ok := pending.Take(body.RegistrationID)
		if !ok {
			writeJSONError(w, 400, "invalid_request", "registration not found")
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
		if err := s.CreatePasskey(storage.Passkey{
			CredentialID: cred.ID,
			UserID:       userID,
			PublicKey:    cred.PublicKey,
			SignCount:    cred.Authenticator.SignCount,
			AAGUID:       cred.Authenticator.AAGUID,
			DeviceName:   body.DeviceName,
			CreatedAt:    now(),
		}); err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"passkeyId": CredIDToString(cred.ID)})
	}
}
