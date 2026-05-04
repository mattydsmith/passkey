export const AUTH_ERROR_CODES = [
  "invalid_otp",
  "otp_attempts_exceeded",
  "otp_expired",
  "invalid_credential",
  "unknown_credential",
  "unauthenticated",
  "rate_limited",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }

  toJSON(): { error: AuthErrorCode; message: string } {
    return { error: this.code, message: this.message };
  }

  static is<C extends AuthErrorCode>(
    err: unknown,
    code?: C
  ): err is AuthError & { code: C } {
    if (!(err instanceof AuthError)) return false;
    return code === undefined || err.code === code;
  }
}
