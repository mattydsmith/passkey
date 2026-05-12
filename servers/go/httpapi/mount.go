package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Mount wires the SDK's auth routes onto r. The full route set is added in
// later phases; Phase 1 only registers /healthz at the router root.
func Mount(r chi.Router, cfg Config) error {
	if cfg.Storage == nil {
		return ErrStorageRequired
	}
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	return nil
}
