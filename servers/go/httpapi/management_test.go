package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/mattydsmith/passkey/servers/go/auth"
	"github.com/mattydsmith/passkey/servers/go/storage"
)

type managementStorage struct {
	storage.Storage
	reads, deletes int
}

func (s *managementStorage) ListSessions(u string) ([]storage.Session, error) {
	s.reads++
	return s.Storage.ListSessions(u)
}
func (s *managementStorage) ListPasskeys(u string) ([]storage.Passkey, error) {
	s.reads++
	return s.Storage.ListPasskeys(u)
}
func (s *managementStorage) GetPasskey(id []byte) (*storage.Passkey, error) {
	s.reads++
	return s.Storage.GetPasskey(id)
}
func (s *managementStorage) DeletePasskey(id []byte) error {
	s.deletes++
	return s.Storage.DeletePasskey(id)
}
func TestAccountManagementHTTP(t *testing.T) {
	for _, op := range []auth.ManagementOperation{auth.ManagementMe, auth.ManagementSessions, auth.ManagementPasskeys, auth.ManagementDeletePasskey} {
		for _, mode := range []string{"default", "success", "denied", "failure", "foreign", "missing", "not-found"} {
			if (mode == "foreign" && (op == auth.ManagementMe || op == auth.ManagementDeletePasskey)) || (mode == "not-found" && op != auth.ManagementDeletePasskey) {
				continue
			}
			for _, cookie := range []bool{false, true} {
				t.Run(string(op)+"/"+mode+map[bool]string{false: "/bearer", true: "/cookie"}[cookie], func(t *testing.T) {
					raw, err := storage.OpenSQLite(filepath.Join(t.TempDir(), "auth.db"))
					if err != nil {
						t.Fatal(err)
					}
					defer raw.Close()
					s := &managementStorage{Storage: raw}
					at := time.Now().Truncate(time.Second)
					token, err := auth.CreateSession(raw, "owner", time.Hour, at, nil, nil)
					if err != nil {
						t.Fatal(err)
					}
					key := storage.Passkey{UserID: "owner", CredentialID: []byte("owned-key"), PublicKey: []byte("private-public-key-storage-field"), CreatedAt: at}
					if err = raw.CreatePasskey(key); err != nil {
						t.Fatal(err)
					}
					cfg := Config{Storage: s, RPID: "example.com", RPName: "test", Origins: []string{"https://example.com"}, Now: func() time.Time { return at }}
					if cookie {
						cfg.SessionCookieName = "session"
					}
					calls := 0
					if mode != "default" {
						cfg.AccountManagement = func(ctx context.Context, in auth.ManagementInput) (auth.ManagementResult, error) {
							calls++
							if ctx != in.Request.Context() || in.Operation != op || in.UserID != "owner" || !bytes.Equal(in.SessionHash, auth.HashToken(token)) || !in.Now().Equal(at) {
								t.Fatal("wrong host input")
							}
							switch mode {
							case "denied":
								return auth.ManagementResult{}, auth.ErrUnauthenticated
							case "failure":
								return auth.ManagementResult{}, errors.New("private database details")
							case "not-found":
								return auth.ManagementResult{}, storage.ErrNotFound
							}
							var result auth.ManagementResult
							switch op {
							case auth.ManagementMe:
							case auth.ManagementSessions:
								result.Sessions, err = raw.ListSessions("owner")
								if mode == "foreign" {
									result.Sessions[0].UserID = "other"
								}
							case auth.ManagementPasskeys:
								result.Passkeys, err = raw.ListPasskeys("owner")
								if mode == "foreign" {
									result.Passkeys[0].UserID = "other"
								}
							case auth.ManagementDeletePasskey:
								if !bytes.Equal(in.CredentialID, key.CredentialID) {
									t.Fatal("wrong delete ID")
								}
								err = raw.DeletePasskey(in.CredentialID)
							}
							return result, err
						}
					}
					rtr := chi.NewRouter()
					if err = Mount(rtr, cfg); err != nil {
						t.Fatal(err)
					}
					path := "/auth/" + string(op)
					method := "GET"
					if op == auth.ManagementDeletePasskey {
						method = "DELETE"
						path = "/auth/passkeys/" + base64.RawURLEncoding.EncodeToString(key.CredentialID)
					}
					r := httptest.NewRequest(method, path, nil)
					if mode != "missing" {
						if cookie {
							r.AddCookie(&http.Cookie{Name: "session", Value: token})
						} else {
							r.Header.Set("Authorization", "Bearer "+token)
						}
					}
					if cookie {
						r.AddCookie(&http.Cookie{Name: "csrf", Value: "test"})
						r.Header.Set("X-CSRF-Token", "test")
					}
					w := httptest.NewRecorder()
					rtr.ServeHTTP(w, r)
					status, code, wantCalls := 200, "", 1
					switch mode {
					case "default":
						wantCalls = 0
					case "missing":
						wantCalls = 0
						status, code = 401, "unauthenticated"
					case "denied":
						status, code = 401, "unauthenticated"
					case "failure", "foreign":
						status, code = 503, "session_unavailable"
					case "not-found":
						status, code = 404, "unknown_credential"
					}
					if w.Code != status || calls != wantCalls {
						t.Fatalf("status=%d host=%d want=%d/%d body=%s", w.Code, calls, status, wantCalls, w.Body)
					}
					if mode != "default" && (s.reads != 0 || s.deletes != 0) {
						t.Fatal("host operation fell back to storage")
					}
					if mode == "default" {
						wantReads := 1
						if op == auth.ManagementMe {
							wantReads = 0
						}
						if s.reads != wantReads || (s.deletes == 1) != (op == auth.ManagementDeletePasskey) {
							t.Fatal("default behavior changed")
						}
					}
					var body map[string]any
					if err = json.Unmarshal(w.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
					if status != 200 {
						if body["error"] != code || body["user"] != nil || body["sessions"] != nil || body["passkeys"] != nil || body["ok"] != nil {
							t.Fatalf("refusal=%v", body)
						}
					} else {
						switch op {
						case auth.ManagementMe:
							if body["user"].(map[string]any)["id"] != "owner" {
								t.Fatal("wrong identity")
							}
						case auth.ManagementSessions:
							rows := body["sessions"].([]any)
							if len(rows) != 1 || rows[0].(map[string]any)["expiresAt"] != float64(at.Add(time.Hour).Unix()) {
								t.Fatal("missing host session data")
							}
						case auth.ManagementPasskeys:
							rows := body["passkeys"].([]any)
							if len(rows) != 1 || rows[0].(map[string]any)["id"] != base64.RawURLEncoding.EncodeToString(key.CredentialID) {
								t.Fatal("missing host passkey data")
							}
						case auth.ManagementDeletePasskey:
							if body["ok"] != true {
								t.Fatal("missing success")
							}
						}
					}
					keys, err := raw.ListPasskeys("owner")
					if err != nil {
						t.Fatal(err)
					}
					wantKeys := 1
					if op == auth.ManagementDeletePasskey && status == 200 {
						wantKeys = 0
					}
					if len(keys) != wantKeys {
						t.Fatal("wrong persisted deletion")
					}
					if (w.Header().Get("Retry-After") == "1") != (status == 503) || len(w.Result().Cookies()) != 0 || bytes.Contains(w.Body.Bytes(), []byte("private")) {
						t.Fatal("retry/cookie/private response")
					}
				})
			}
		}
	}
}
