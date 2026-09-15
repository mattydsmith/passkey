import { it, expect } from "vitest";
import { createAuth } from "../src/auth.js";
import { createHarness } from "./setup.js";

it("preserves original start input and never invents request metadata for direct calls", async () => {
  const h = createHarness();
  const originals: string[] = [];
  const requests: (Request | undefined)[] = [];
  const auth = createAuth({
    rpId: "example.com", origins: ["https://example.com"],
    session: { lifetimeSeconds: 3600 },
    email: {
      sendOtp: async () => { throw new Error("unexpected default sender"); },
      start: async (input) => {
        originals.push(input.originalEmail);
        expect(input.email).toBe(input.originalEmail.trim().toLowerCase());
        requests.push(input.request);
        return { otpId: "opaque" };
      },
      signIn: async (input) => {
        requests.push(input.request);
        return { sessionToken: "committed", user: { id: "host", email: "host@example.com" } };
      },
    },
    users: { findOrCreateByEmail: async () => { throw new Error("unexpected default resolver"); } },
  }, { db: h.db, deps: h.deps });
  try {
    for (const email of [" USER@EXAMPLE.COM ", " Kate@example.com ", " İan@example.com "]) {
      await auth.startEmailOtp({ email });
    }
    expect(originals).toEqual([" USER@EXAMPLE.COM ", " Kate@example.com ", " İan@example.com "]);
    await auth.verifyEmailOtp({ otpId: "opaque", code: "123456" });
    expect(requests).toEqual([undefined, undefined, undefined, undefined]);
    const request = new Request("https://example.com/auth/email/verify", { headers: { "x-forwarded-for": "untrusted" } });
    await auth.verifyEmailOtp({ otpId: "opaque", code: "123456", request });
    expect(requests[4]).toBe(request);
    expect(h.sentOtps).toEqual([]);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get()).toEqual({ n: 0 });
  } finally { h.db.close(); }
});
