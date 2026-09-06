# Authentication storage safety

Slate's planned account sign-in and Devices pane depend on this SDK. The Go
implementation currently reads an OTP before separately updating it, allowing
concurrent redemption and attempts beyond the five-guess limit. Its sign-out
helper discards storage errors, so HTTP can claim revocation while a session
remains usable. The TypeScript peer must preserve the same protocol semantics.

## Boundary

Make OTP validation, expiry, attempt accounting and consumption one database
transaction. Use a database write lock before reading, with an explicit bounded
busy timeout on every Go SQLite connection. Sample the verification clock after
acquiring the lock. Return storage failures, including failed commits, rather
than treating them as invalid credentials. Propagate session deletion failures
through sign-out; clear cookies only after successful revocation. A present
malformed Authorization header must not fall through to a cookie.

Keep the existing HTTP success/error contract, including five wrong-code 401s
followed by 429. Keep existing sessions and schema intact. Go custom storage
implementations must supply the atomic verification operation; no unsafe
read/update fallback. SignOut now returns an error that callers must check.

## Remaining Slate gates

This fixes storage mechanisms, not the complete email-login security boundary.
Account eligibility must still be checked with session issuance; known-user-only
delivery, generic start responses, address/IP/global budgets, resend invalidation,
owner/member authorization, OAuth subjects, account-safe client caches and the
Devices pane remain follow-on work. Do not enable email delivery on the strength
of this change alone. No production configuration or existing user data changes.

## Verification

Reproduce simultaneous redemption, attempt overshoot, exact expiry, database
lookup error masking and false HTTP sign-out success before fixing them. Verify
across two independent SQLite handles, writer contention beyond the timeout,
rollback on mutation failure, and rejection of a successfully revoked session.
Run Go race tests and the existing protocol parity suite against both peers.
