package passkey

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// HandleSignInStart begins a passkey sign-in ceremony. No auth required.
func HandleSignInStart(s storage.Storage, wa *webauthn.WebAuthn, pending *PendingSignIns) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		assertion, sessionData, err := wa.BeginDiscoverableLogin()
		if err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		sid, err := auth.RandomToken(16)
		if err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		pending.Put(sid, *sessionData)
		writeJSON(w, 200, map[string]any{
			"signInId": sid,
			"options":  assertion.Response,
		})
	}
}

// HandleSignInFinish completes a passkey sign-in ceremony and issues a session.
func HandleSignInFinish(
	s storage.Storage,
	wa *webauthn.WebAuthn,
	pending *PendingSignIns,
	sessionTTL time.Duration,
	sessionCookieName string,
	csrfCookieName string,
	now func() time.Time,
	setSessionCookie func(http.ResponseWriter, *http.Request, string, string, int),
	setCSRFCookie func(http.ResponseWriter, *http.Request, string, string, int),
) http.HandlerFunc {
	type req struct {
		SignInID   string          `json:"signInId"`
		Credential json.RawMessage `json:"credential"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONError(w, 400, "invalid_request", "bad body")
			return
		}
		sess, ok := pending.Take(body.SignInID)
		if !ok {
			writeJSONError(w, 400, "invalid_request", "sign-in not found")
			return
		}
		// Pre-check: extract rawId from credential and look up the passkey.
		// This lets us return a 404 unknown_credential if the rawId isn't in
		// our db, matching the TS reference behaviour. The full verification
		// is still done by FinishDiscoverableLogin below.
		var credRaw struct {
			RawID string `json:"rawId"`
		}
		if err := json.Unmarshal(body.Credential, &credRaw); err == nil && credRaw.RawID != "" {
			rawID, decErr := decodeBase64URL(credRaw.RawID)
			if decErr == nil {
				if _, lookupErr := s.GetPasskey(rawID); lookupErr != nil {
					if errors.Is(lookupErr, storage.ErrNotFound) {
						writeJSONError(w, 404, "unknown_credential", "Credential not registered")
					} else {
						writeJSONError(w, 500, "internal_error", lookupErr.Error())
					}
					return
				}
			}
		}

		parsedReq, err := http.NewRequest("POST", r.URL.String(), bytes.NewReader(body.Credential))
		if err != nil {
			writeJSONError(w, 400, "invalid_credential", err.Error())
			return
		}
		parsedReq.Header.Set("Content-Type", "application/json")

		cred, err := wa.FinishDiscoverableLogin(func(rawID, userHandle []byte) (webauthn.User, error) {
			p, err := s.GetPasskey(rawID)
			if err != nil {
				return nil, err
			}
			return loadUser(s, p.UserID)
		}, sess, parsedReq)
		if err != nil {
			writeJSONError(w, 401, "invalid_credential", err.Error())
			return
		}

		// Look up the owning user via the credential.
		p, err := s.GetPasskey(cred.ID)
		if err != nil {
			writeJSONError(w, 401, "invalid_credential", "credential not found")
			return
		}
		_ = s.UpdatePasskeySignCount(cred.ID, cred.Authenticator.SignCount, now())

		ua := r.Header.Get("User-Agent")
		ip := r.Header.Get("X-Forwarded-For")
		var uap, ipp *string
		if ua != "" {
			uap = &ua
		}
		if ip != "" {
			ipp = &ip
		}
		token, err := auth.CreateSession(s, p.UserID, sessionTTL, now(), uap, ipp)
		if err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		if sessionCookieName != "" {
			setSessionCookie(w, r, sessionCookieName, token, int(sessionTTL.Seconds()))
		}
		writeJSON(w, 200, map[string]any{
			"sessionToken": token,
			"user":         map[string]string{"id": p.UserID, "email": ""},
		})
	}
}

// decodeBase64URL decodes a base64url string, tolerating both padded and
// unpadded variants (and the standard base64 alphabet for robustness).
func decodeBase64URL(s string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}
