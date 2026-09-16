# Optional Go registration-start snapshot

Base `c15d13dd` (main after registration commit). Slate A03 prerequisite for mattydsmith/slate#2722. This adds a Go host callback; it does not implement host eligibility, modify TypeScript or claim full account lifecycle acceptance.

Actual mounted tests first introduced the callback type/config field without wiring it. The retained [red run](baseline-red.log) shows host callbacks not invoked and unguarded default reads for configured success/refusal cases. This is an executed behavior failure, not a missing-symbol compile failure. With wiring, 14 cookie/bearer cases cover default behavior, host success, ineligible/unavailable/arbitrary failures, foreign rows and absent sessions. Configured callbacks receive the verified identity/hash/request/clock, execute exactly once, and never fall back to a storage read. Refusals expose no challenge, cookies or private error text; only 503 carries retry guidance.

The transaction reader reuses the SDK's native field decoder. A real host transaction reads its own uncommitted owned row and excludes a foreign row, retaining all passkey fields, rejects nil and ended transactions, and does not commit the caller's work. Existing registration ownership/commit and session regression tests are included in the scoped run.

`go test -race ./servers/go/httpapi ./servers/go/passkey ./servers/go/storage -run '^(TestRegistration|TestPasskeyReadHostTransaction|TestPasskeyInsertHostTransaction|TestPasskey|TestSession)' -count=1` passed: httpapi7.043s, storage1.334s. The passkey package compiled but selected no direct tests; its handlers are exercised via httpapi. [Result](scoped-race.log).

The preliminary SDK session lookup/touch remains outside the host callback. Successful snapshot admission may order before Disable yet deliver a pending ceremony afterward; final host registration persistence checks remain mandatory. No credential is stored by this callback. No hosted/device proof, Slate integration, normal startup activation or TypeScript host snapshot equivalent is claimed here. Broad Go/TypeScript checks and independent review belong to the PR.
