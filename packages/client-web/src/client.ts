import { createTransport } from "./transport.js";
import { createSessionStorage } from "./storage.js";
import type {
  AuthClientConfig,
  StartEmailSignInResult,
  VerifyEmailOtpResult,
  GetCurrentUserResult,
} from "./types.js";

export interface AuthClient {
  startEmailSignIn(email: string): Promise<StartEmailSignInResult>;
  verifyEmailOtp(otpId: string, code: string): Promise<VerifyEmailOtpResult>;
  getCurrentUser(): Promise<GetCurrentUserResult>;
  signOut(): Promise<void>;
}

export function createAuthClient(config: AuthClientConfig): AuthClient {
  const storage = createSessionStorage(
    config.storage,
    config.storageKey !== undefined ? { storageKey: config.storageKey } : {}
  );
  const transport = createTransport({
    baseUrl: config.baseUrl,
    storage,
    ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
    ...(config.csrfCookieName !== undefined ? { csrfCookieName: config.csrfCookieName } : {}),
  });

  return {
    async startEmailSignIn(email) {
      return transport.request<StartEmailSignInResult>("/email/start", {
        method: "POST",
        body: { email },
      });
    },

    async verifyEmailOtp(otpId, code) {
      const res = await transport.request<{ sessionToken: string; user: { id: string; email: string } }>(
        "/email/verify",
        { method: "POST", body: { otpId, code } }
      );
      storage.save(res.sessionToken);
      return { user: res.user };
    },

    async getCurrentUser() {
      return transport.request<GetCurrentUserResult>("/me", { method: "GET" });
    },

    async signOut() {
      await transport.request<{ ok: true }>("/sign-out", { method: "POST" });
      storage.clear();
    },
  };
}
