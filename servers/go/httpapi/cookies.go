package httpapi

import (
	"net/http"
	"strings"
)

func isHTTPS(r *http.Request) bool {
	if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return r.TLS != nil
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, name, token string, maxAgeSeconds int) {
	c := &http.Cookie{
		Name:     name,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAgeSeconds,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
	}
	http.SetCookie(w, c)
}

func clearSessionCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   0,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func setCSRFCookie(w http.ResponseWriter, r *http.Request, name, token string, maxAgeSeconds int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAgeSeconds,
		HttpOnly: false, // client must read it
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
	})
}

func clearCSRFCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   0,
		HttpOnly: false,
		SameSite: http.SameSiteLaxMode,
	})
}
