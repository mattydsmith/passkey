-- WebAuthn requires the BackupEligible (BE) flag captured at registration
-- to match the BE flag asserted on every subsequent login (go-webauthn
-- enforces this in webauthn/login.go:371 — a mismatch returns
-- "Backup Eligible flag inconsistency detected during login validation"
-- and the login fails). The same is true for BackupState (BS).
--
-- Existing rows pre-date this fix and have no captured flags. They are
-- defaulted to FALSE so the schema stays NOT NULL, but synced authenticators
-- (iCloud Keychain, Google Password Manager) assert BE=1 and will fail to
-- log in until the credential is re-registered.

ALTER TABLE auth_passkeys ADD COLUMN backup_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_passkeys ADD COLUMN backup_state    INTEGER NOT NULL DEFAULT 0;
