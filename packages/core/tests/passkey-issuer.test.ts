// Plumbing proof with the WebAuthn verifier explicitly stubbed. The Go HTTP
// counterpart uses signed assertions against the real verifier.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuth } from "../src/auth.js";
import { AuthError } from "../src/errors.js";
import type { PasskeySignIn } from "../src/types.js";
import { createHarness } from "./setup.js";
import { insertPasskey, getPasskeyByCredentialId } from "../src/storage/passkeys.js";
vi.mock("@simplewebauthn/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@simplewebauthn/server")>(),
  verifyAuthenticationResponse: vi.fn(),
}));
import { verifyAuthenticationResponse } from "@simplewebauthn/server";

const credentialId = new Uint8Array([1,2,3]);
const publicKey = new Uint8Array([4,5,6]);
const credential = {
 id:"AQID", rawId:"AQID", type:"public-key" as const,
 response:{clientDataJSON:"e30", authenticatorData:"e30", signature:"e30", userHandle:null},
 clientExtensionResults:{},
};

describe("host passkey issuer",()=>{
 beforeEach(()=>vi.resetAllMocks());
 for(const mode of ["success","direct","denied","unavailable","failure","empty","wrong-user","invalid","default"]){
  it(mode,async()=>{
   const h=createHarness();
   try {
    insertPasskey(h.db,{credentialId,publicKey,userId:"user",signCount:0,transports:null,aaguid:null,deviceName:null,createdAt:h.clock.now,lastUsedAt:null});
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({verified:mode!=="invalid",authenticationInfo:{newCounter:1}} as any);
    const request=new Request("https://example.com/auth/passkey/sign-in/finish",{method:"POST",headers:{"x-forwarded-for":"untrusted"}});
    const issuer=vi.fn<Parameters<PasskeySignIn>,ReturnType<PasskeySignIn>>(async(input)=>{
     expect(input).toMatchObject({userId:"user",signCount:1,lifetimeSeconds:3600,userAgent:"agent",ip:"untrusted"});
     expect([...input.credentialId]).toEqual([...credentialId]);
     expect([...input.publicKey]).toEqual([...publicKey]);
     expect(input.now()).toBe(h.clock.now);
     expect(input.request).toBe(mode==="direct" ? undefined : request);
     if(mode==="denied") throw new AuthError("invalid_credential","Sign-in not allowed");
     if(mode==="unavailable") throw new AuthError("session_unavailable","Session temporarily unavailable");
     if(mode==="failure") throw new Error("private host failure");
     if(mode==="empty") return {sessionToken:"",user:{id:"user",email:""}};
     return {sessionToken:"host-token",user:{id:mode==="wrong-user"?"different":"user",email:""}};
    });
    const auth=createAuth({rpId:"example.com",origins:["https://example.com"],session:{lifetimeSeconds:3600},email:{sendOtp:h.sendOtp},users:{findOrCreateByEmail:h.findOrCreateByEmail},...(mode==="default"?{}:{passkey:{signIn:issuer}})},{db:h.db,deps:h.deps});
    const start=await auth.beginPasskeySignIn();
    const input={...start,credential,userAgent:"agent",ip:"untrusted",...(mode==="direct"?{}:{request})};
    const result=auth.finishPasskeySignIn(input);
    if(["success","direct","default"].includes(mode)) {
      const value=await result;expect(value.user.id).toBe("user");
      if(mode!=="default")expect(value.sessionToken).toBe("host-token");
    } else if(mode==="denied"||mode==="invalid") await expect(result).rejects.toMatchObject({code:"invalid_credential"});
    else if(mode==="unavailable") await expect(result).rejects.toMatchObject({code:"session_unavailable"});
    else if(mode==="failure") await expect(result).rejects.toThrow("private host failure");
    else await expect(result).rejects.toThrow("passkey issuer returned invalid result");
    expect(issuer).toHaveBeenCalledTimes(mode==="default"||mode==="invalid"?0:1);
    expect(getPasskeyByCredentialId(h.db,credentialId)?.signCount).toBe(mode==="default"?1:0);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get()).toEqual({n:mode==="default"?1:0});
    await expect(auth.finishPasskeySignIn(input)).rejects.toThrow();
    expect(issuer).toHaveBeenCalledTimes(mode==="default"||mode==="invalid"?0:1);
   } finally {h.db.close();}
  });
 }
});
