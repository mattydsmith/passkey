// Package storage owns the persistence schema for sessions, passkeys, and
// pending email OTPs. The Storage interface is the seam between the SDK and
// any backing store; only a SQLite impl ships today.
package storage

// Storage is the persistence interface implemented by storage backends.
// Methods are added incrementally as later phases need them.
type Storage interface{}
