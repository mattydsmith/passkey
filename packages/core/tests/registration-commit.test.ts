import { createHash } from "node:crypto";
import { createSession } from "../src/session.js";
import { insertPasskey } from "../src/storage/passkeys.js";
import type { PasskeyRegistrationCommit } from "../src/types.js";
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
import { describe, it, expect, vi } from "vitest";
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

// ---------------------------------------------------------------------------
// Test factory helper
// ---------------------------------------------------------------------------
function buildAuth(h: Harness, registrationCommit: PasskeyRegistrationCommit) {
  return createAuth(
    {
      passkey: {registrationCommit},
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


describe("host registration commit", () => {
 for (const mode of ["success","denied","unavailable","failure","new-session","invalid-attestation"]) {
  it(mode,async()=> {
   const h=createHarness(); vi.resetAllMocks();
   try {
    vi.mocked(simpleWebauthn.verifyRegistrationResponse).mockResolvedValue({verified: mode!=="invalid-attestation",registrationInfo:{credentialID:CRED_ID_BASE64URL,credentialPublicKey:new Uint8Array([20,21,22]),counter:0,aaguid:AAGUID_HEX}} as any);
    let calls=0;
    let received: Parameters<PasskeyRegistrationCommit>[0] | undefined;
    const initial=await createSession({db:h.db,deps:h.deps,userId:"owner",lifetimeSeconds:3600,userAgent:null,ip:null});
    const request=(token:string)=>new Request("https://example.com/auth/passkey/register/finish",{method:"POST",headers:{authorization:`Bearer ${token}`}});
    const original=request(initial.sessionToken);
    const auth=buildAuth(h,async input=>{
     calls++;
     received=input;
     if(mode==="denied")throw new AuthError("invalid_credential","Denied");
     if(mode==="unavailable")throw new AuthError("session_unavailable","Unavailable");
     if(mode==="failure")throw new Error("private persistence detail");
     insertPasskey(h.db,input.credential);
    });
    const {registrationId}=await auth.beginPasskeyRegistration({user:{id:"owner",email:"owner@example.com"},request:original});
    let finishing=original;
    if(mode==="new-session") {
     const renewed=await createSession({db:h.db,deps:h.deps,userId:"owner",lifetimeSeconds:3600,userAgent:null,ip:null});
     finishing=request(renewed.sessionToken);
    }
    const args={userId:"owner",registrationId,credential:FAKE_REGISTRATION_CREDENTIAL,request:finishing};
    if(mode==="success") await expect(auth.finishPasskeyRegistration(args)).resolves.toEqual({passkeyId:CRED_ID_BASE64URL});
    else if(mode==="failure") await expect(auth.finishPasskeyRegistration(args)).rejects.toThrow("private persistence detail");
    else await expect(auth.finishPasskeyRegistration(args)).rejects.toMatchObject({code: mode==="unavailable"?"session_unavailable":"invalid_credential"});
    const expectedCalls=mode==="new-session"||mode==="invalid-attestation"?0:1;
    expect(calls).toBe(expectedCalls);
    if (expectedCalls) {
     expect(received!.credential.userId).toBe("owner");
     expect(Array.from(received!.credential.credentialId)).toEqual(Array.from(CRED_ID_BYTES));
     expect(received!.sessionHash).toEqual(new Uint8Array(createHash("sha256").update(initial.sessionToken).digest()));
     expect(received!.now()).toBe(h.clock.now);
     expect(received!.request).toBe(original);
    }

    expect(auth.listPasskeys({userId:"owner"})).toHaveLength(mode==="success"?1:0);
    await expect(auth.finishPasskeyRegistration(args)).rejects.toThrow();
    expect(calls).toBe(expectedCalls);
    await expect(auth.beginPasskeyRegistration({user:{id:"owner",email:"owner@example.com"}})).rejects.toMatchObject({code:"unauthenticated"});
   }finally{h.db.close()}
  });
 }
});
