package passkey

import (
	"errors"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"log/slog"
	"net/http"
)

func writeSessionError(w http.ResponseWriter, err error) {
	if errors.Is(err, auth.ErrSessionUnavailable) {
		slog.Error("session unavailable", "err", err)
		w.Header().Set("Retry-After", "1")
		writeJSONError(w, 503, "session_unavailable", "Session temporarily unavailable")
		return
	}
	writeJSONError(w, 401, "unauthenticated", "Authentication required")
}
