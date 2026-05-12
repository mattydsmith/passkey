# go-app example

Thin binary that mounts the `servers/go` library and listens on `$PORT`. After
Phase 2, the parity runner auto-boots this when invoked with
`pnpm test:parity --server=go`.

## Run locally

```
PORT=3001 AUTH_ORIGINS=http://localhost:3001 go run .
```

Hit `http://localhost:3001/healthz` — expect `{"ok":true}`.
