package passkey

import "testing"

func TestCredIDRoundTrip(t *testing.T) {
	id := []byte{0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE}
	s := CredIDToString(id)
	got, err := CredIDFromString(s)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(id) {
		t.Errorf("roundtrip mismatch: %x -> %s -> %x", id, s, got)
	}
}
