package passkey

import (
	"sync"

	"github.com/go-webauthn/webauthn/webauthn"
)

// PendingRegistrations is an in-memory map of registrationId -> session-data.
type PendingRegistrations struct {
	mu sync.Mutex
	m  map[string]registration
}

type registration struct {
	UserID  string
	Session webauthn.SessionData
}

func NewPendingRegistrations() *PendingRegistrations {
	return &PendingRegistrations{m: map[string]registration{}}
}

func (p *PendingRegistrations) Put(id, userID string, s webauthn.SessionData) {
	p.mu.Lock()
	p.m[id] = registration{UserID: userID, Session: s}
	p.mu.Unlock()
}

func (p *PendingRegistrations) Take(id string) (userID string, s webauthn.SessionData, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	r, ok := p.m[id]
	if !ok {
		return "", webauthn.SessionData{}, false
	}
	delete(p.m, id)
	return r.UserID, r.Session, true
}

// PendingSignIns is the equivalent map for sign-in ceremonies, keyed by signInId.
type PendingSignIns struct {
	mu sync.Mutex
	m  map[string]webauthn.SessionData
}

func NewPendingSignIns() *PendingSignIns {
	return &PendingSignIns{m: map[string]webauthn.SessionData{}}
}

func (p *PendingSignIns) Put(id string, s webauthn.SessionData) {
	p.mu.Lock()
	p.m[id] = s
	p.mu.Unlock()
}

func (p *PendingSignIns) Take(id string) (webauthn.SessionData, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, ok := p.m[id]
	if !ok {
		return webauthn.SessionData{}, false
	}
	delete(p.m, id)
	return s, true
}
