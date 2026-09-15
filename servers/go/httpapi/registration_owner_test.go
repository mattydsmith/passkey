package httpapi

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

// This uses the actual WebAuthn verifier with a synthetic 'none' attestation,
// not a browser/authenticator or a mocked verification result.
func TestRegistrationOwnerHTTP(t *testing.T) {
	for _, cookieMode := range []bool{false, true} {
		t.Run(map[bool]string{false: "bearer", true: "cookie"}[cookieMode], func(t *testing.T) {
			s, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = s.Close() })
			at := time.Now()
			tokens := map[string]string{}
			for _, u := range []string{"owner", "other"} {
				tokens[u], err = auth.CreateSession(s, u, time.Hour, at, nil, nil)
				if err != nil {
					t.Fatal(err)
				}
			}
			cfg := Config{Storage: s, RPID: "example.com", RPName: "Synthetic test", Origins: []string{"https://example.com"}, Now: func() time.Time { return at }}
			if cookieMode {
				cfg.SessionCookieName = "session"
			}
			router := chi.NewRouter()
			if err = Mount(router, cfg); err != nil {
				t.Fatal(err)
			}
			call := func(path, user string, body []byte) *httptest.ResponseRecorder {
				r := httptest.NewRequest("POST", path, bytes.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				if cookieMode {
					r.AddCookie(&http.Cookie{Name: "session", Value: tokens[user]})
					r.AddCookie(&http.Cookie{Name: "csrf", Value: "test-csrf"})
					r.Header.Set("X-CSRF-Token", "test-csrf")
				} else {
					r.Header.Set("Authorization", "Bearer "+tokens[user])
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, r)
				return w
			}
			start := call("/auth/passkey/register/start", "owner", nil)
			var pending struct {
				RegistrationID string `json:"registrationId"`
				Options        struct {
					Challenge string `json:"challenge"`
				} `json:"options"`
			}
			if err = json.Unmarshal(start.Body.Bytes(), &pending); err != nil || start.Code != 200 || pending.Options.Challenge == "" {
				t.Fatalf("start=%d %s", start.Code, start.Body)
			}
			key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			public, err := webauthncbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: key.X.FillBytes(make([]byte, 32)), -3: key.Y.FillBytes(make([]byte, 32))})
			if err != nil {
				t.Fatal(err)
			}
			id := []byte("synthetic-registration")
			rp := sha256.Sum256([]byte("example.com"))
			data := append(append([]byte{}, rp[:]...), byte(0x45))
			data = append(data, make([]byte, 4+16)...)
			length := make([]byte, 2)
			binary.BigEndian.PutUint16(length, uint16(len(id)))
			data = append(data, length...)
			data = append(data, id...)
			data = append(data, public...)
			attestation, err := webauthncbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": data})
			if err != nil {
				t.Fatal(err)
			}
			client, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": pending.Options.Challenge, "origin": "https://example.com"})
			b64 := base64.RawURLEncoding.EncodeToString
			body, _ := json.Marshal(map[string]any{"registrationId": pending.RegistrationID, "userId": "other", "credential": map[string]any{"id": b64(id), "rawId": b64(id), "type": "public-key", "response": map[string]any{"clientDataJSON": b64(client), "attestationObject": b64(attestation)}, "clientExtensionResults": map[string]any{}}})
			// A different authenticated account cannot finish OR consume the owner's
			// pending ceremony, even with its complete valid registration response.
			for i := 0; i < 10; i++ {
				w := call("/auth/passkey/register/finish", "other", body)
				if w.Code != 401 || !bytes.Contains(w.Body.Bytes(), []byte(`"error":"invalid_credential"`)) {
					t.Fatalf("cross-account finish=%d %s", w.Code, w.Body)
				}
				if len(w.Result().Cookies()) != 0 {
					t.Fatal("denial set cookies")
				}
			}
			for _, u := range []string{"owner", "other"} {
				keys, e := s.ListPasskeys(u)
				if e != nil || len(keys) != 0 {
					t.Fatalf("denial persisted passkeys: %s %d %v", u, len(keys), e)
				}
			}
			w := call("/auth/passkey/register/finish", "owner", body)
			if w.Code != 200 {
				t.Fatalf("owner finish=%d %s", w.Code, w.Body)
			}
			saved, err := s.GetPasskey(id)
			if err != nil || saved == nil || saved.UserID != "owner" || !bytes.Equal(saved.PublicKey, public) {
				t.Fatalf("wrong persisted owner/key: %v", err)
			}
			w = call("/auth/passkey/register/finish", "owner", body)
			if w.Code == 200 {
				t.Fatal("registration replay succeeded")
			}
		})
	}
}
