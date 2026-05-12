# Parity Test Suite

Language-agnostic conformance tests for [`spec/protocol.md`](../../spec/protocol.md).

Vectors are JSON files describing scenarios — sequenced HTTP requests with
captured variables, expected response shape, and expected error codes. The
Node-based runner executes them against any HTTP server that implements the
spec. The TypeScript server in `examples/hono-app` is the reference target;
any future second implementation is test-driven against the same vectors.

## Layout

```
tests/parity/
├── README.md                # this file
├── runner/                  # Node CLI (not part of the pnpm workspace)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/                 # runner source
│   ├── tests/               # runner self-tests (vitest)
│   └── scripts/             # dev helpers (verify-vector.ts)
└── vectors/                 # JSON scenario files
    ├── email/
    ├── passkey/
    ├── session/
    ├── passkey-mgmt/
    ├── csrf/
    └── validation/
```

## Prerequisites

The runner lives outside the pnpm workspace so its dependencies don't hoist
into the main install graph. Install once:

```bash
cd tests/parity/runner
pnpm install --ignore-workspace
pnpm exec playwright install chromium  # only if not already cached for v1.59.1
```

## Running the runner's own tests

```bash
pnpm test:parity        # from repo root, or:
cd tests/parity/runner && pnpm test
```

That runs the runner's vitest self-tests (matchers, transport, harness,
executor). It does not require hono-app to be running.

## Verifying a vector against a live server

Boot `examples/hono-app` with the test routes enabled, then point the
verifier at it:

```bash
# in one terminal
cd examples/hono-app && NODE_ENV=test PORT=3001 pnpm start

# in another terminal
cd tests/parity/runner
pnpm exec tsx scripts/verify-vector.ts --url=http://localhost:3001 \
  ../vectors/email/start-happy.json \
  ../vectors/email/verify-happy.json
```

The default `--url` is `http://localhost:3001`. Each vector reports
`PASS` or `FAIL <reason>`; non-zero exit on any failure.

> Task 11 will replace this manual workflow with a single `pnpm test:parity`
> that boots hono-app, discovers all vectors, and reports a summary.

## Vector file format

Each vector is a JSON file with this shape:

```json
{
  "name": "email/verify-happy",
  "mode": "bearer",
  "steps": [
    {
      "request": {
        "method": "POST",
        "path": "/auth/email/start",
        "body": { "email": "test@example.com" }
      },
      "expect": {
        "status": 200,
        "body": {
          "otpId": { "type": "string", "nonEmpty": true },
          "expiresInSeconds": { "type": "number", "min": 1 }
        }
      },
      "capture": { "otpId": "$.body.otpId" }
    }
  ]
}
```

### Top-level fields

- `name` — human-readable scenario name. Convention: mirror the path
  (`email/verify-happy`).
- `mode` — `"bearer"` or `"cookie"`. Drives how the runner manages sessions
  and CSRF; see [`spec/protocol.md`](../../spec/protocol.md).
- `steps` — non-empty array of step objects.

### Step fields

- `request.method` — `GET` / `POST` / `PUT` / `PATCH` / `DELETE` / `HEAD`.
- `request.path` — server-relative path; `{{vars}}` are interpolated from
  captures.
- `request.body` — optional JSON body. Strings with `{{var}}` are
  substituted. If a value is exactly `{{var}}` the captured value's type
  is preserved.
- `request.headers` — optional extra request headers.
- `request.omitCsrf` — cookie mode only. Set `true` to deliberately drop
  the `X-CSRF-Token` echo, for negative-path CSRF vectors.
- `expect.status` — exact HTTP status to assert.
- `expect.body` — optional matcher tree (see below).
- `expect.headers` — optional matcher tree against response headers.
- `capture` — map of variable-name → JSONPath-lite expression (`$.body.foo`)
  evaluated against the response and stored for use in later steps.

### Matchers

Leaf matchers identify themselves by a reserved key:

| Matcher | Example | Meaning |
|---|---|---|
| `type` | `{ "type": "string", "nonEmpty": true }` | type check, optional non-empty |
| `type: number` | `{ "type": "number", "min": 1, "max": 60 }` | number with bounds |
| `type: boolean` | `{ "type": "boolean" }` | boolean |
| `const` | `{ "const": "test@example.com" }` | deep-equal to literal value |
| `regex` | `{ "regex": "^u_" }` | regex match on string |
| `array` | `{ "array": { "minLength": 1, "items": {...} } }` | array shape |
| `$any` | `{ "$any": true }` | accept any value (use sparingly) |
| `error` | `{ "error": "invalid_otp" }` | matches `{ error, message }` envelope with given code |

Objects whose keys are not one of those reserved keys are treated as nested
matchers: each key recurses into the corresponding response field. Extra
fields on the response are allowed.

### Capture and interpolation

- `capture: { otpId: "$.body.otpId" }` reads `response.body.otpId` and
  stores it in `ctx.otpId`.
- Later steps reference it as `"{{otpId}}"`. A string that contains
  only `{{name}}` returns the captured value's exact type; a string with
  surrounding text coerces to string.
- Dotted paths work: `{{user.email}}` walks the context.

### WebAuthn ceremony placeholder (for passkey vectors)

When a body needs an attestation or assertion, use a `$webauthn` marker:

```json
{
  "credential": { "$webauthn": "create", "options": "{{options}}" }
}
```

The runner sees `$webauthn` and routes the captured options through the
Playwright virtual authenticator, then substitutes the resulting
public-key-credential JSON into the request body. `"create"` invokes
`navigator.credentials.create()`; `"get"` invokes `.get()`.

## Naming convention

`{endpoint-group}/{behavior}.json`. Endpoint groups mirror the spec's
sections (`email`, `passkey`, `session`, `passkey-mgmt`, `csrf`,
`validation`). Behaviors:

- `happy` — success path.
- `<error-code>` — named after the protocol error code (`invalid-otp`,
  `csrf-required`, etc.). Use hyphens, not underscores, to match URL
  conventions in the filesystem.
- Descriptive suffix when neither fits (e.g. `signin-unknown-credential`).

A vector author should be able to add a new scenario in under 10 minutes
by copying the closest existing vector and editing the request/expect
fields.
