package passkey

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// HandleListPasskeys returns the authenticated user's passkeys.
func HandleListPasskeys(s storage.Storage, cookieName string, now func() time.Time) http.HandlerFunc {
	type item struct {
		ID         string  `json:"id"`
		DeviceName *string `json:"deviceName"`
		CreatedAt  int64   `json:"createdAt"`
		LastUsedAt *int64  `json:"lastUsedAt"`
		Transports *string `json:"transports"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := auth.RequireSession(s, r, cookieName, now())
		if err != nil {
			writeJSONError(w, 401, "unauthenticated", "Authentication required")
			return
		}
		pks, err := s.ListPasskeys(userID)
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
func HandleDeletePasskey(s storage.Storage, cookieName string, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := auth.RequireSession(s, r, cookieName, now())
		if err != nil {
			writeJSONError(w, 401, "unauthenticated", "Authentication required")
			return
		}
		idParam := chi.URLParam(r, "id")
		credID, err := CredIDFromString(idParam)
		if err != nil {
			writeJSONError(w, 400, "invalid_request", "bad id")
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
