# Passkey SDK — HTTP Protocol

All endpoints accept JSON. All successful responses are JSON. All errors are
JSON of the shape `{ "error": "<code>", "message": "<human string>" }`.

The server's RP ID is configured at startup. Origins listed in config are the
only ones accepted for WebAuthn ceremonies.

Authenticated requests carry the session token either as:
- `Authorization: Bearer <token>` header, or
- `Cookie: session=<token>` (if a cookie name is configured).

The client picks one mode at construction time. A present Authorization header
takes precedence over a cookie; malformed or invalid headers never fall back
to the cookie.

## CSRF (cookie mode only)

When the client uses the cookie session mode, the server enforces a
double-submit cookie pattern on all non-GET requests under the auth
prefix. On every session-issuing response (`/auth/email/verify`,
`/auth/passkey/sign-in/finish`), the server sets a `csrf` cookie
alongside `session`. The cookie is **not** `HttpOnly` — the client
reads it and echoes the value as `X-CSRF-Token` on subsequent
non-GET requests. The server returns `csrf_required` (403) on any
non-GET request that has a session cookie but a missing or
mismatching X-CSRF-Token header.

Bearer-mode clients (no session cookie, `Authorization: Bearer …`)
do not need to send X-CSRF-Token; the middleware skips the check
when no session cookie is present. Pre-session traffic
(`/auth/email/start`, `/auth/email/verify`,
`/auth/passkey/sign-in/start`, `/auth/passkey/sign-in/finish`) is
also exempt for the same reason.

The `csrf` cookie is cleared by `/auth/sign-out` alongside `session`.
The cookie name and the enforcement default are configurable on the
server adapter.

## Endpoints

### POST /auth/email/start

Begin email OTP. Generates and emails a 6-digit code.

Request: `{ "email": string }`
Response 200: `{ "otpId": string, "expiresInSeconds": number }`
Errors: `rate_limited` (reserved).

Hosts that need eligibility, delivery reservation and shared abuse budgets before
sending can configure Go `Config.EmailStart` or TypeScript `email.start`. The
hook replaces the whole default start flow after HTTP email validation, and
receives the normalized address, the original address before trim/case folding
(`OriginalEmail` in Go, `originalEmail` in TypeScript), configured OTP lifetime
and a clock function. Character policies must inspect the original: Unicode
case folding can turn non-ASCII input (for example Kelvin sign) into ASCII.
The default sender/storage is never a fallback. Return a nonempty opaque OTP ID
only after a durable policy decision; the SDK retains the existing response
shape and configured `expiresInSeconds`. Empty results and hook errors fail
closed. For enumeration-sensitive refusals, the host must arrange identical
public shapes/timing (for example a fresh opaque ID without an activated OTP).
This hook does not itself supply eligibility, limits, delivery or transactions.

The metadata-only request has already had its body decoded. Go supplies the
HTTP request including transport `RemoteAddr`; TypeScript HTTP supplies Fetch
`Request`, which has no trusted transport peer IP. Direct TypeScript core calls
may omit the request. Hosts must obtain trusted client identity from their
runtime and explicit proxy policy; forwarded headers are never trusted by this
hook. A host needing peer identity must not invent one when absent. Both HTTP
adapters trim the address before validating; the TypeScript adapter now matches
Go's preexisting whitespace normalization.

Go `storage.InvalidateSQLiteOTPsInTx` / `storage.CreateSQLiteOTPInTx` and TypeScript
`invalidateOtpsInTransaction` / `createOtpInTransaction` compose older-code
invalidation and new-code insertion with host writes in an existing SQLite
transaction. They do not begin, commit or roll back it. Use a writer transaction
before reading policy/eligibility or sampling time. Invalidation takes an
already-normalized address and explicit time; insertion creates an unconsumed
hashed code. Reserve budgets before external mail, and arrange activation only
after acknowledged delivery if failed mail must never leave a usable code.
The default start flow remains unchanged and does not acquire these host rules.

### POST /auth/email/verify

Verify the OTP. Creates the user if needed (via project hook). Issues a session.

