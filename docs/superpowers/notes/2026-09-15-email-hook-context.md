# Lossless host email-hook context

The isolated Slate auth proof found that normalized email alone cannot enforce
an original-character policy: Unicode Kelvin sign becomes ASCII k, and Go also
folds capital I-with-dot to ASCII i. Preserve `OriginalEmail`/`originalEmail`
through the SDK start hook alongside the existing normalized address. Hono
validates the trimmed address without discarding the original string.

The verify hook now also receives the HTTP request after body decoding, matching
the start hook. Hosts can derive trusted client metadata from Go's transport
peer; Fetch callers must obtain transport identity from their runtime. Direct
TypeScript core calls may omit request and never receive a fabricated one.
Legacy IP fields remain untrusted and backward compatible. This does not add
an SDK proxy allowlist or adopt Slate's ASCII-only policy globally.

Actual Go red run before forwarding the new fields: mounted issuer tests saw
nil Request, and Kelvin/I-dot original-input tests reported lost original
addresses. Restored forwarding passed `go test -race ./servers/go/httpapi
-count=1` (11.635s). Node22 workspace build, tests and typecheck passed; tests
cover mounted Hono input, direct core calls with/without Request, preservation
of originals, no default sender/resolver/session fallback and existing errors.

No package publication or host deployment. The consuming host must enforce its
own policy against the original and use an explicit transport/proxy boundary.
