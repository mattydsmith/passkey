import { createTransport } from "./transport.js";
import { createSessionStorage } from "./storage.js";
import {
  performRegistration,
  performSignIn,
  type ServerCreationOptions,
  type ServerRequestOptions,
} from "./webauthn.js";
import type {
  AuthClientConfig,
  StartEmailSignInResult,
  VerifyEmailOtpResult,
  GetCurrentUserResult,
  RegisterPasskeyResult,
  SignInWithPasskeyResult,
} from "./types.js";

export interface AuthClient {
  startEmailSignIn(email: string): Promise<StartEmailSignInResult>;
  verifyEmailOtp(otpId: string, code: string): Promise<VerifyEmailOtpResult>;
  registerPasskey(opts?: { deviceName?: string }): Promise<RegisterPasskeyResult>;
  signInWithPasskey(): Promise<SignInWithPasskeyResult>;
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

    async registerPasskey(opts) {
      const start = await transport.request<{ registrationId: string; options: ServerCreationOptions }>(
        "/passkey/register/start",
        { method: "POST" }
      );
      const credential = await performRegistration(start.options);
      const body: { registrationId: string; credential: typeof credential; deviceName?: string } = {
        registrationId: start.registrationId,
        credential,
        ...(opts?.deviceName !== undefined ? { deviceName: opts.deviceName } : {}),
      };
      return transport.request<RegisterPasskeyResult>("/passkey/register/finish", {
        method: "POST",
        body,
      });
    },

    async signInWithPasskey() {
      const start = await transport.request<{ signInId: string; options: ServerRequestOptions }>(
        "/passkey/sign-in/start",
        { method: "POST" }
      );
      const credential = await performSignIn(start.options);
      const res = await transport.request<{ sessionToken: string; user: { id: string; email: string } }>(
        "/passkey/sign-in/finish",
        { method: "POST", body: { signInId: start.signInId, credential } }
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
