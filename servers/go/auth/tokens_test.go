package auth

import "testing"

func TestRandomToken_LengthAndUniqueness(t *testing.T) {
	a, err := RandomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	b, err := RandomToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Error("two random tokens collided")
	}
	if len(a) < 32 {
		t.Errorf("token too short: %q", a)
	}
}

func TestHashToken_Deterministic(t *testing.T) {
	a := HashToken("hello")
	b := HashToken("hello")
	if string(a) != string(b) {
		t.Error("hash is non-deterministic")
	}
}
