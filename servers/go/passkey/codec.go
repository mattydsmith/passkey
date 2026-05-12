package passkey

import "encoding/base64"

// CredIDToString encodes a credential ID as base64url (no padding).
func CredIDToString(id []byte) string { return base64.RawURLEncoding.EncodeToString(id) }

// CredIDFromString decodes a base64url credential ID, tolerating padded input.
func CredIDFromString(s string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}
