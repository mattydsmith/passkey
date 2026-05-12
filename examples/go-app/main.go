// Package main runs an HTTP server that mounts the Passkey SDK Go server.
// Honors PORT, AUTH_ORIGINS, RP_ID. Phase 1 registers /healthz at the root;
// /auth/* and /__test/* routes are added in later phases.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mattydsmith/passkey/servers/go/httpapi"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}

	originsEnv := os.Getenv("AUTH_ORIGINS")
	var origins []string
	if originsEnv != "" {
		for _, o := range strings.Split(originsEnv, ",") {
			origins = append(origins, strings.TrimSpace(o))
		}
	} else {
		origins = []string{
			"http://localhost:3000",
			"http://localhost:3001",
			"http://localhost:5173",
		}
	}

	rpid := os.Getenv("RP_ID")
	if rpid == "" {
		rpid = "localhost"
	}

	r := chi.NewRouter()

	// Storage is wired in Phase 3 once the sqlite impl exists. For now Mount
	// requires a non-nil Storage, so pass a placeholder that satisfies the
	// (empty) interface.
	if err := httpapi.Mount(r, httpapi.Config{
		RPID:    rpid,
		RPName:  "Passkey Demo",
		Origins: origins,
		Storage: placeholderStorage{},
	}); err != nil {
		slog.Error("mount failed", "err", err)
		os.Exit(1)
	}

	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"app":"go-app"}`))
	})

	slog.Info("listening", "port", port, "origins", origins, "rpid", rpid)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		slog.Error("listen", "err", err)
		os.Exit(1)
	}
}

// placeholderStorage is a temporary nil-safe Storage so Mount accepts the
// config before the sqlite impl is wired in main. Replaced in Phase 3b.
type placeholderStorage struct{}

func (placeholderStorage) CreateSession(storage.Session) error               { return nil }
func (placeholderStorage) GetSession([]byte) (*storage.Session, error)       { return nil, storage.ErrNotFound }
func (placeholderStorage) TouchSession([]byte, time.Time) error              { return nil }
func (placeholderStorage) DeleteSession([]byte) error                        { return nil }
func (placeholderStorage) ListSessions(string) ([]storage.Session, error)    { return nil, nil }
func (placeholderStorage) CreateOTP(storage.EmailOTP) error                  { return nil }
func (placeholderStorage) GetOTP(string) (*storage.EmailOTP, error)          { return nil, storage.ErrNotFound }
func (placeholderStorage) IncrementOTPAttempts(string) (int, error)          { return 0, nil }
func (placeholderStorage) ConsumeOTP(string, time.Time) error                { return nil }
func (placeholderStorage) ForceExpireOTP(string) error                       { return nil }
func (placeholderStorage) CreatePasskey(storage.Passkey) error               { return nil }
func (placeholderStorage) GetPasskey([]byte) (*storage.Passkey, error)       { return nil, storage.ErrNotFound }
func (placeholderStorage) ListPasskeys(string) ([]storage.Passkey, error)    { return nil, nil }
func (placeholderStorage) UpdatePasskeySignCount([]byte, uint32, time.Time) error { return nil }
func (placeholderStorage) DeletePasskey([]byte) error                        { return nil }
func (placeholderStorage) Close() error                                      { return nil }
