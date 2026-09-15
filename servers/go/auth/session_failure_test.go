package auth

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mattydsmith/passkey/servers/go/storage"
)

type failingSession struct {
	storage.Storage
	cause  error
	lookup bool
}

func (s failingSession) GetSession(hash []byte) (*storage.Session, error) {
	if s.lookup {
		return nil, s.cause
	}
	return s.Storage.GetSession(hash)
}
func (s failingSession) TouchSession([]byte, time.Time) error { return s.cause }

func TestSessionFailureRetainsCauseAndDoesNotAuthenticate(t *testing.T) {
	s := newStore(t)
	now := time.Now()
	token, err := CreateSession(s, "user", time.Hour, now, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	cause := errors.New("synthetic storage failure")
	for _, lookup := range []bool{false, true} {
		id, err := RequireSession(failingSession{s, cause, lookup}, req, "", now)
		if id != "" || !errors.Is(err, ErrSessionUnavailable) || !errors.Is(err, cause) || errors.Is(err, ErrUnauthenticated) {
			t.Fatalf("lookup=%v: id=%q err=%v", lookup, id, err)
		}
	}
	id, err := RequireSession(failingSession{s, storage.ErrNotFound, false}, req, "", now)
	if id != "" || !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("revoked between lookup and touch: %q %v", id, err)
	}
}
