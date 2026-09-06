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

	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

type failingDeleteStorage struct{ storage.Storage }

func (s failingDeleteStorage) DeleteSession([]byte) error {
	return errors.New("injected delete failure")
}

func TestSignOutDoesNotClaimSuccessOrClearCookiesAfterDeleteFailure(t *testing.T) {
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
	req := httptest.NewRequest("POST", "/auth/sign-out", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: token})
	rec := httptest.NewRecorder()
	handleSignOut(Config{Storage: failingDeleteStorage{s}, SessionCookieName: "session", CSRFCookieName: "csrf"}).ServeHTTP(rec, req)
	if rec.Code != 500 {
		t.Errorf("status=%d want 500; body=%s", rec.Code, rec.Body.String())
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Errorf("failure must keep cookies for retry: %v", rec.Result().Cookies())
	}
	if _, err := auth.RequireSession(s, req, "session", now); err != nil {
		t.Fatalf("failed deletion unexpectedly revoked session: %v", err)
	}
}

func TestSignOutUnderWriterContention(t *testing.T) {
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
	req := httptest.NewRequest("POST", "/auth/sign-out", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	cfg := Config{Storage: s, SessionCookieName: "session", CSRFCookieName: "csrf"}
	rec := httptest.NewRecorder()
	// The writer remains locked beyond the SDK's five-second timeout.
	handleSignOut(cfg).ServeHTTP(rec, req)
	if rec.Code != 500 || !strings.Contains(rec.Body.String(), `"error":"internal_error"`) {
		t.Fatalf("locked deletion: %d %s", rec.Code, rec.Body.String())
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Fatal("failed revocation cleared cookies")
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.RequireSession(s, req, "session", now); err != nil {
		t.Fatalf("session should remain available after failed deletion: %v", err)
	}
	rec = httptest.NewRecorder()
	handleSignOut(cfg).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("retry: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := auth.RequireSession(s, req, "session", now); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("successful revocation still authenticates: %v", err)
	}
}
