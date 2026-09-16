package passkey

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// HandleListPasskeys returns the authenticated user's passkeys.
func HandleListPasskeys(s storage.Storage, cookieName string, now func() time.Time, management ...auth.AccountManagement) http.HandlerFunc {
	type item struct {
		ID         string  `json:"id"`
		DeviceName *string `json:"deviceName"`
		CreatedAt  int64   `json:"createdAt"`
		LastUsedAt *int64  `json:"lastUsedAt"`
		Transports *string `json:"transports"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		userID, hash, err := auth.RequireSessionWithHash(s, r, cookieName, now())
		if err != nil {
			writeSessionError(w, err)
			return
		}
		var pks []storage.Passkey
		if len(management) > 0 && management[0] != nil {
			var result auth.ManagementResult
			result, err = auth.RunManagement(management[0], r, userID, hash, now, auth.ManagementPasskeys, nil)
			if err != nil {
				writeSessionError(w, err)
				return
			}
			pks = result.Passkeys
		} else {
			pks, err = s.ListPasskeys(userID)
		}
		if err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		out := make([]item, 0, len(pks))
		for _, p := range pks {
			var lu *int64
			if p.LastUsedAt != nil {
				v := p.LastUsedAt.Unix()
				lu = &v
			}
			out = append(out, item{
				ID:         CredIDToString(p.CredentialID),
				DeviceName: p.DeviceName,
				CreatedAt:  p.CreatedAt.Unix(),
				LastUsedAt: lu,
				Transports: p.Transports,
			})
		}
		writeJSON(w, 200, map[string]any{"passkeys": out})
	}
}

// HandleDeletePasskey removes a passkey owned by the authenticated user.
// Returns unknown_credential (404) if the passkey doesn't belong to them.
func HandleDeletePasskey(s storage.Storage, cookieName string, now func() time.Time, management ...auth.AccountManagement) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, hash, err := auth.RequireSessionWithHash(s, r, cookieName, now())
		if err != nil {
			writeSessionError(w, err)
			return
		}
		idParam := chi.URLParam(r, "id")
		credID, err := CredIDFromString(idParam)
		if err != nil {
			writeJSONError(w, 400, "invalid_request", "bad id")
			return
		}
		if len(management) > 0 && management[0] != nil {
			_, err = auth.RunManagement(management[0], r, userID, hash, now, auth.ManagementDeletePasskey, credID)
			if errors.Is(err, storage.ErrNotFound) {
				writeJSONError(w, 404, "unknown_credential", "Not yours")
			} else if err != nil {
				writeSessionError(w, err)
			} else {
				writeJSON(w, 200, map[string]bool{"ok": true})
			}
			return
		}
		p, err := s.GetPasskey(credID)
		if err != nil || p.UserID != userID {
			writeJSONError(w, 404, "unknown_credential", "Not yours")
			return
		}
		if err := s.DeletePasskey(credID); err != nil {
			writeJSONError(w, 500, "internal_error", err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}
