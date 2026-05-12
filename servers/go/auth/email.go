package auth

import (
	"log/slog"
	"sync"
)

// EmailSender delivers OTP codes.
type EmailSender interface {
	SendOTP(email, code string) error
}

// LoggingEmailer is a stub that logs the code at info level instead of sending email.
// It also exposes the most recent code via LastCode for /__test/last-otp.
type LoggingEmailer struct {
	mu   sync.Mutex
	last map[string]string // email -> last code
}

// NewLoggingEmailer returns a LoggingEmailer ready to record.
func NewLoggingEmailer() *LoggingEmailer {
	return &LoggingEmailer{last: map[string]string{}}
}

func (l *LoggingEmailer) SendOTP(email, code string) error {
	l.mu.Lock()
	l.last[email] = code
	l.mu.Unlock()
	slog.Info("OTP", "email", email, "code", code)
	return nil
}

// LastCode returns the most recent code sent to email, or "" if none.
func (l *LoggingEmailer) LastCode(email string) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.last[email]
}
