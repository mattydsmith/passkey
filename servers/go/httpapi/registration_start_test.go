package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/passkey"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

type registrationStartStorage struct {
	storage.Storage
	reads int
}

func (s *registrationStartStorage) ListPasskeys(id string) ([]storage.Passkey, error) {
	s.reads++
	return s.Storage.ListPasskeys(id)
}

func TestRegistrationStartHTTP(t *testing.T) {
	for _, mode := range []string{"default", "success", "denied", "unavailable", "failure", "missing-session"} {
		for _, cookie := range []bool{false, true} {
			t.Run(mode+map[bool]string{false: "/bearer", true: "/cookie"}[cookie], func(t *testing.T) {
				raw, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
				if err != nil {
					t.Fatal(err)
				}
				defer raw.Close()
				s := &registrationStartStorage{Storage: raw}
				at := time.Now()
				token, err := auth.CreateSession(s, "owner", time.Hour, at, nil, nil)
				if err != nil {
					t.Fatal(err)
				}
				cfg := Config{Storage: s, RPID: "example.com", RPName: "Admission test", Origins: []string{"https://example.com"}, Now: func() time.Time { return at }}
				if cookie {
					cfg.SessionCookieName = "session"
				}
				calls := 0
				if mode != "default" {
					cfg.PasskeyRegistrationStart = func(ctx context.Context, in passkey.RegistrationStartInput) error {
						calls++
						if ctx != in.Request.Context() || in.UserID != "owner" || !bytes.Equal(in.SessionHash, auth.HashToken(token)) || !in.Now().Equal(at) {
							t.Fatal("missing host identity/session/request/clock")
						}
						switch mode {
						case "denied":
							return auth.ErrUnauthenticated
						case "unavailable":
							return auth.ErrSessionUnavailable
						case "failure":
							return errors.New("private read details")
						}
						return nil
					}
				}
				router := chi.NewRouter()
				if err = Mount(router, cfg); err != nil {
					t.Fatal(err)
				}
				r := httptest.NewRequest("POST", "/auth/passkey/register/start", nil)
				if mode != "missing-session" {
					if cookie {
						r.AddCookie(&http.Cookie{Name: "session", Value: token})
					} else {
						r.Header.Set("Authorization", "Bearer "+token)
					}
				}
				if cookie {
					r.AddCookie(&http.Cookie{Name: "csrf", Value: "test"})
					r.Header.Set("X-CSRF-Token", "test")
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, r)
				status, wantCalls, wantReads := 200, 1, 0
				code := ""
				switch mode {
				case "default":
					wantCalls = 0
					wantReads = 1
				case "denied", "missing-session":
					status = 401
					code = "unauthenticated"
					if mode == "missing-session" {
						wantCalls = 0
					}
				case "unavailable", "failure":
					status = 503
					code = "session_unavailable"
				}
				var body map[string]any
				if err = json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if w.Code != status || calls != wantCalls || s.reads != wantReads {
					t.Fatalf("status=%d host=%d default_reads=%d; want %d/%d/%d", w.Code, calls, s.reads, status, wantCalls, wantReads)
				}
				if status == 200 {
					if body["registrationId"] == nil || body["options"] == nil {
						t.Fatal("missing admitted ceremony")
					}
					options := body["options"].(map[string]any)
					user := options["user"].(map[string]any)
					if user["id"] != base64.RawURLEncoding.EncodeToString([]byte("owner")) || user["name"] != "owner" || user["displayName"] != "owner" || options["challenge"] == "" {
						t.Fatalf("wrong admitted identity/options: %v", options)
					}
				} else {
					if body["error"] != code || body["registrationId"] != nil || body["options"] != nil {
						t.Fatalf("refusal=%v", body)
					}
				}
				if len(w.Result().Cookies()) != 0 || bytes.Contains(w.Body.Bytes(), []byte("private read")) {
					t.Fatal("unexpected credential or private detail")
				}
				if (w.Header().Get("Retry-After") == "1") != (status == 503) {
					t.Fatal("incorrect retry hint")
				}
			})
		}
	}
}
