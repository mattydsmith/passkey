// packages/core/src/types.ts

/** Identity returned to clients. The project's user table may have more fields;
 *  the SDK only knows about these. */
export interface User {
  id: string;
  email: string;
}

/** What the OTP flow returns from `start`. */
export interface OtpStartResult {
  otpId: string;
  expiresInSeconds: number;
}

/** What sign-in flows return on success. */
export interface SignInResult {
  sessionToken: string;
  user: User;
}

/** Internal record shapes (storage layer returns these). */
export interface SessionRecord {
  tokenHash: Uint8Array;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  ip: string | null;
}

export interface OtpRecord {
  id: string;
  email: string;
  codeHash: Uint8Array;
  attempts: number;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface PasskeyRecord {
  credentialId: Uint8Array;
  userId: string;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[] | null;
  aaguid: Uint8Array | null;
  deviceName: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Project-supplied hook: map an email to a user_id. */
export type FindOrCreateByEmail = (email: string) => Promise<string>;

/** Project-supplied hook: send an OTP code. SDK never bundles a transport. */
export type SendOtp = (args: { to: string; code: string }) => Promise<void>;

/** AASA helper input. */
export interface AasaInput {
  appIds: string[];
}

/** Full SDK config. */
export interface AuthConfig {
  rpId: string;
  origins: string[];
  session: {
    lifetimeSeconds: number;
    cookieName?: string;
  };
  otp?: {
    expirySeconds?: number;
    maxAttempts?: number;
  };
  webauthn?: {
    userVerification?: "required" | "preferred" | "discouraged";
  };
  email: { sendOtp: SendOtp };
  users: { findOrCreateByEmail: FindOrCreateByEmail };
}
