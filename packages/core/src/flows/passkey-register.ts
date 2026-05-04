import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifyRegistrationResponseOpts,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type { Db } from "../db.js";
import type { Deps } from "../deps.js";
import { listPasskeysByUser, insertPasskey } from "../storage/passkeys.js";
import { AuthError } from "../errors.js";

/** In-process challenge store. Each registration emits an opaque
 *  registrationId; the client echoes it back on `finish` along with the
 *  credential. We look up the original challenge by that ID to verify.
 *  Stored as {challenge, userId, expiresAt}. */
interface PendingRegistration {
  challenge: string;
  userId: string;
  expiresAt: number;
}
const pendingRegistrations = new Map<string, PendingRegistration>();
const REGISTRATION_TTL_SECONDS = 5 * 60;

function gcExpired(now: number) {
  for (const [id, p] of pendingRegistrations) {
    if (p.expiresAt <= now) pendingRegistrations.delete(id);
  }
}

export interface BeginRegistrationInput {
  db: Db;
  deps: Deps;
  userId: string;
  userEmail: string;
  rpId: string;
  rpName: string;
  userVerification: "required" | "preferred" | "discouraged";
}

export interface BeginRegistrationResult {
  registrationId: string;
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
}

export async function beginPasskeyRegistration(
  input: BeginRegistrationInput
): Promise<BeginRegistrationResult> {
  const { db, deps, userId, userEmail, rpId, rpName, userVerification } = input;

  type ExcludeEntry = NonNullable<GenerateRegistrationOptionsOpts["excludeCredentials"]>[number];
  const existing: ExcludeEntry[] = listPasskeysByUser(db, userId).map((p) =>
    ({
      id: Buffer.from(p.credentialId).toString("base64url"),
      ...(p.transports ? { transports: p.transports as ExcludeEntry["transports"] } : {}),
    }) as ExcludeEntry
  );

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userID: new TextEncoder().encode(userId),
    userName: userEmail,
    userDisplayName: userEmail,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification,
    },
    excludeCredentials: existing,
  });

  const now = deps.now();
  gcExpired(now);
  const registrationId = deps.randomId("reg");
  pendingRegistrations.set(registrationId, {
    challenge: options.challenge,
    userId,
    expiresAt: now + REGISTRATION_TTL_SECONDS,
  });

  return { registrationId, options };
}

export interface FinishRegistrationInput {
  db: Db;
  deps: Deps;
  registrationId: string;
  credential: Parameters<typeof verifyRegistrationResponse>[0]["response"];
  rpId: string;
  expectedOrigins: string[];
  deviceName?: string;
}

export interface FinishRegistrationResult {
  passkeyId: string;
}

export async function finishPasskeyRegistration(
  input: FinishRegistrationInput
): Promise<FinishRegistrationResult> {
  const { db, deps, registrationId, credential, rpId, expectedOrigins, deviceName } = input;

  const pending = pendingRegistrations.get(registrationId);
  if (!pending) {
    throw new AuthError("invalid_credential", "Registration not found or expired");
  }
  pendingRegistrations.delete(registrationId);
  if (pending.expiresAt <= deps.now()) {
    throw new AuthError("invalid_credential", "Registration expired");
  }

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: pending.challenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpId,
      requireUserVerification: false,
    } satisfies VerifyRegistrationResponseOpts);
  } catch (cause) {
    throw new AuthError("invalid_credential", `Verification failed: ${(cause as Error).message}`);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AuthError("invalid_credential", "Verification did not succeed");
  }

  const info = verification.registrationInfo;
  // @simplewebauthn/server v10 uses flat properties on registrationInfo
  const credentialId = info.credentialID; // Base64URLString
  const publicKey = info.credentialPublicKey; // Uint8Array
  const aaguid = info.aaguid ?? null; // string | null (already a string in v10)

  insertPasskey(db, {
    credentialId: Buffer.from(credentialId, "base64url"),
    userId: pending.userId,
    publicKey: new Uint8Array(publicKey),
    signCount: info.counter,
    transports: null,
    aaguid: aaguid ? Buffer.from(aaguid, "hex") : null,
    deviceName: deviceName ?? null,
    createdAt: deps.now(),
    lastUsedAt: null,
  });

  return { passkeyId: credentialId };
}