Request: `{ "otpId": string, "code": string }`
Response 200: `{ "sessionToken": string, "user": { "id": string, "email": string } }`
Errors: `invalid_otp` (401), `otp_attempts_exceeded` (429), `otp_expired` (410),
`internal_error` (500) when the database operation fails.

Verification checks expiry, the attempt limit and the code, then consumes the
code or records a wrong guess in one write transaction. Expiry is checked after
acquiring the write lock; equality with the expiry instant is expired. A code
can be redeemed once, including across concurrent connections. Five wrong
guesses return 401; subsequent attempts return 429. A failed write/commit must
never be reported as successful verification or silently treated as a wrong code.

The default flow commits OTP verification before resolving the host user and
inserting the session. Hosts that need those operations to succeed or roll back
together can configure Go `Config.EmailSignIn` or TypeScript `email.signIn`.
This replaces the entire verify/resolve/issue sequence after HTTP input validation;
errors never fall back to the default flow. The hook must enforce credential
expiry, attempts and replay protection, check account eligibility, and commit
session insertion before returning the existing success envelope. It receives
the effective session lifetime, maximum attempts, request metadata and a clock
function (Go time.Time; TypeScript Unix seconds). Sample the clock after waiting
for a database write lock. The hook itself does not provide a transaction.

The verification hook also receives metadata-only `Request`/`request` after
body decoding. Go preserves the transport peer in `RemoteAddr`; Fetch has no
trusted socket peer, so TypeScript hosts must use their runtime integration.
Direct TypeScript core calls may omit the request; it is never fabricated.
The legacy `IP`/`ip` field remains compatible and may come from an untrusted
forwarding header. Establish explicit proxy trust using transport identity
before treating it as a verified client address. No proxy is implicitly trusted.

Go hosts sharing the SDK's SQLite database can compose
`storage.VerifySQLiteOTPInTx` and `storage.CreateSQLiteSessionInTx` with their
own eligibility checks in one `*sql.Tx`. Start verification before any reads in
a deferred transaction so it can acquire the write lock first. A returned
`OTPVerification.Rejection` must be committed before it is reported (wrong
attempts are counted); a database error or later session/eligibility failure
must roll back. Neither helper commits. TypeScript hosts own their corresponding
transaction; these Go storage helpers do not change the HTTP contract.

If a `session` cookie is configured, the response sets it; clients in cookie
mode rely on the browser to persist it.

### POST /auth/passkey/register/start  (authenticated)

Begin passkey registration for the current user.

Response 200: `{ "registrationId": string, "options": <WebAuthn creation options> }`

The `options` object is what `navigator.credentials.create()` (web) or
`ASAuthorizationPlatformPublicKeyCredentialProvider` (iOS) consumes verbatim.

### POST /auth/passkey/register/finish  (authenticated)

Finish passkey registration. The authenticated account must match the account
that began this ceremony. A different account receives `401 invalid_credential`
and cannot consume the pending registration; the rightful account may still
finish it. The caller identity comes from the session, never the request body.

Request: `{ "registrationId": string, "credential": <attestation>, "deviceName"?: string }`
Response 200: `{ "passkeyId": string }`
Errors: `invalid_credential` (401), `unauthenticated` (401).

`passkeyId` is the credential ID encoded as base64url — the same value returned as `id` from `GET /auth/passkeys` and accepted as the path parameter on `DELETE /auth/passkeys/:id`. Clients can pass `passkeyId` straight to `DELETE` without transformation.

### POST /auth/passkey/sign-in/start

Begin passkey sign-in. No authentication required (this is how you sign in).

Response 200: `{ "signInId": string, "options": <WebAuthn assertion options> }`

`options.allowCredentials` is empty — clients use discoverable credentials.

### POST /auth/passkey/sign-in/finish

Finish passkey sign-in.

Request: `{ "signInId": string, "credential": <assertion> }`
Response 200: `{ "sessionToken": string, "user": { "id": string, "email": string } }`
Errors: `invalid_credential` (401), `unknown_credential` (404).

