# Authentication storage safety review

## Outcome

The prerequisite SDK changes are implemented locally on
`fix/atomic-otp-session-revocation`, based on `origin/main` at `9bb2ce2`.
No existing schema, session or production setting was changed. Slate has not
adopted this SDK branch yet. Email sign-in and the Devices pane remain follow-on
work, subject to the account-eligibility and delivery gates in the design.

## Reproduced before the fix

- Twenty simultaneous correct-code requests across two independent SQLite
  handles produced 11 successful redemptions and nine lock errors, instead of
  exactly one success and nineteen invalid-code responses.
- Twenty simultaneous wrong codes returned twenty invalid responses and left
  eight recorded attempts, exceeding the five-attempt cap and masking errors.
- A code at its exact expiry instant was accepted.
- A closed database was reported as an invalid code.
- Injected session deletion failure returned HTTP 200 and cleared cookies while
  the session remained usable.
- The TypeScript expiry/consumption transaction assertion failed. This is a
  structural guard, not a reproduced multi-process exploit in TypeScript.

## Verification after the fix

- Go `go test -race ./... -count=1`: all four packages passed. Includes two-handle
  redemption and attempt tests, database writer contention beyond five seconds,
  failed HTTP sign-out and successful retry followed by rejected authentication.
- Expiry is sampled after the write lock is acquired; a code expiring while
  waiting remains unconsumed. Both pooled connections report 5000 ms busy timeout.
- Injected update failure rolls back both a consumption and a wrong guess.
- Additional deferred-constraint commit-failure regression passed under race:
  no consumed state remains visible and retry succeeds after removing the fault.
- TypeScript tests: core 61, web client 59, Hono 27 passed. Core rerun passed after
  tightening the result union. Builds and package type checks passed.
- Shared runner self-tests: 85 passed. All 21 HTTP vectors passed against each of
  Go and TypeScript, including reused OTP rejection, replay of a revoked bearer,
  and malformed/invalid Authorization headers with a valid session cookie.
- `git diff --check`: passed.

Node 26 could not build the pinned better-sqlite3 11.10.0 dependency. Tests used
Codex's bundled Node 24.19.0 with the existing frozen lockfiles; system Node and
project dependencies were not changed. Initial new vectors used the wrong error
matcher shape; corrected vectors passed both servers. The documented extra `--`
separator is not accepted by the parity runner; the successful commands were
`pnpm test:e2e --server=go` and `pnpm test:e2e --server=ts` from its directory.

## Inline adversarial review

The write lock belongs to the database, not a process mutex. Wrong guesses
commit before returning an auth error; storage/update/commit failures are
propagated. Failed sign-out does not clear credentials; successful sign-out is
verified by replaying the same token. Both language peers reject malformed-header
cookie fallback. Existing session data and schema remain compatible.

The public Go Storage interface now requires VerifyOTP, intentionally preventing
unsafe fallback for custom implementations. SignOut returns an error; existing
call statements can compile while ignoring it, so direct consumers need review.
HTTP uses a clock callback sampled inside the transaction; the older fixed-time
helper remains available for compatibility.

Account eligibility and session creation are still separate operations after OTP
consumption. This PR must not be represented as completing Slate's email-login
security gate. Rate limits, resend invalidation, known-user-only delivery and
account isolation remain required before rollout. No Apple code changed and no
simulator verification is claimed for this library-only change.
