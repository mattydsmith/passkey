import type { Db } from "./db.js";
import { defaultDeps, type Deps } from "./deps.js";
import { AuthError } from "./errors.js";
import type {
  AuthConfig,
  AasaInput,
  User,
  OtpStartResult,
  SignInResult,
  SessionRecord,
} from "./types.js";
import { startEmailOtp, verifyEmailOtp } from "./flows/email-otp.js";
import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  type BeginRegistrationResult,
  type FinishRegistrationInput,
  type FinishRegistrationResult,
} from "./flows/passkey-register.js";
import {
  beginPasskeySignIn,
  finishPasskeySignIn,
  type BeginSignInResult,
  type FinishSignInInput,
} from "./flows/passkey-signin.js";
import {
  createSession,
  validateAndBumpSession,
  revokeSession,
  listSessionsForUser,
} from "./session.js";
import { listPasskeysByUser, deletePasskey } from "./storage/passkeys.js";
import { appleAppSiteAssociation, type AppleAppSiteAssociation } from "./aasa.js";
import { cleanup } from "./cleanup.js";

const DEFAULT_OTP_EXPIRY = 600;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_USER_VERIFICATION: "preferred" = "preferred";

export interface AuthRuntime {
  db: Db;
  deps?: Deps;
}

export function createAuth(config: AuthConfig, runtime: AuthRuntime) {
  const deps = runtime.deps ?? defaultDeps;
  const db = runtime.db;

  const otpExpiry = config.otp?.expirySeconds ?? DEFAULT_OTP_EXPIRY;
  const otpMaxAttempts = config.otp?.maxAttempts ?? DEFAULT_OTP_MAX_ATTEMPTS;
  const userVerification = config.webauthn?.userVerification ?? DEFAULT_USER_VERIFICATION;

  function readToken(req: Request, opts?: { cookieName?: string }): string | null {
    const auth = req.headers.get("authorization");
    if (auth) {
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m) return m[1]!;
      return null; // A malformed header must not fall through to a cookie.
    }
    const cookieName = opts?.cookieName ?? config.session.cookieName;
    if (cookieName) {
      const cookie = req.headers.get("cookie");
      if (cookie) {
        for (const part of cookie.split(";")) {
          const [k, v] = part.trim().split("=", 2);
          if (k === cookieName && v) return decodeURIComponent(v);
        }
      }
    }
    return null;
  }

  return {
    config,
    async startEmailOtp(input: { email: string }): Promise<OtpStartResult> {
      return startEmailOtp({
        db, deps,
        sendOtp: config.email.sendOtp,
        email: input.email,
        expirySeconds: otpExpiry,
      });
    },

    async verifyEmailOtp(input: {
      otpId: string;
      code: string;
      userAgent?: string;
      ip?: string;
    }): Promise<SignInResult> {
      const user = await verifyEmailOtp({
        db, deps,
        findOrCreateByEmail: config.users.findOrCreateByEmail,
        otpId: input.otpId,
        code: input.code,
        maxAttempts: otpMaxAttempts,
      });
      const { sessionToken } = await createSession({
        db, deps,
        userId: user.id,
        lifetimeSeconds: config.session.lifetimeSeconds,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      });
      return { sessionToken, user };
    },

    async beginPasskeyRegistration(args: { user: User }): Promise<BeginRegistrationResult> {
      return beginPasskeyRegistration({
        db, deps,
        userId: args.user.id,
        userEmail: args.user.email,
        rpId: config.rpId,
        rpName: config.rpId,
        userVerification,
      });
    },

    async finishPasskeyRegistration(
      args: Omit<FinishRegistrationInput, "db" | "deps" | "rpId" | "expectedOrigins">
    ): Promise<FinishRegistrationResult> {
      return finishPasskeyRegistration({
        db, deps,
        rpId: config.rpId,
        expectedOrigins: config.origins,
        ...args,
      });
    },

    async beginPasskeySignIn(): Promise<BeginSignInResult> {
      return beginPasskeySignIn({
        db, deps,
        rpId: config.rpId,
        userVerification,
      });
    },

    async finishPasskeySignIn(args: {
      signInId: string;
      credential: FinishSignInInput["credential"];
      userAgent?: string;
      ip?: string;
    }): Promise<SignInResult> {
      const { userId } = await finishPasskeySignIn({
        db, deps,
        rpId: config.rpId,
        expectedOrigins: config.origins,
        signInId: args.signInId,
        credential: args.credential,
      });
      const user: User = { id: userId, email: "" };
      const { sessionToken } = await createSession({
        db, deps,
        userId,
        lifetimeSeconds: config.session.lifetimeSeconds,
        userAgent: args.userAgent ?? null,
        ip: args.ip ?? null,
      });
      return { sessionToken, user };
    },

    async requireSession(
      req: Request,
      opts?: { cookieName?: string }
    ): Promise<{ id: string; email: string }> {
      const token = readToken(req, opts);
      if (!token) {
        throw new AuthError("unauthenticated", "No session token");
      }
      const { userId } = validateAndBumpSession({ db, deps, sessionToken: token });
      return { id: userId, email: "" };
    },

    signOut(args: { sessionToken: string }): void {
      revokeSession({ db, sessionToken: args.sessionToken });
    },

    listSessions(args: { userId: string }): SessionRecord[] {
      return listSessionsForUser(db, args.userId);
    },

    listPasskeys(args: { userId: string }) {
      return listPasskeysByUser(db, args.userId);
    },

    removePasskey(args: { credentialId: Uint8Array }) {
      deletePasskey(db, args.credentialId);
    },

    appleAppSiteAssociation(input: AasaInput): AppleAppSiteAssociation {
      return appleAppSiteAssociation(input);
    },

    cleanup() {
      return cleanup({ db, deps });
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