The `email` field on the returned user may be empty when sign-in is via
passkey (the SDK doesn't store user email in passkey records). Clients that
need the email should query their own users endpoint.

### GET /auth/me

Returns the current user.

Response 200: `{ "user": { "id": string, "email": string } }`
Errors: `unauthenticated` (401).

### POST /auth/sign-out

Revokes the current session.

Response 200: `{ "ok": true }`. Sets an expired cookie if cookie mode is in use.
Database deletion failures return `internal_error` (500) and do not clear
cookies, allowing the client to retry. Success means the session was deleted
or was already absent. It must no longer authenticate after success.

### GET /auth/sessions  (authenticated)

Lists active sessions for the current user.

Response 200: `{ "sessions": [ { "createdAt", "expiresAt", "lastSeenAt", "userAgent", "ip" } ] }`

### GET /auth/passkeys  (authenticated)

Lists registered passkeys for the current user.

Response 200: `{ "passkeys": [ { "id": string, "deviceName", "createdAt", "lastUsedAt", "transports" } ] }`

`id` is the credential ID encoded as base64url.

### DELETE /auth/passkeys/:id  (authenticated)

Removes a passkey owned by the current user.

Response 200: `{ "ok": true }`
Errors: `unknown_credential` (404) if the passkey doesn't belong to the caller.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `invalid_otp` | 401 | Wrong code, or row not found |
| `otp_attempts_exceeded` | 429 | 5 wrong guesses on this row |
| `otp_expired` | 410 | Past the 10-minute window |
| `invalid_credential` | 401 | Passkey signature didn't verify |
| `unknown_credential` | 404 | Credential ID not found / not yours |
| `unauthenticated` | 401 | No session, or session expired |
| `session_unavailable` | 503 | Session lookup or last-seen write failed; retain credentials and retry |
| `csrf_required` | 403 | CSRF token missing or invalid (cookie mode) |
| `rate_limited` | 429 | Reserved (not enforced by SDK in v1) |
| `invalid_request` | 400 | Request body failed validation |
| `internal_error` | 500 | Unexpected server error |

### Session storage failures

Every session-protected endpoint distinguishes an invalid/expired session (401)
from a failure reading the session or recording its last-seen time (503,
`session_unavailable`, `Retry-After: 1`). It neither clears cookies nor continues
the protected operation on that error. Go returns `auth.ErrSessionUnavailable`
with the operation and original cause wrapped; TypeScript returns
`SessionUnavailableError` with a local diagnostic cause. Response bodies do not
include database details. A row removed between lookup and touch is a missing
session (401), not successful authentication.

This chooses explicit error propagation for host gates. It does not shorten
SQLite's existing busy timeout or make touches asynchronous: a contended request
can still wait five seconds, but the failure is reported and logged rather than
silently accepted. Clients should retain the token and may retry after the
advertised delay; the SDK does not promise that every storage fault will recover
on the next request. Host gates must preserve the 503 distinction instead of
turning every session error into a sign-in redirect or 401.

### Optional host passkey issuer

Go `httpapi.Config.PasskeySignIn` and TypeScript `AuthConfig.passkey.signIn`
optionally own persistence after a passkey assertion has been cryptographically
verified. The hook receives the verified user ID, credential ID, public key and
new counter, plus effective session lifetime, clock and request metadata. The
host must recheck current account eligibility and the stored credential, then
commit the counter and session together before returning. The SDK does not
update the counter or create a default session in this mode. A rejected or
failed hook never falls back, and never sets cookies. An empty session token or
a returned user different from the verified identity is an internal error.

Go `passkey.ErrSignInDenied` maps to401 `invalid_credential`;
`auth.ErrSessionUnavailable` maps to503 `session_unavailable` with Retry-After1.
TypeScript hosts use the corresponding `AuthError` codes. Other errors yield a
sanitized500. A challenge is consumed before host issuance; after a failed
issuance the client must start a new assertion ceremony. No raw assertion is
passed as an unverified substitute for the verified proof.

The Go request retains socket metadata; Fetch has no inherent trusted peer IP.
Bodies are already consumed and forwarding headers/IP fields remain untrusted
until the host establishes proxy trust. Direct TypeScript calls may omit the
request. With no hook, existing default counter/session behavior is retained;
the low-level TypeScript `finishPasskeySignIn` also retains its existing shape.
