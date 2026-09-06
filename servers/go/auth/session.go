package auth

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

// ErrUnauthenticated is returned when no valid session can be resolved.
var ErrUnauthenticated = errors.New("unauthenticated")

// CreateSession issues a fresh session for the given userID. Returns the
// plaintext session token (caller is responsible for delivering it via header
// or cookie).
func CreateSession(s storage.Storage, userID string, ttl time.Duration, now time.Time, userAgent, ip *string) (token string, err error) {
	token, err = RandomToken(32)
	if err != nil {
		return "", err
	}
	if err := s.CreateSession(storage.Session{
		TokenHash:  HashToken(token),
		UserID:     userID,
		CreatedAt:  now,
		ExpiresAt:  now.Add(ttl),
		LastSeenAt: now,
		UserAgent:  userAgent,
		IP:         ip,
	}); err != nil {
		return "", err
	}
	return token, nil
}

// RequireSession resolves the session token from the request (Authorization
// header or session cookie) and returns the userID. Returns ErrUnauthenticated
// if the token is missing, invalid, or expired.
func RequireSession(s storage.Storage, r *http.Request, cookieName string, now time.Time) (userID string, err error) {
	token := extractToken(r, cookieName)
	if token == "" {
		return "", ErrUnauthenticated
	}
	sess, err := s.GetSession(HashToken(token))
	if err != nil {
		return "", ErrUnauthenticated
	}
	// Treat now == ExpiresAt as expired (matches TS: `expiresAt <= now`).
	if !now.Before(sess.ExpiresAt) {
		return "", ErrUnauthenticated
	}
	_ = s.TouchSession(sess.TokenHash, now)
	return sess.UserID, nil
}

// SignOut deletes the session row matching the request's token (if any). Idempotent.
// Callers must propagate deletion errors and retain credentials for retry.
func SignOut(s storage.Storage, r *http.Request, cookieName string) error {
	token := extractToken(r, cookieName)
	if token == "" {
		return nil
	}
	return s.DeleteSession(HashToken(token))
}

func extractToken(r *http.Request, cookieName string) string {
	if h := r.Header.Get("Authorization"); h != "" {
		if strings.HasPrefix(strings.ToLower(h), "bearer ") {
			return strings.TrimSpace(h[7:])
		}
		return "" // A present header takes precedence, even when malformed.
	}
	if cookieName != "" {
		if c, err := r.Cookie(cookieName); err == nil {
			return c.Value
		}
	}
	return ""
}
