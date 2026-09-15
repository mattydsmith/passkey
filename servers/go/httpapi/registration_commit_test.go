package httpapi

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"github.com/mattydsmith/passkey/servers/go/passkey"
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
func TestRegistrationCommitHTTP(t *testing.T) {
	for _, mode := range []string{"default", "success", "denied", "unavailable", "failure", "new-session", "invalid-attestation"} {
		t.Run(mode, func(t *testing.T) {
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
					calls := 0
					if mode != "default" {
						cfg.PasskeyRegistration = func(ctx context.Context, in passkey.RegistrationInput) error {
							calls++
							if ctx != in.Request.Context() || in.Credential.UserID != "owner" || !bytes.Equal(in.SessionHash, auth.HashToken(tokens["owner"])) || !in.Now().Equal(at) || len(in.Credential.PublicKey) == 0 || len(in.Credential.CredentialID) == 0 {
								t.Fatal("host input omitted verified identity/session/key/request/clock")
							}
							switch mode {
							case "denied":
								return passkey.ErrSignInDenied
							case "unavailable":
								return auth.ErrSessionUnavailable
							case "failure":
								return errors.New("private persistence detail")
							}
							return s.CreatePasskey(in.Credential)
						}
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
					if mode == "invalid-attestation" {
						pending.Options.Challenge = "wrong-challenge"
					}
					client, _ := json.Marshal(map[string]any{"type": "webauthn.create", "challenge": pending.Options.Challenge, "origin": "https://example.com"})
					b64 := base64.RawURLEncoding.EncodeToString
					body, _ := json.Marshal(map[string]any{"registrationId": pending.RegistrationID, "userId": "other", "credential": map[string]any{"id": b64(id), "rawId": b64(id), "type": "public-key", "response": map[string]any{"clientDataJSON": b64(client), "attestationObject": b64(attestation)}, "clientExtensionResults": map[string]any{}}})
					if mode == "new-session" {
						tokens["owner"], err = auth.CreateSession(s, "owner", time.Hour, at, nil, nil)
						if err != nil {
							t.Fatal(err)
						}
					}
					w := call("/auth/passkey/register/finish", "owner", body)
					wantStatus, wantCalls := 200, 1
					switch mode {
					case "default":
						wantCalls = 0
					case "denied":
						wantStatus = 401
					case "unavailable":
						wantStatus = 503
					case "failure":
						wantStatus = 500
					case "new-session", "invalid-attestation":
						wantStatus = 401
						wantCalls = 0
					}
					if w.Code != wantStatus || calls != wantCalls {
						t.Fatalf("status=%d calls=%d body=%s", w.Code, calls, w.Body)
					}
					if len(w.Result().Cookies()) != 0 || bytes.Contains(w.Body.Bytes(), []byte("private persistence")) {
						t.Fatal("unexpected cookies/private details")
					}
					if mode == "unavailable" && w.Header().Get("Retry-After") != "1" {
						t.Fatal("missing retry guidance")
					}
					keys, e := s.ListPasskeys("owner")
					if e != nil {
						t.Fatal(e)
					}
					if wantStatus == 200 {
						if len(keys) != 1 || !bytes.Equal(keys[0].PublicKey, public) {
							t.Fatal("success missing verified key")
						}
					} else if len(keys) != 0 {
						t.Fatal("failure invoked default persistence")
					}
					again := call("/auth/passkey/register/finish", "owner", body)
					if again.Code == 200 || calls != wantCalls {
						t.Fatal("spent ceremony invoked commit again")
					}
				})
			}
		})
	}
}
