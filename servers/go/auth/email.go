// Package auth implements email OTP, sessions, and CSRF middleware.
package auth

// EmailSender delivers OTP codes to users. Implementations may be no-ops,
// log-only, or talk to a real provider.
type EmailSender interface {
	SendOTP(email, code string) error
}
