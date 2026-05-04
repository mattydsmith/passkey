# Passkey SDK — HTTP Protocol

All endpoints accept JSON. All successful responses are JSON. All errors are
JSON of the shape `{ "error": "<code>", "message": "<human string>" }`.

The server's RP ID is configured at startup. Origins listed in config are the
only ones accepted for WebAuthn ceremonies.

Authenticated requests carry the session token either as:
- `Authorization: Bearer <token>` header, or
- `Cookie: session=<token>` (if a cookie name is configured).

The client picks one mode at construction time.

## Endpoints

### POST /auth/email/start

Begin email OTP. Generates and emails a 6-digit code.

Request: `{ "email": string }`
Response 200: `{ "otpId": string, "expiresInSeconds": number }`
Errors: `rate_limited` (reserved).

### POST /auth/email/verify

Verify the OTP. Creates the user if needed (via project hook). Issues a session.

Request: `{ "otpId": string, "code": string }`
Response 200: `{ "sessionToken": string, "user": { "id": string, "email": string } }`
Errors: `invalid_otp` (401), `otp_attempts_exceeded` (429), `otp_expired` (410).

If a `session` cookie is configured, the response sets it; clients in cookie
mode rely on the browser to persist it.

### POST /auth/passkey/register/start  (authenticated)

Begin passkey registration for the current user.

Response 200: `{ "registrationId": string, "options": <WebAuthn creation options> }`

The `options` object is what `navigator.credentials.create()` (web) or
`ASAuthorizationPlatformPublicKeyCredentialProvider` (iOS) consumes verbatim.

### POST /auth/passkey/register/finish  (authenticated)

Finish passkey registration.

Request: `{ "registrationId": string, "credential": <attestation>, "deviceName"?: string }`
Response 200: `{ "passkeyId": string }`
Errors: `invalid_credential` (401), `unauthenticated` (401).

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
| `rate_limited` | 429 | Reserved (not enforced by SDK in v1) |
