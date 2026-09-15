# Host-owned passkey registration commit

The new optional host extension replaces only credential persistence, after
WebAuthn verification. Its input carries the verified credential, original
verified session hash, clock function and request metadata. The host must
serialize its account/session check and persistence with revocation. No
fallback occurs on host failure. The same-account, different-session case is
rejected before consuming the pending challenge or calling the verifier/host.
Default registrations retain the account binding from the previous change.

Go's RequireSessionWithHash factors the existing session verification/touch
without changing RequireSession's public shape or error handling. Pending
registration records copy the initial hash; the host path atomically matches
and consumes that session. TypeScript createAuth independently resolves and
verifies the request session before supplying its hash, preventing direct
callers from spoofing it through arguments. Hono forwards request metadata.

Actual mounted Go routes verify generated P256/COSE public keys in synthetic
none attestations, in both cookie and bearer modes, across default, host
success, denied, unavailable, failure, new-session and invalid-attestation
cases. Tests assert host input, one successful save, no fallback, bounded error
shapes, no cookies/private errors, retry guidance and replay refusal. TS core
uses a stubbed cryptographic verifier; six corresponding host cases check
input and error shapes, persistence/fallback, missing request and replay. Its
initial success assertion exposed a Buffer-versus-Uint8Array comparison in the
test, which was corrected; failed host cases assert their intended error code
so assertion errors cannot falsely satisfy expected rejection. This extension
has no pre-fix red-runtime claim: the underlying Slate revocation race needs a
separate host integration proof.

Scoped Go race: auth 1.972s, passkey 1.311s, httpapi 11.962s. Storage transaction
helper race 1.283s verifies nil-transaction refusal, rollback and committed
metadata. TS core's existing 79 tests passed and its six new cases passed after
the test correction; Hono45 tests passed, including the updated two-case request
forwarding check. Core build and four package typechecks passed.

Limits: no host account policy, registration-start data-access policy, actual
Disable integration, browser/hardware acceptance or deployment is certified.
A rejected host commit spends the ceremony; 503 asks the caller to retry but a
new registration start is necessary. Challenge maps remain process-local.
