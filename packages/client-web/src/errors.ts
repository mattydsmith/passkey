export type AuthClientErrorCode =
  | "invalid_otp"
  | "otp_attempts_exceeded"
  | "otp_expired"
  | "invalid_credential"
  | "unknown_credential"
  | "unauthenticated"
  | "rate_limited"
  | "csrf_required"
  | "invalid_request"
  | "network"
  | "passkey_cancelled"
  | "passkey_failed"
  | "unsupported";

export interface AuthClientErrorOptions {
  status?: number;
  cause?: unknown;
}

export class AuthClientError extends Error {
  readonly code: AuthClientErrorCode | (string & {});
  readonly status: number | undefined;
  override readonly cause: unknown;

  constructor(
    code: AuthClientErrorCode | (string & {}),
    message: string,
    opts: AuthClientErrorOptions = {}
  ) {
    super(message);
    this.name = "AuthClientError";
    this.code = code;
    this.status = opts.status;
    this.cause = opts.cause;
  }
}

export function isAuthClientError(value: unknown): value is AuthClientError {
  return value instanceof AuthClientError;
}
