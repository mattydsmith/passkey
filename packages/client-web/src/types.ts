export type AuthUser = { id: string; email: string };

export type StartEmailSignInResult = { otpId: string; expiresInSeconds: number };
export type VerifyEmailOtpResult = { user: AuthUser };
export type RegisterPasskeyResult = { passkeyId: string };
export type SignInWithPasskeyResult = { user: AuthUser };
export type GetCurrentUserResult = { user: AuthUser };

export type SessionSummary = {
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  ip: string | null;
};
export type ListSessionsResult = { sessions: SessionSummary[] };

export type PasskeySummary = {
  id: string;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  transports: string[] | null;
};
export type ListPasskeysResult = { passkeys: PasskeySummary[] };

export interface AuthClientConfig {
  baseUrl: string;
  storage: "cookie" | "header";
  fetch?: typeof fetch;
  storageKey?: string;
  csrfCookieName?: string;
}
