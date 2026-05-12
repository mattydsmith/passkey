package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type sqliteStore struct {
	db *sql.DB
	mu sync.Mutex // serialises writes
}

// OpenSQLite opens (or creates) a SQLite database at path, applies all
// pending migrations, and returns a Storage backed by it.
func OpenSQLite(path string) (Storage, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	if err := runMigrations(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &sqliteStore{db: db}, nil
}

func (s *sqliteStore) Close() error { return s.db.Close() }

// --- Sessions ----------------------------------------------------------------

func (s *sqliteStore) CreateSession(sess Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sess.TokenHash, sess.UserID,
		sess.CreatedAt.Unix(), sess.ExpiresAt.Unix(), sess.LastSeenAt.Unix(),
		nullStr(sess.UserAgent), nullStr(sess.IP),
	)
	return err
}

func (s *sqliteStore) GetSession(tokenHash []byte) (*Session, error) {
	row := s.db.QueryRow(
		`SELECT token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip
		 FROM auth_sessions WHERE token_hash = ?`,
		tokenHash,
	)
	var sess Session
	var createdAt, expiresAt, lastSeenAt int64
	var ua, ip sql.NullString
	if err := row.Scan(&sess.TokenHash, &sess.UserID, &createdAt, &expiresAt, &lastSeenAt, &ua, &ip); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	sess.CreatedAt = time.Unix(createdAt, 0)
	sess.ExpiresAt = time.Unix(expiresAt, 0)
	sess.LastSeenAt = time.Unix(lastSeenAt, 0)
	if ua.Valid {
		v := ua.String
		sess.UserAgent = &v
	}
	if ip.Valid {
		v := ip.String
		sess.IP = &v
	}
	return &sess, nil
}

func (s *sqliteStore) TouchSession(tokenHash []byte, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?`,
		at.Unix(), tokenHash,
	)
	return err
}

func (s *sqliteStore) DeleteSession(tokenHash []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM auth_sessions WHERE token_hash = ?`, tokenHash)
	return err
}

func (s *sqliteStore) ListSessions(userID string) ([]Session, error) {
	rows, err := s.db.Query(
		`SELECT token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip
		 FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var sess Session
		var createdAt, expiresAt, lastSeenAt int64
		var ua, ip sql.NullString
		if err := rows.Scan(&sess.TokenHash, &sess.UserID, &createdAt, &expiresAt, &lastSeenAt, &ua, &ip); err != nil {
			return nil, err
		}
		sess.CreatedAt = time.Unix(createdAt, 0)
		sess.ExpiresAt = time.Unix(expiresAt, 0)
		sess.LastSeenAt = time.Unix(lastSeenAt, 0)
		if ua.Valid {
			v := ua.String
			sess.UserAgent = &v
		}
		if ip.Valid {
			v := ip.String
			sess.IP = &v
		}
		out = append(out, sess)
	}
	return out, nil
}

// --- Email OTPs --------------------------------------------------------------

func (s *sqliteStore) CreateOTP(o EmailOTP) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`INSERT INTO auth_email_otps (id, email, code_hash, attempts, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		o.ID, o.Email, o.CodeHash, o.Attempts, o.CreatedAt.Unix(), o.ExpiresAt.Unix(),
	)
	return err
}

func (s *sqliteStore) GetOTP(id string) (*EmailOTP, error) {
	row := s.db.QueryRow(
		`SELECT id, email, code_hash, attempts, created_at, expires_at, consumed_at
		 FROM auth_email_otps WHERE id = ?`,
		id,
	)
	var o EmailOTP
	var createdAt, expiresAt int64
	var consumedAt sql.NullInt64
	if err := row.Scan(&o.ID, &o.Email, &o.CodeHash, &o.Attempts, &createdAt, &expiresAt, &consumedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	o.CreatedAt = time.Unix(createdAt, 0)
	o.ExpiresAt = time.Unix(expiresAt, 0)
	if consumedAt.Valid {
		t := time.Unix(consumedAt.Int64, 0)
		o.ConsumedAt = &t
	}
	return &o, nil
}

func (s *sqliteStore) IncrementOTPAttempts(id string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.Exec(`UPDATE auth_email_otps SET attempts = attempts + 1 WHERE id = ?`, id)
	if err != nil {
		return 0, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return 0, ErrNotFound
	}
	var attempts int
	if err := s.db.QueryRow(`SELECT attempts FROM auth_email_otps WHERE id = ?`, id).Scan(&attempts); err != nil {
		return 0, err
	}
	return attempts, nil
}

func (s *sqliteStore) ConsumeOTP(id string, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`UPDATE auth_email_otps SET consumed_at = ? WHERE id = ?`, at.Unix(), id)
	return err
}

func (s *sqliteStore) ForceExpireOTP(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`UPDATE auth_email_otps SET expires_at = 0 WHERE id = ?`, id)
	return err
}

// --- Passkeys ----------------------------------------------------------------

func (s *sqliteStore) CreatePasskey(p Passkey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var lastUsed sql.NullInt64
	if p.LastUsedAt != nil {
		lastUsed.Int64 = p.LastUsedAt.Unix()
		lastUsed.Valid = true
	}
	_, err := s.db.Exec(
		`INSERT INTO auth_passkeys (credential_id, user_id, public_key, sign_count, transports, aaguid, device_name, created_at, last_used_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.CredentialID, p.UserID, p.PublicKey, p.SignCount,
		nullStr(p.Transports), p.AAGUID, nullStr(p.DeviceName),
		p.CreatedAt.Unix(), lastUsed,
	)
	return err
}

func (s *sqliteStore) GetPasskey(credentialID []byte) (*Passkey, error) {
	row := s.db.QueryRow(
		`SELECT credential_id, user_id, public_key, sign_count, transports, aaguid, device_name, created_at, last_used_at
		 FROM auth_passkeys WHERE credential_id = ?`,
		credentialID,
	)
	return scanPasskey(row)
}

func (s *sqliteStore) ListPasskeys(userID string) ([]Passkey, error) {
	rows, err := s.db.Query(
		`SELECT credential_id, user_id, public_key, sign_count, transports, aaguid, device_name, created_at, last_used_at
		 FROM auth_passkeys WHERE user_id = ? ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Passkey
	for rows.Next() {
		p, err := scanPasskey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, nil
}

func (s *sqliteStore) UpdatePasskeySignCount(credentialID []byte, signCount uint32, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(
		`UPDATE auth_passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?`,
		signCount, at.Unix(), credentialID,
	)
	return err
}

func (s *sqliteStore) DeletePasskey(credentialID []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM auth_passkeys WHERE credential_id = ?`, credentialID)
	return err
}

// --- helpers -----------------------------------------------------------------

type rowScanner interface {
	Scan(dest ...interface{}) error
}

func scanPasskey(row rowScanner) (*Passkey, error) {
	var p Passkey
	var transports, deviceName sql.NullString
	var createdAt int64
	var lastUsedAt sql.NullInt64
	if err := row.Scan(&p.CredentialID, &p.UserID, &p.PublicKey, &p.SignCount, &transports, &p.AAGUID, &deviceName, &createdAt, &lastUsedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	p.CreatedAt = time.Unix(createdAt, 0)
	if transports.Valid {
		v := transports.String
		p.Transports = &v
	}
	if deviceName.Valid {
		v := deviceName.String
		p.DeviceName = &v
	}
	if lastUsedAt.Valid {
		t := time.Unix(lastUsedAt.Int64, 0)
		p.LastUsedAt = &t
	}
	return &p, nil
}

func nullStr(p *string) interface{} {
	if p == nil {
		return nil
	}
	return *p
}
