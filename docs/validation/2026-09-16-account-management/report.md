# Optional Go account-management transaction hook

Forty-six mounted operation/mode/transport cases cover me, sessions, passkeys and
owned passkey deletion across default, success, refusal, unexpected storage error,
missing session, foreign snapshot rows and unknown deletion. Success checks
populated metadata and durable deletion; configured cases prohibit default
reads/deletes. Refusals exclude metadata, cookie and raw error text. Initial
SDK session lookup/touch remains outside the callback.

The actual red run introduced the config/type/tests but left handlers unwired:
thirty configured cases failed with zero host calls, wrong successful status
and deletion on a path the host refused. Nil/missing-session controls passed.
The final scoped race passed: httpapi 2.409s, storage 1.354s using
`go test -race ./servers/go/httpapi ./servers/go/storage -run
'^(TestAccountManagementHTTP|TestManagementTransaction|TestRegistration)' -count=1`.

Storage transaction tests use real SQLite and assert complete populated
session/passkey fields, foreign/missing deletion refusal, transaction-local
visibility, rollback preservation, committed owned deletion, foreign key
preservation and nil/closed transaction errors. Helpers do not own admission
or commit. The host must serialize its own account/session check and operation.

This is a Go-only optional integration. Default Go/TS wire parity belongs to CI;
no new TypeScript host hook, Slate adoption, hosted or device proof is claimed.
The callback covers only the four named management operations, not ceremonies
or sign-out. Snapshot delivery can occur after later revocation. Independent
review and exact-head CI precede manual merge.
