package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCSRF_MissingHeader_WithSessionCookie_403(t *testing.T) {
	mw := CSRFMiddleware("session", "csrf")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	r := httptest.NewRequest("POST", "/auth/passkeys/abc", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: "tok"})
	r.AddCookie(&http.Cookie{Name: "csrf", Value: "xyz"})
	// X-CSRF-Token header NOT set
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Errorf("status = %d, want 403", w.Code)
	}
}

func TestCSRF_MatchingHeader_PassesThrough(t *testing.T) {
	mw := CSRFMiddleware("session", "csrf")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
	}))
	r := httptest.NewRequest("POST", "/auth/passkeys/abc", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: "tok"})
	r.AddCookie(&http.Cookie{Name: "csrf", Value: "xyz"})
	r.Header.Set("X-CSRF-Token", "xyz")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 204 {
		t.Errorf("status = %d, want 204", w.Code)
	}
}

func TestCSRF_NoSessionCookie_BearerMode_PassesThrough(t *testing.T) {
	mw := CSRFMiddleware("session", "csrf")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
	}))
	r := httptest.NewRequest("POST", "/auth/email/start", nil)
	r.Header.Set("Authorization", "Bearer abc")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 204 {
		t.Errorf("status = %d, want 204 (bearer-only requests bypass csrf)", w.Code)
	}
}

func TestCSRF_GETRequests_PassThrough(t *testing.T) {
	mw := CSRFMiddleware("session", "csrf")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	r := httptest.NewRequest("GET", "/auth/me", nil)
	r.AddCookie(&http.Cookie{Name: "session", Value: "tok"})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Errorf("status = %d, want 200", w.Code)
	}
}
