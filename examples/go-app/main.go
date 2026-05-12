// Package main runs an HTTP server that mounts the Passkey SDK Go server
// at /auth. Honors PORT, AUTH_ORIGINS, RP_ID. NODE_ENV=test additionally
// enables /__test/* routes (added in Phase 3).
package main

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mattydsmith/passkey/servers/go/httpapi"
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
// config before the sqlite impl exists. Replaced in Phase 3.
type placeholderStorage struct{}
