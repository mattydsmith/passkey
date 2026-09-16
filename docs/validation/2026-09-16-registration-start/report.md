# Optional Go registration-start admission

The host can admit a verified initiating session before registration creates a
pending ceremony. Configured mode reads no existing passkey data; WebAuthn
registration start needs identity only. Default mode retains its previous read.

The retained red run introduced the new type/config/tests but left the handler
on its previous path: eight configured success/refusal bearer/cookie cases
failed on zero host calls and an unwanted storage read (refusals also returned
200). Twelve mounted start cases now cover default, admitted, ineligible,
unavailable, unexpected failure and missing session across bearer/cookie.
Success asserts the encoded owner identity, display/name and challenge. Refusal
asserts no ceremony, cookie, fallback read or private error text.

Existing mounted registration commit tests now use the new admission callback
in configured cases and complete actual synthetic WebAuthn attestation through
the real verifier; default, denied, unavailable, failure, swapped session,
invalid attestation and consumed pending controls remain included.

Scoped race: `go test -race ./servers/go/httpapi ./servers/go/passkey -run
'^(TestRegistration|TestPasskey|TestSession)' -count=1`: httpapi 6.978s;
passkey has no matching tests. Broad Go/TypeScript checks belong to CI.

The initial SDK session lookup/touch remains outside host admission. Admission
may order before revocation yet deliver a pending ceremony afterward; final host
registration commit checks remain mandatory and independently configured.
No browser/device, hosted, Slate integration or normal startup activation is
proved here. No TypeScript host admission equivalent is claimed.
