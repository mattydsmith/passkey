# Passkey SDK — Go server

Peer implementation of the Passkey SDK to `@mattsmith/passkey-sdk-hono`. Exposes
HTTP routes that conform to `spec/protocol.md`. Mount on any `chi` router.

## Quickstart

```go
import (
    "github.com/go-chi/chi/v5"
    "github.com/mattydsmith/passkey/servers/go/httpapi"
    "github.com/mattydsmith/passkey/servers/go/storage"
)

r := chi.NewRouter()
db, _ := storage.OpenSQLite("app.db")
httpapi.Mount(r, httpapi.Config{
    RPID:    "example.com",
    RPName:  "Example",
    Origins: []string{"https://example.com"},
    Storage: db,
})
```

See `examples/go-app/` for a runnable consumer.

## Tests

```
make test
```

Cross-impl conformance is verified via `pnpm test:parity --server=go` from the
repo root.
