// Package main runs an HTTP server that mounts the Passkey SDK Go server.
// Honors PORT, AUTH_ORIGINS, RP_ID. Phase 3 wires /auth/{email/*, me, sign-out}
// at /auth; Phase 4 adds the passkey ceremonies.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/mattydsmith/passkey/examples/go-app/testroutes"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/httpapi"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

func main() {
	port := getenv("PORT", "3001")
	originsEnv := getenv("AUTH_ORIGINS", "")
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
	rpid := getenv("RP_ID", "localhost")

	dbDir := getenv("PASSKEY_DB_DIR", ".")
	dbPath := filepath.Join(dbDir, "app.db")
	store, err := storage.OpenSQLite(dbPath)
	if err != nil {
		slog.Error("open db", "err", err, "path", dbPath)
		os.Exit(1)
	}
	defer store.Close()

	emailer := auth.NewLoggingEmailer()

	r := chi.NewRouter()
	if err := httpapi.Mount(r, httpapi.Config{
		RPID:              rpid,
		RPName:            "Passkey Demo",
		Origins:           origins,
		Storage:           store,
		EmailSender:       emailer,
		SessionCookieName: "session",
	}); err != nil {
		slog.Error("mount failed", "err", err)
		os.Exit(1)
	}
	testroutes.MountIfTest(r, store, emailer)

	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"app":"go-app"}`))
	})

	slog.Info("listening", "port", port, "origins", origins, "rpid", rpid, "db", dbPath)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		slog.Error("listen", "err", err)
		os.Exit(1)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
