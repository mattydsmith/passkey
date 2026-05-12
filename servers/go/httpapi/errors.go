package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/mattydsmith/passkey/servers/go/auth"
)

// ErrStorageRequired is returned by Mount when cfg.Storage is nil.
var ErrStorageRequired = errors.New("httpapi: Config.Storage is required")

type errBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		writeJSON(w, 401, errBody{"unauthenticated", "Authentication required"})
	case errors.Is(err, auth.ErrInvalidOTP):
		writeJSON(w, 401, errBody{"invalid_otp", "Invalid OTP"})
	case errors.Is(err, auth.ErrOTPExpired):
		writeJSON(w, 410, errBody{"otp_expired", "OTP expired"})
	case errors.Is(err, auth.ErrOTPAttemptsExceeded):
		writeJSON(w, 429, errBody{"otp_attempts_exceeded", "Too many attempts"})
	default:
		slog.Error("internal error", "err", err)
		writeJSON(w, 500, errBody{"internal_error", "Internal error"})
	}
}
