package httpapi

import (
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

type sessionFailureStorage struct {
	storage.Storage
	lookup bool
}

func (s sessionFailureStorage) GetSession(hash []byte) (*storage.Session, error) {
	if s.lookup {
		return nil, errors.New("synthetic lookup failure")
	}
	return s.Storage.GetSession(hash)
}
func (s sessionFailureStorage) TouchSession([]byte, time.Time) error {
	return errors.New("synthetic touch failure")
}

func TestSessionStorageFailureAcrossMountedRoutes(t *testing.T) {
	for _, lookup := range []bool{false, true} {
		name := "touch"
		if lookup {
			name = "lookup"
		}
		t.Run(name, func(t *testing.T) {
			s, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			now := time.Now()
			token, err := auth.CreateSession(s, "user", time.Hour, now, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			router := chi.NewRouter()
			if err := Mount(router, Config{Storage: sessionFailureStorage{s, lookup}, RPID: "example.com", Origins: []string{"https://example.com"}, SessionCookieName: "session"}); err != nil {
				t.Fatal(err)
			}
			for _, mode := range []string{"bearer", "cookie"} {
				for _, route := range []struct{ method, path string }{{"GET", "/auth/me"}, {"GET", "/auth/sessions"}, {"GET", "/auth/passkeys"}, {"DELETE", "/auth/passkeys/AA"}, {"POST", "/auth/passkey/register/start"}, {"POST", "/auth/passkey/register/finish"}} {
					req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{"registrationId":"pending","credential":{}}`))
					if mode == "bearer" {
						req.Header.Set("Authorization", "Bearer "+token)
					} else {
						req.AddCookie(&http.Cookie{Name: "session", Value: token})
						req.AddCookie(&http.Cookie{Name: "csrf", Value: "matching"})
						req.Header.Set("X-CSRF-Token", "matching")
					}
					rec := httptest.NewRecorder()
					router.ServeHTTP(rec, req)
					if rec.Code != 503 || !strings.Contains(rec.Body.String(), `"error":"session_unavailable"`) || rec.Header().Get("Retry-After") != "1" || len(rec.Result().Cookies()) != 0 {
						t.Errorf("%s %s: %d %s", route.method, route.path, rec.Code, rec.Body.String())
					}
				}
			}
			if _, err := s.GetSession(auth.HashToken(token)); err != nil {
				t.Fatal("failure destroyed session", err)
			}
		})
	}
}

func TestSessionWriterContentionIsReportedAndRetryWorks(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.db")
	s, err := storage.OpenSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	db, err := sql.Open("sqlite", path+"?_txlock=immediate")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now()
	token, err := auth.CreateSession(s, "user", time.Hour, now, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	req := httptest.NewRequest("GET", "/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	cfg := Config{Storage: s, Now: func() time.Time { return now.Add(time.Minute) }}
	rec := httptest.NewRecorder()
	started := time.Now()
	handleMe(cfg).ServeHTTP(rec, req)
	elapsed := time.Since(started)
	if rec.Code != 503 || rec.Header().Get("Retry-After") != "1" {
		t.Fatalf("locked session: %d %s", rec.Code, rec.Body.String())
	}
	t.Logf("existing busy timeout returns explicit 503 after %s", elapsed)
	sess, err := s.GetSession(auth.HashToken(token))
	if err != nil {
		t.Fatal(err)
	}
	if !sess.LastSeenAt.Equal(time.Unix(now.Unix(), 0)) {
		t.Fatal("failed touch changed last seen")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	handleMe(cfg).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
	}
}
