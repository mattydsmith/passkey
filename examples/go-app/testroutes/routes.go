// Package testroutes registers /__test/* endpoints behind NODE_ENV=test.
// These mirror the test-only routes on examples/hono-app and exist solely
// so the parity runner can fetch the last-sent OTP and force-expire OTPs.
package testroutes

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// MountIfTest registers /__test/* routes only when NODE_ENV=test.
func MountIfTest(r chi.Router, store storage.Storage, em *auth.LoggingEmailer) {
	if os.Getenv("NODE_ENV") != "test" {
		return
	}
	r.Get("/__test/last-otp", func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("NODE_ENV") != "test" { // belt-and-braces
			http.NotFound(w, r)
			return
		}
		email := r.URL.Query().Get("email")
		code := em.LastCode(email)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
	})
	r.Post("/__test/force-expire-otp", func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("NODE_ENV") != "test" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			OTPID string `json:"otpId"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.OTPID == "" {
			http.Error(w, `{"error":"invalid_request"}`, 400)
			return
		}
		_ = store.ForceExpireOTP(body.OTPID)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})
}
