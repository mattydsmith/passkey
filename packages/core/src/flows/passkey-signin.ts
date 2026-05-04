import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifyAuthenticationResponseOpts,
} from "@simplewebauthn/server";
import type { Db } from "../db.js";
import type { Deps } from "../deps.js";
import { AuthError } from "../errors.js";
import {
  getPasskeyByCredentialId,
  updatePasskeySignCount,
} from "../storage/passkeys.js";

interface PendingSignIn {
  challenge: string;
  expiresAt: number;
}
const pendingSignIns = new Map<string, PendingSignIn>();
const SIGNIN_TTL_SECONDS = 5 * 60;

function gcExpired(now: number) {
  for (const [id, p] of pendingSignIns) {
    if (p.expiresAt <= now) pendingSignIns.delete(id);
  }
}

export interface BeginSignInInput {
  db: Db;
  deps: Deps;
  rpId: string;
  userVerification: "required" | "preferred" | "discouraged";
}

export interface BeginSignInResult {
  signInId: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
}

export async function beginPasskeySignIn(input: BeginSignInInput): Promise<BeginSignInResult> {
  const { deps, rpId, userVerification } = input;
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification,
    allowCredentials: [], // discoverable creds — no email needed at sign-in
  });

  const now = deps.now();
  gcExpired(now);
  const signInId = deps.randomId("auth");
  pendingSignIns.set(signInId, {
    challenge: options.challenge,
    expiresAt: now + SIGNIN_TTL_SECONDS,
  });

  return { signInId, options };
}

export interface FinishSignInInput {
  db: Db;
  deps: Deps;
  signInId: string;
  credential: Parameters<typeof verifyAuthenticationResponse>[0]["response"];
  rpId: string;
  expectedOrigins: string[];
}

export interface FinishSignInResult {
  userId: string;
}

export async function finishPasskeySignIn(input: FinishSignInInput): Promise<FinishSignInResult> {
  const { db, deps, signInId, credential, rpId, expectedOrigins } = input;

  const pending = pendingSignIns.get(signInId);
  if (!pending) {
    throw new AuthError("invalid_credential", "Sign-in not found or expired");
  }
  pendingSignIns.delete(signInId);
  if (pending.expiresAt <= deps.now()) {
    throw new AuthError("invalid_credential", "Sign-in expired");
  }

  // The WebAuthn assertion identifies the credential by its rawId.
  const credIdBase64Url = credential.rawId;
  const credId = new Uint8Array(Buffer.from(credIdBase64Url, "base64url"));
  const stored = getPasskeyByCredentialId(db, credId);
  if (!stored) {
    throw new AuthError("unknown_credential", "Credential not registered");
  }

  // v10 API: uses `authenticator` field (not `credential`) with shape
  // { credentialID: Base64URLString, credentialPublicKey: Uint8Array, counter, transports? }
  // exactOptionalPropertyTypes requires omitting the key entirely rather than setting undefined.
  type AuthDevice = VerifyAuthenticationResponseOpts["authenticator"];
  type Transports = NonNullable<AuthDevice["transports"]>;
  const authenticatorBase = {
    credentialID: Buffer.from(stored.credentialId).toString("base64url"),
    credentialPublicKey: stored.publicKey,
    counter: stored.signCount,
  };
  const authenticatorDevice: AuthDevice = stored.transports
    ? { ...authenticatorBase, transports: stored.transports as Transports }
    : authenticatorBase;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpId,
      authenticator: authenticatorDevice,
      requireUserVerification: false,
    } satisfies VerifyAuthenticationResponseOpts);
  } catch (cause) {
    throw new AuthError("invalid_credential", `Verification failed: ${(cause as Error).message}`);
  }

  if (!verification.verified) {
    throw new AuthError("invalid_credential", "Verification did not succeed");
  }

  updatePasskeySignCount(
    db,
    stored.credentialId,
    verification.authenticationInfo.newCounter,
    deps.now()
  );

  return { userId: stored.userId };
}
