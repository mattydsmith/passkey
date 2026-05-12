package auth

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

func TestSessionRoundTrip_Bearer(t *testing.T) {
	s, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Unix(1_700_000_000, 0)

	token, err := CreateSession(s, "user-1", 24*time.Hour, now, nil, nil)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	userID, err := RequireSession(s, req, "session", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("require: %v", err)
	}
	if userID != "user-1" {
		t.Errorf("userID = %q", userID)
	}
}

func TestSessionRoundTrip_Cookie(t *testing.T) {
	s, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Unix(1_700_000_000, 0)
	token, _ := CreateSession(s, "user-2", 24*time.Hour, now, nil, nil)

	req := httptest.NewRequest("GET", "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: token})
	userID, err := RequireSession(s, req, "session", now)
	if err != nil {
		t.Fatal(err)
	}
	if userID != "user-2" {
		t.Errorf("userID = %q", userID)
	}
}

func TestRequireSession_Expired(t *testing.T) {
	s, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Unix(1_700_000_000, 0)
	token, _ := CreateSession(s, "u", time.Minute, now, nil, nil)

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	if _, err := RequireSession(s, req, "session", now.Add(2*time.Minute)); err != ErrUnauthenticated {
		t.Errorf("want ErrUnauthenticated, got %v", err)
	}
}
