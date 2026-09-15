package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

type startStorageSpy struct {
	storage.Storage
	writes int
}

func (s *startStorageSpy) CreateOTP(storage.EmailOTP) error { s.writes++; return nil }

type startSenderSpy struct{ calls int }

func (s *startSenderSpy) SendOTP(string, string) error { s.calls++; return nil }

func TestEmailStartHookMounted(t *testing.T) {
	for _, mode := range []string{"success", "error", "empty", "whitespace", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			st, sender := &startStorageSpy{}, &startSenderSpy{}
			calls := 0
			now := time.Unix(1700000000, 0)
			key := struct{}{}
			cfg := Config{Storage: st, EmailSender: sender, RPID: "example.com", Origins: []string{"https://example.com"}, SessionCookieName: "session", OTPTTL: 15 * time.Minute, Now: func() time.Time { return now },
				EmailStart: func(ctx context.Context, in EmailStartInput) (EmailStartResult, error) {
					calls++
					if in.Email != "user@example.com" || in.OTPTTL != 15*time.Minute || !in.Now().Equal(now) || ctx.Value(key) != "request" || in.Request.RemoteAddr != "192.0.2.11:1234" || in.Request.Header.Get("X-Forwarded-For") != "untrusted" {
						t.Fatal("incorrect hook input")
					}
					if mode == "error" {
						return EmailStartResult{}, errors.New("synthetic reservation failure")
					}
					if mode == "empty" {
						return EmailStartResult{}, nil
					}
					if mode == "whitespace" {
						return EmailStartResult{OTPID: "  "}, nil
					}
					return EmailStartResult{OTPID: "opaque-host-id"}, nil
				},
			}
			r := chi.NewRouter()
			if err := Mount(r, cfg); err != nil {
				t.Fatal(err)
			}
			email := " USER@EXAMPLE.COM "
			if mode == "invalid" {
				email = "not-an-email"
			}
			req := httptest.NewRequest("POST", "/auth/email/start", strings.NewReader(`{"email":"`+email+`"}`))
			req = req.WithContext(context.WithValue(req.Context(), key, "request"))
			req.RemoteAddr = "192.0.2.11:1234"
			req.Header.Set("X-Forwarded-For", "untrusted")
			res := httptest.NewRecorder()
			r.ServeHTTP(res, req)
			want, callsWant := 500, 1
			if mode == "success" {
				want = 200
			}
			if mode == "invalid" {
				want = 400
				callsWant = 0
			}
			if res.Code != want || calls != callsWant || st.writes != 0 || sender.calls != 0 || len(res.Result().Cookies()) != 0 {
				t.Fatalf("status=%d hook=%d legacy writes=%d sends=%d", res.Code, calls, st.writes, sender.calls)
			}
			if mode == "success" && !strings.Contains(res.Body.String(), `"otpId":"opaque-host-id","expiresInSeconds":900`) {
				t.Fatalf("body=%s", res.Body.String())
			}
		})
	}
}
