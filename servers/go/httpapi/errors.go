package httpapi

import "errors"

// ErrStorageRequired is returned by Mount when cfg.Storage is nil.
var ErrStorageRequired = errors.New("httpapi: Config.Storage is required")
