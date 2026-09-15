# Passkey registration owner binding

The real Go HTTP registration finish previously accepted a valid synthetic
WebAuthn `none` attestation when the authenticated caller was a different
account from the ceremony owner. Cookie and bearer variants each returned 200.
The retained red run follows fixture corrections (RP display name, storage
method and error-body key); those initial setup failures are not bug evidence.
The TS core independently reproduced acceptance with its WebAuthn verifier
stubbed. Both valid red runs are retained alongside scoped Go race output.

Go completion now atomically takes the pending ceremony only when its stored
owner equals the authenticated caller. TypeScript core requires the caller's
userId and checks it before taking or verifying the ceremony; omitted/empty
identity fails closed. Hono supplies the verified session identity and ignores
body userId. Direct TS core callers must adopt the new required input. Existing
HTTP payloads remain compatible; no npm release is implied.

Go mounted-route tests use actual verification of generated P256/COSE public
keys in synthetic `none` attestations. For both cookie and bearer mode, ten
cross-account attempts refuse with 401 invalid_credential, no cookies and no
passkeys. The rightful caller then registers exactly its key and replay refuses.
This is a software ceremony, not browser/hardware acceptance. TS core tests
stub cryptographic verification and prove thirty other/empty/absent caller
refusals without verifier calls, then owner success and replay refusal. Hono
adapter tests use real session authentication but stub core completion, proving
session identity forwarding, body-spoof rejection and unauthenticated refusal.

Validation: Go httpapi/passkey race suites pass; TS core 79 tests and Hono 45
tests pass; core build and all four package typechecks pass. CI supplies wider
Go/TS regression checks.

Limits: account identity binding is not host eligibility or revocation
serialization. Revocation between session verification and persistence, or a
ceremony resumed by a new session of the same re-enabled account, still needs a
host transaction boundary. This does not close Slate A03 or certify production
multi-user authentication. Pending challenge maps remain process-local.
