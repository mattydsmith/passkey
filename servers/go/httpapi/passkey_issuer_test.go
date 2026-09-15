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
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-webauthn/webauthn/protocol/webauthncbor"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/passkey"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

func TestPasskeyIssuerVerifiedHTTP(t *testing.T) {
	for _, mode := range []string{"success", "denied", "unavailable", "failure", "empty", "wrong-user", "invalid-signature", "default"} {
		t.Run(mode, func(t *testing.T) {
			s, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := s.Close(); err != nil {
					t.Error(err)
				}
			})
			key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			public, err := webauthncbor.Marshal(map[int]any{1: 2, 3: -7, -1: 1, -2: key.X.FillBytes(make([]byte, 32)), -3: key.Y.FillBytes(make([]byte, 32))})
			if err != nil {
				t.Fatal(err)
			}
			id := []byte("synthetic-passkey")
			at := time.Now()
			if err := s.CreatePasskey(storage.Passkey{CredentialID: id, PublicKey: public, UserID: "synthetic-user", CreatedAt: at}); err != nil {
				t.Fatal(err)
			}
			calls := 0
			cfg := Config{Storage: s, RPID: "example.com", Origins: []string{"https://example.com"}, SessionCookieName: "session", Now: func() time.Time { return at }}
			if mode != "default" {
				cfg.PasskeySignIn = func(ctx context.Context, in passkey.SignInInput) (passkey.SignInResult, error) {
					calls++
					if ctx != in.Request.Context() || in.UserID != "synthetic-user" || !bytes.Equal(in.CredentialID, id) || !bytes.Equal(in.PublicKey, public) || in.SignCount != 1 || in.SessionTTL != 30*24*time.Hour || !in.Now().Equal(at) || in.Request.RemoteAddr != "192.0.2.11:1234" || in.UserAgent == nil || *in.UserAgent != "passkey-test" || in.IP == nil || *in.IP != "spoofed" {
						t.Fatal("host did not receive verified proof/policy/request")
					}
					switch mode {
					case "unavailable":
						return passkey.SignInResult{}, auth.ErrSessionUnavailable
					case "denied":
						return passkey.SignInResult{}, passkey.ErrSignInDenied
					case "failure":
						return passkey.SignInResult{}, errors.New("private host failure")
					case "empty":
						return passkey.SignInResult{}, nil
					case "wrong-user":
						return passkey.SignInResult{SessionToken: "host-token", UserID: "different-user"}, nil
					}
					return passkey.SignInResult{SessionToken: "host-token", UserID: in.UserID}, nil
				}
			}
			router := chi.NewRouter()
			if err := Mount(router, cfg); err != nil {
				t.Fatal(err)
			}
			start := httptest.NewRecorder()
			router.ServeHTTP(start, httptest.NewRequest("POST", "/auth/passkey/sign-in/start", nil))
			var challenge struct {
				SignInID string `json:"signInId"`
				Options  struct {
					Challenge string `json:"challenge"`
				} `json:"options"`
			}
			if err := json.Unmarshal(start.Body.Bytes(), &challenge); err != nil || challenge.Options.Challenge == "" {
				t.Fatalf("start failed status=%d", start.Code)
			}
			clientData, _ := json.Marshal(map[string]any{"type": "webauthn.get", "challenge": challenge.Options.Challenge, "origin": "https://example.com"})
			rpHash := sha256.Sum256([]byte("example.com"))
			authData := append(rpHash[:], byte(5))
			authData = append(authData, make([]byte, 4)...)
			binary.BigEndian.PutUint32(authData[33:], 1)
			clientHash := sha256.Sum256(clientData)
			signed := append(append([]byte{}, authData...), clientHash[:]...)
			digest := sha256.Sum256(signed)
			signature, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
			if err != nil {
				t.Fatal(err)
			}
			if mode == "invalid-signature" {
				signature[len(signature)-1] ^= 1
			}
			b64 := base64.RawURLEncoding.EncodeToString
			body, _ := json.Marshal(map[string]any{"signInId": challenge.SignInID, "credential": map[string]any{"id": b64(id), "rawId": b64(id), "type": "public-key", "response": map[string]any{"clientDataJSON": b64(clientData), "authenticatorData": b64(authData), "signature": b64(signature), "userHandle": b64([]byte("synthetic-user"))}, "clientExtensionResults": map[string]any{}}})
			req := httptest.NewRequest("POST", "/auth/passkey/sign-in/finish", bytes.NewReader(body))
			req.RemoteAddr = "192.0.2.11:1234"
			req.Header.Set("User-Agent", "passkey-test")
			req.Header.Set("X-Forwarded-For", "spoofed")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			wantStatus, wantCalls := 500, 1
			switch mode {
			case "success":
				wantStatus = 200
			case "default":
				wantStatus = 200
				wantCalls = 0
			case "unavailable":
				wantStatus = 503
			case "denied":
				wantStatus = 401
			case "invalid-signature":
				wantStatus = 401
				wantCalls = 0
			}
			if rec.Code != wantStatus || calls != wantCalls {
				t.Fatalf("mode=%s status=%d calls=%d", mode, rec.Code, calls)
			}
			stored, err := s.GetPasskey(id)
			if err != nil {
				t.Fatal(err)
			}
			sessions, err := s.ListSessions("synthetic-user")
			if err != nil {
				t.Fatal(err)
			}
			if mode == "default" {
				if stored.SignCount != 1 || len(sessions) != 1 {
					t.Fatal("legacy issuer did not persist")
				}
			} else if stored.SignCount != 0 || len(sessions) != 0 {
				t.Fatal("host path invoked default persistence")
			}
			if mode == "success" || mode == "default" {
				if len(rec.Result().Cookies()) != 2 {
					t.Fatal("success missing cookies")
				}
			} else if len(rec.Result().Cookies()) != 0 || bytes.Contains(rec.Body.Bytes(), []byte("host-token")) || bytes.Contains(rec.Body.Bytes(), []byte("private host failure")) {
				t.Fatal("failure emitted credentials or private errors")
			}
			again := httptest.NewRecorder()
			router.ServeHTTP(again, httptest.NewRequest("POST", "/auth/passkey/sign-in/finish", bytes.NewReader(body)))
			if again.Code == 200 || calls != wantCalls {
				t.Fatal("spent challenge replayed issuer")
			}
		})
	}
}
