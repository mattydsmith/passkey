# Host passkey issuer prerequisite

Bounded prerequisite for Slate A03 account disabling. Optional Go/TypeScript
issuers execute after signature verification and before counter/session writes.
The host owns atomic credential/eligibility/counter/session persistence. No
Slate adoption, session-policy change for default consumers, npm publication or
full A03 acceptance is claimed.

Real red: with the new configuration type available but not yet wired, the
mounted Go sign-in route accepted a real ECDSA-signed WebAuthn assertion and
returned200 without invoking the denying host (`calls=0`). Success, denial,
failure, empty-result and wrong-user cases all exposed the bypass. After wiring,
those cases pass, alongside invalid signature, storage-unavailable, legacy
fallback and spent-challenge replay. Host cases leave SDK counter/session rows
unchanged and failures emit no cookies. The Go test seeds a synthetic public key
rather than claiming browser registration/device verification.

TypeScript core tests explicitly stub the WebAuthn verifier and cover issuer
metadata, direct calls, denial/error/invalid result, no default writes and
challenge replay. Hono tests stub core finish to check request forwarding,
cookie suppression and401/503/500 mapping. They do not claim independent
cryptographic verification.

Validation: scoped Go race httpapi11.640s/passkey1.281s; final focused Go guard
passed after switching the test to the existing WebAuthn CBOR wrapper. Node22:
workspace build, tests (core78/client59/Hono43), and all package typechecks passed.
No hosted or device run. Independent review and CI are merge gates.
