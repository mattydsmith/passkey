export {
  AuthClientError,
  isAuthClientError,
  type AuthClientErrorCode,
  type AuthClientErrorOptions,
} from "./errors.js";

export { createAuthClient, type AuthClient } from "./client.js";

export type {
  AuthUser,
  AuthClientConfig,
  StartEmailSignInResult,
  VerifyEmailOtpResult,
  RegisterPasskeyResult,
  SignInWithPasskeyResult,
  GetCurrentUserResult,
  SessionSummary,
  ListSessionsResult,
  PasskeySummary,
  ListPasskeysResult,
} from "./types.js";
