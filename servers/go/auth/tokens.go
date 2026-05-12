package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// RandomToken returns a base64url-encoded random token of `n` bytes (raw).
// Used for session tokens and OTP IDs.
func RandomToken(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashToken returns sha256(token) as raw bytes. Used to store session token
// hashes (we never store the plaintext).
func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}
