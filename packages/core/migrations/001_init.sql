CREATE TABLE IF NOT EXISTS auth_passkeys (
  credential_id BLOB    PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  public_key    BLOB    NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  aaguid        BLOB,
  device_name   TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS auth_passkeys_user ON auth_passkeys(user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash    BLOB    PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_email_otps (
  id          TEXT    PRIMARY KEY,
  email       TEXT    NOT NULL,
  code_hash   BLOB    NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS auth_email_otps_email ON auth_email_otps(email);

CREATE TABLE IF NOT EXISTS auth_migrations (
  filename   TEXT    PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
