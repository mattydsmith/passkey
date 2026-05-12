package passkey

import (
	"encoding/json"
	"net/http"
)

// writeJSON encodes body as JSON and writes it with the given status.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeJSONError encodes a {error, message} body matching spec/protocol.md
// and writes it with the given status.
func writeJSONError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": code, "message": msg})
}
