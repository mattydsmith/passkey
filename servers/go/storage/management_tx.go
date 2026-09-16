package storage

import (
	"context"
	"database/sql"
	"errors"
)

type sqliteRowsQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// ListSQLiteSessionsInTx reads through the caller's transaction and retains it.
// Hosts own current account/session admission and lifecycle writer ordering.
func ListSQLiteSessionsInTx(ctx context.Context, tx *sql.Tx, user string) ([]Session, error) {
	if tx == nil {
		return nil, errors.New("session list requires transaction")
	}
	return listSQLiteSessions(ctx, tx, user)
}

// ListSQLitePasskeysInTx retains the caller's transaction; see ListSQLiteSessionsInTx.
func ListSQLitePasskeysInTx(ctx context.Context, tx *sql.Tx, user string) ([]Passkey, error) {
	if tx == nil {
		return nil, errors.New("passkey list requires transaction")
	}
	return listSQLitePasskeys(ctx, tx, user)
}

// DeleteSQLiteOwnedPasskeyInTx removes only the named owner's key. It does not
// commit. Current initiating-session checks and writer admission are host-owned.
func DeleteSQLiteOwnedPasskeyInTx(ctx context.Context, tx *sql.Tx, user string, id []byte) error {
	if tx == nil {
		return errors.New("passkey deletion requires transaction")
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM auth_passkeys WHERE credential_id=? AND user_id=?`, id, user)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrNotFound
	}
	return nil
}
