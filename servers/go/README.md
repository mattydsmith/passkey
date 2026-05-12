# Passkey SDK — Go server

Peer implementation of the Passkey SDK to `@mattsmith/passkey-sdk-hono`. Exposes
HTTP routes that conform to `spec/protocol.md`. Mount on any `chi` router.

## Quickstart

The Phase 1 surface is just `Mount` + a healthz route. Real ceremonies land in
Phase 3 (storage + email OTP) and Phase 4 (passkey ceremonies). After Phase 3
you'll be able to write:

```go
import (
    "github.com/go-chi/chi/v5"
    "github.com/mattydsmith/passkey/servers/go/httpapi"
    "github.com/mattydsmith/passkey/servers/go/storage"
)

r := chi.NewRouter()
db, _ := storage.OpenSQLite("app.db")  // available after Phase 3
httpapi.Mount(r, httpapi.Config{
    RPID:    "example.com",
    RPName:  "Example",
    Origins: []string{"https://example.com"},
    Storage: db,
})
```

For now, see `examples/go-app/main.go` for what runs against the current Phase 1
build.

## Tests

```
make test
```

Cross-impl conformance is verified via `pnpm test:parity --server=go` from the
repo root.
