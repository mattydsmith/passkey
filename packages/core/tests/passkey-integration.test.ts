/**
 * WebAuthn ceremony plumbing integration tests.
 *
 * These tests mock @simplewebauthn/server's verifiers (the library itself is
 * well-tested) to exercise the full registration and sign-in flow: storing
 * credentials, looking them up, and returning session tokens.
 *
 * Targeting @simplewebauthn/server v10's flat registrationInfo shape:
 *   - credentialID: Base64URLString
 *   - credentialPublicKey: Uint8Array
 *   - counter: number
 *   - aaguid: string  (implementation calls Buffer.from(aaguid, "hex"), so
 *                       must be a hex string without dashes — 32 hex chars)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAuth } from "../src/auth.js";
import { AuthError } from "../src/errors.js";
import { createHarness, type Harness } from "./setup.js";

// ---------------------------------------------------------------------------
// Module-level mock — must be hoisted before any imports of the module under
// test so that the named imports captured in passkey-register.ts / passkey-
// signin.ts refer to these mock functions.
// ---------------------------------------------------------------------------
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});

// Import the mocked module so we can call .mockResolvedValue() in each test.
import * as simpleWebauthn from "@simplewebauthn/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A stable credential ID used across tests (3 bytes → base64url "Cgsk")
const CRED_ID_BYTES = new Uint8Array([10, 11, 12]);
const CRED_ID_BASE64URL = Buffer.from(CRED_ID_BYTES).toString("base64url");

// A hex-encoded aaguid (16 bytes, no dashes — required by passkey-register.ts
// which calls Buffer.from(aaguid, "hex"))
const AAGUID_HEX = "07070707070707070707070707070707";

// Minimal credential object satisfying the WebAuthn response shape
const FAKE_REGISTRATION_CREDENTIAL = {
  id: CRED_ID_BASE64URL,
  rawId: CRED_ID_BASE64URL,
  response: {
    clientDataJSON: "e30",     // base64url("{}")
    attestationObject: "e30",  // base64url("{}")
  },
  type: "public-key" as const,
  clientExtensionResults: {},
};

const FAKE_AUTHENTICATION_CREDENTIAL = {
  id: CRED_ID_BASE64URL,
  rawId: CRED_ID_BASE64URL,
  response: {
    clientDataJSON: "e30",
    authenticatorData: "e30",
    signature: "e30",
    userHandle: null,
  },
  type: "public-key" as const,
  clientExtensionResults: {},
};

// ---------------------------------------------------------------------------
// Test factory helper
// ---------------------------------------------------------------------------
function buildAuth(h: Harness) {
  return createAuth(
    {
      rpId: "example.com",
      origins: ["https://app.example.com"],
      session: { lifetimeSeconds: 60 * 60 * 24 * 30 },
      otp: { expirySeconds: 600, maxAttempts: 5 },
      webauthn: { userVerification: "preferred" },
      email: { sendOtp: h.sendOtp },
      users: { findOrCreateByEmail: h.findOrCreateByEmail },
    },
    { db: h.db, deps: h.deps }
  );
}

// ---------------------------------------------------------------------------
// Registration tests
// ---------------------------------------------------------------------------
describe("passkey registration (integration)", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
    vi.resetAllMocks();
  });

  it("stores credential when verifier succeeds", async () => {
    // Mock verifyRegistrationResponse with v10 flat shape
    vi.mocked(simpleWebauthn.verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credentialID: CRED_ID_BASE64URL,
        credentialPublicKey: new Uint8Array([20, 21, 22]),
        counter: 0,
        aaguid: AAGUID_HEX,
      } as any,
    } as any);

    const auth = buildAuth(h);

    // Begin registration to get a valid registrationId + challenge
    const { registrationId } = await auth.beginPasskeyRegistration({
      user: { id: "u_1", email: "matt@example.com" },
    });

    // Finish registration
    const result = await auth.finishPasskeyRegistration({
      registrationId,
      credential: FAKE_REGISTRATION_CREDENTIAL as any,
      deviceName: "Test Device",
    });

    expect(result.passkeyId).toBe(CRED_ID_BASE64URL);

    // Verify the passkey was stored with correct deviceName
    const stored = auth.listPasskeys({ userId: "u_1" });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.deviceName).toBe("Test Device");
    // Credential ID should round-trip correctly
    expect(Buffer.from(stored[0]!.credentialId).toString("base64url")).toBe(CRED_ID_BASE64URL);
  });

  it("rejects when verifier returns verified: false", async () => {
    vi.mocked(simpleWebauthn.verifyRegistrationResponse).mockResolvedValue({
      verified: false,
      registrationInfo: undefined,
    } as any);

    const auth = buildAuth(h);
    const { registrationId } = await auth.beginPasskeyRegistration({
      user: { id: "u_1", email: "matt@example.com" },
    });

    await expect(
      auth.finishPasskeyRegistration({
        registrationId,
        credential: FAKE_REGISTRATION_CREDENTIAL as any,
      })
    ).rejects.toMatchObject({
      code: "invalid_credential",
    });
  });

  it("rejects when verifier throws", async () => {
    vi.mocked(simpleWebauthn.verifyRegistrationResponse).mockRejectedValue(
      new Error("bad attestation")
    );

    const auth = buildAuth(h);
    const { registrationId } = await auth.beginPasskeyRegistration({
      user: { id: "u_1", email: "matt@example.com" },
    });

    await expect(
      auth.finishPasskeyRegistration({
        registrationId,
        credential: FAKE_REGISTRATION_CREDENTIAL as any,
      })
    ).rejects.toMatchObject({
      code: "invalid_credential",
    });
  });
});

// ---------------------------------------------------------------------------
// Sign-in tests
// ---------------------------------------------------------------------------
describe("passkey sign-in (integration)", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
    vi.resetAllMocks();
  });

  /** Inserts a passkey directly into the DB so sign-in tests have something to find. */
  function seedPasskey() {
    h.db
      .prepare(
        `INSERT INTO auth_passkeys
           (credential_id, user_id, public_key, sign_count, created_at)
         VALUES (?, ?, ?, 0, 100)`
      )
      .run(CRED_ID_BYTES, "u_1", new Uint8Array([20, 21, 22]));
  }

  it("returns sessionToken when credential exists and verifier succeeds", async () => {
    seedPasskey();

    vi.mocked(simpleWebauthn.verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
      },
    } as any);

    const auth = buildAuth(h);
    const { signInId } = await auth.beginPasskeySignIn();

    const result = await auth.finishPasskeySignIn({
      signInId,
      credential: FAKE_AUTHENTICATION_CREDENTIAL as any,
    });

    expect(result.sessionToken).toMatch(/^tok_/);
    expect(result.user.id).toBe("u_1");
  });

  it("throws unknown_credential when credential is not registered", async () => {
    // Do NOT seed any passkey — credential lookup should fail
    const auth = buildAuth(h);
    const { signInId } = await auth.beginPasskeySignIn();

    await expect(
      auth.finishPasskeySignIn({
        signInId,
        credential: FAKE_AUTHENTICATION_CREDENTIAL as any,
      })
    ).rejects.toMatchObject({
      code: "unknown_credential",
    });
  });
});
