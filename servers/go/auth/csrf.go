package auth

import "net/http"

// CSRFMiddleware enforces the double-submit cookie pattern. For non-GET requests
// that carry the session cookie, it requires the X-CSRF-Token header to match
// the csrf cookie. Bearer-only requests (no session cookie) bypass the check.
func CSRFMiddleware(sessionCookieName, csrfCookieName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			// Look up the session cookie. No cookie => bearer mode => skip.
			sc, err := r.Cookie(sessionCookieName)
			if err != nil || sc.Value == "" {
				next.ServeHTTP(w, r)
				return
			}
			cc, err := r.Cookie(csrfCookieName)
			header := r.Header.Get("X-CSRF-Token")
			if err != nil || cc.Value == "" || header == "" || header != cc.Value {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(403)
				_, _ = w.Write([]byte(`{"error":"csrf_required","message":"CSRF token required"}`))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
