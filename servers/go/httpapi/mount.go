package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/passkey"
)

// Mount wires the SDK's auth routes onto r. The full route set is added in
// later phases; Phase 3 wires the email/session endpoints.
func Mount(r chi.Router, cfg Config) error {
	if cfg.Storage == nil {
		return ErrStorageRequired
	}
	if cfg.EmailSender == nil {
		cfg.EmailSender = auth.NewLoggingEmailer()
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.OTPTTL == 0 {
		cfg.OTPTTL = 10 * time.Minute
	}
	if cfg.SessionTTL == 0 {
		cfg.SessionTTL = 30 * 24 * time.Hour
	}
	if cfg.GetOrCreateUserID == nil {
		cfg.GetOrCreateUserID = func(email string) (string, error) { return email, nil }
	}
	if cfg.CSRFCookieName == "" {
		cfg.CSRFCookieName = "csrf"
	}

	r.Route("/auth", func(r chi.Router) {
		r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, 200, map[string]bool{"ok": true})
		})
		r.Post("/email/start", handleEmailStart(cfg))
		r.Post("/email/verify", handleEmailVerify(cfg))
		r.Get("/me", handleMe(cfg))
		r.Post("/sign-out", handleSignOut(cfg))
		r.Get("/sessions", handleListSessions(cfg))

		// Passkey ceremonies + management
		wa, err := passkey.NewProvider(cfg.RPID, cfg.RPName, cfg.Origins)
		if err != nil {
			slog.Error("passkey provider init failed", "err", err)
		} else {
			pendingReg := passkey.NewPendingRegistrations()
			pendingSign := passkey.NewPendingSignIns()
			r.Post("/passkey/register/start",
				passkey.HandleRegisterStart(cfg.Storage, wa, pendingReg, cfg.SessionCookieName, cfg.Now))
			r.Post("/passkey/register/finish",
				passkey.HandleRegisterFinish(cfg.Storage, wa, pendingReg, cfg.SessionCookieName, cfg.Now))
			r.Post("/passkey/sign-in/start",
				passkey.HandleSignInStart(cfg.Storage, wa, pendingSign))
			r.Post("/passkey/sign-in/finish",
				passkey.HandleSignInFinish(
					cfg.Storage, wa, pendingSign, cfg.SessionTTL,
					cfg.SessionCookieName, cfg.CSRFCookieName, cfg.Now,
					setSessionCookie, setCSRFCookie,
				))
			r.Get("/passkeys", passkey.HandleListPasskeys(cfg.Storage, cfg.SessionCookieName, cfg.Now))
			r.Delete("/passkeys/{id}", passkey.HandleDeletePasskey(cfg.Storage, cfg.SessionCookieName, cfg.Now))
		}
	})
	return nil
}

func handleEmailStart(cfg Config) http.HandlerFunc {
	type req struct{ Email string `json:"email"` }
	type resp struct {
		OTPID            string `json:"otpId"`
		ExpiresInSeconds int    `json:"expiresInSeconds"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" {
			writeJSON(w, 400, errBody{"invalid_request", "email required"})
			return
		}
		email := strings.ToLower(strings.TrimSpace(body.Email))
		id, ttl, err := auth.StartEmailOTP(cfg.Storage, cfg.EmailSender, email, cfg.OTPTTL, cfg.Now())
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, 200, resp{OTPID: id, ExpiresInSeconds: ttl})
	}
}

func handleEmailVerify(cfg Config) http.HandlerFunc {
	type req struct {
		OTPID string `json:"otpId"`
		Code  string `json:"code"`
	}
	type respUser struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	type resp struct {
		SessionToken string   `json:"sessionToken"`
		User         respUser `json:"user"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var body req
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.OTPID == "" || body.Code == "" {
			writeJSON(w, 400, errBody{"invalid_request", "otpId and code required"})
			return
		}
		email, err := auth.VerifyEmailOTP(cfg.Storage, body.OTPID, body.Code, cfg.Now())
		if err != nil {
			writeError(w, err)
			return
		}
		userID, err := cfg.GetOrCreateUserID(email)
		if err != nil {
			writeError(w, err)
			return
		}
		ua := r.Header.Get("User-Agent")
		ip := r.Header.Get("X-Forwarded-For")
		var uap, ipp *string
		if ua != "" {
			uap = &ua
		}
		if ip != "" {
			ipp = &ip
		}
		token, err := auth.CreateSession(cfg.Storage, userID, cfg.SessionTTL, cfg.Now(), uap, ipp)
		if err != nil {
			writeError(w, err)
			return
		}
		if cfg.SessionCookieName != "" {
			setSessionCookie(w, r, cfg.SessionCookieName, token, int(cfg.SessionTTL.Seconds()))
		}
		writeJSON(w, 200, resp{
			SessionToken: token,
			User:         respUser{ID: userID, Email: email},
		})
	}
}

func handleMe(cfg Config) http.HandlerFunc {
	type respUser struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := auth.RequireSession(cfg.Storage, r, cfg.SessionCookieName, cfg.Now())
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, 200, map[string]respUser{"user": {ID: userID, Email: ""}})
	}
}

func handleSignOut(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth.SignOut(cfg.Storage, r, cfg.SessionCookieName)
		if cfg.SessionCookieName != "" {
			clearSessionCookie(w, cfg.SessionCookieName)
			clearCSRFCookie(w, cfg.CSRFCookieName)
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

func handleListSessions(cfg Config) http.HandlerFunc {
	type sessionItem struct {
		CreatedAt  int64  `json:"createdAt"`
		ExpiresAt  int64  `json:"expiresAt"`
		LastSeenAt int64  `json:"lastSeenAt"`
		UserAgent  string `json:"userAgent,omitempty"`
		IP         string `json:"ip,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		userID, err := auth.RequireSession(cfg.Storage, r, cfg.SessionCookieName, cfg.Now())
		if err != nil {
			writeError(w, err)
			return
		}
		sessions, err := cfg.Storage.ListSessions(userID)
		if err != nil {
			writeError(w, err)
			return
		}
		items := make([]sessionItem, 0, len(sessions))
		for _, s := range sessions {
			item := sessionItem{
				CreatedAt:  s.CreatedAt.Unix(),
				ExpiresAt:  s.ExpiresAt.Unix(),
				LastSeenAt: s.LastSeenAt.Unix(),
			}
			if s.UserAgent != nil {
				item.UserAgent = *s.UserAgent
			}
			if s.IP != nil {
				item.IP = *s.IP
			}
			items = append(items, item)
		}
		writeJSON(w, 200, map[string]any{"sessions": items})
	}
}
