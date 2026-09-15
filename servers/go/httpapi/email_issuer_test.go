package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// Embedding a nil Storage makes any unintended legacy storage call panic.
// The mounted route must delegate before consuming an OTP or creating a session.
type unusedStorage struct{ storage.Storage }

func TestEmailIssuerMountedRoute(t *testing.T) {
	for _, mode := range []string{"success", "failure", "rejection", "empty", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			at := time.Unix(1700000000, 0)
			key := struct{}{}
			cfg := Config{Storage: unusedStorage{}, RPID: "example.com", Origins: []string{"https://example.com"}, SessionCookieName: "session", Now: func() time.Time { return at },
				GetOrCreateUserID: func(string) (string, error) { t.Fatal("legacy resolver called"); return "", nil },
				EmailSignIn: func(ctx context.Context, in EmailSignInInput) (EmailSignInResult, error) {
					calls++
					if ctx.Value(key) != "request" || in.OTPID != "pending" || in.Code != "123456" || in.MaxAttempts != auth.OTPMaxAttempts || in.SessionTTL != 30*24*time.Hour || !in.Now().Equal(at) || in.UserAgent == nil || *in.UserAgent != "test-agent" || in.IP == nil || *in.IP != "192.0.2.1" {
						t.Fatalf("input: %+v", in)
					}
					if mode == "failure" {
						return EmailSignInResult{}, errors.New("synthetic commit failure")
					}
					if mode == "rejection" {
						return EmailSignInResult{}, auth.ErrOTPExpired
					}
					if mode == "empty" {
						return EmailSignInResult{}, nil
					}
					return EmailSignInResult{SessionToken: "committed-token", User: EmailSignInUser{ID: "user", Email: "user@example.com"}}, nil
				},
			}
			r := chi.NewRouter()
			if err := Mount(r, cfg); err != nil {
				t.Fatal(err)
			}
			code := "123456"
			if mode == "invalid" {
				code = "abc"
			}
			req := httptest.NewRequest("POST", "/auth/email/verify", strings.NewReader(`{"otpId":"pending","code":"`+code+`"}`))
			req = req.WithContext(context.WithValue(req.Context(), key, "request"))
			req.Header.Set("User-Agent", "test-agent")
			req.Header.Set("X-Forwarded-For", "192.0.2.1")
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			status := 500
			wantCalls := 1
			switch mode {
			case "success":
				status = 200
			case "invalid":
				status = 400
				wantCalls = 0
			case "rejection":
				status = 410
			}
			if rec.Code != status || calls != wantCalls {
				t.Fatalf("status=%d calls=%d body=%s", rec.Code, calls, rec.Body.String())
			}
			if mode == "success" {
				if !strings.Contains(rec.Body.String(), `"sessionToken":"committed-token"`) || len(rec.Result().Cookies()) != 2 {
					t.Fatalf("success: %s cookies=%v", rec.Body.String(), rec.Result().Cookies())
				}
			} else if len(rec.Result().Cookies()) != 0 {
				t.Fatal("failure issued credentials")
			}
		})
	}
}
