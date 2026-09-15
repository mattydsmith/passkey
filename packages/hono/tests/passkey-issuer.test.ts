// Adapter contract: the core finish method is stubbed here. Core tests cover
// host issuance; Go's mounted-route test verifies actual signed assertions.
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { createAuth, runMigrations, AuthError } from "@mattsmith/passkey-sdk-core";
import { mountAuthRoutes } from "../src/index.js";

describe("passkey finish adapter",()=>{
 for(const mode of ["success","denied","unavailable","failure"]){
  it(mode,async()=>{
   const db=new Database(":memory:");
   const log=vi.spyOn(console,"error").mockImplementation(()=>{});
   try {
    runMigrations(db);
    const auth=createAuth({rpId:"example.com",origins:["https://example.com"],session:{lifetimeSeconds:3600,cookieName:"session"},email:{sendOtp:async()=>{}},users:{findOrCreateByEmail:async()=>"user"}},{db});
    const finish=vi.spyOn(auth,"finishPasskeySignIn").mockImplementation(async(input)=>{
     expect(input.signInId).toBe("pending");
     expect(input.request?.url).toBe("http://localhost/auth/passkey/sign-in/finish");
     expect(input.request?.bodyUsed).toBe(true);
     expect(input.request?.headers.get("x-forwarded-for")).toBe("untrusted");
     if(mode==="denied")throw new AuthError("invalid_credential","Sign-in not allowed");
     if(mode==="unavailable")throw new AuthError("session_unavailable","Session temporarily unavailable");
     if(mode==="failure")throw new Error("private failure");
     return {sessionToken:"host-token",user:{id:"user",email:""}};
    });
    const app=new Hono();mountAuthRoutes(app,auth);
    const response=await app.request("/auth/passkey/sign-in/finish",{method:"POST",headers:{"content-type":"application/json","user-agent":"agent","x-forwarded-for":"untrusted"},body:JSON.stringify({signInId:"pending",credential:{}})});
    expect(finish).toHaveBeenCalledOnce();
    expect(response.status).toBe(mode==="success"?200:mode==="denied"?401:mode==="unavailable"?503:500);
    if(mode==="success"){
     expect(response.headers.get("set-cookie")).toContain("session=host-token");
     expect(response.headers.get("set-cookie")).toContain("csrf=");
    }else{
     expect(response.headers.get("set-cookie")).toBeNull();
     const body=await response.text();expect(body).not.toContain("host-token");expect(body).not.toContain("private failure");
    }
    if(mode==="unavailable")expect(response.headers.get("retry-after")).toBe("1");
   }finally{db.close();log.mockRestore();}
  });
 }
});
