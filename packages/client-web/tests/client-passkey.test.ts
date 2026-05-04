import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createAuthClient } from "../src/client.js";
import { AuthClientError } from "../src/errors.js";
import { bufferToBase64url } from "../src/webauthn.js";

const BASE = "https://api.example.test/auth";

let lastFinishBody: any = null;

const server = setupServer(
  http.post(`${BASE}/email/verify`, () =>
    HttpResponse.json({ sessionToken: "tok_abc", user: { id: "u_1", email: "m@x.y" } })
  ),
  http.post(`${BASE}/passkey/register/start`, () =>
    HttpResponse.json({
      registrationId: "reg_x",
      options: {
        challenge: "Y2g",
        rp: { id: "example.com", name: "example" },
        user: { id: "dV8x", name: "m@x.y", displayName: "m@x.y" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        excludeCredentials: [],
        timeout: 60000,
      },
    })
  ),
  http.post(`${BASE}/passkey/register/finish`, async ({ request }) => {
    lastFinishBody = await request.json();
    return HttpResponse.json({ passkeyId: "pk_x" });
  }),
  http.post(`${BASE}/passkey/sign-in/start`, () =>
    HttpResponse.json({
      signInId: "auth_x",
      options: {
        challenge: "Y2g",
        rpId: "example.com",
        allowCredentials: [],
        userVerification: "preferred",
        timeout: 60000,
      },
    })
  ),
  http.post(`${BASE}/passkey/sign-in/finish`, async ({ request }) => {
    lastFinishBody = await request.json();
    return HttpResponse.json({
      sessionToken: "tok_pk",
      user: { id: "u_1", email: "" },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  lastFinishBody = null;
  localStorage.clear();
});

function stubCredentials(stub: { create?: any; get?: any }) {
  Object.defineProperty(globalThis.navigator, "credentials", {
    value: stub,
    configurable: true,
  });
}

function fakeAttestation() {
  const rawId = new Uint8Array([1, 2, 3]).buffer;
  return {
    id: bufferToBase64url(rawId),
    rawId,
    type: "public-key",
    response: {
      clientDataJSON: new Uint8Array([0x7b, 0x7d]).buffer,
      attestationObject: new Uint8Array([0x40]).buffer,
    },
    getClientExtensionResults: () => ({}),
  };
}

function fakeAssertion() {
  const rawId = new Uint8Array([4, 5, 6]).buffer;
  return {
    id: bufferToBase64url(rawId),
    rawId,
    type: "public-key",
    response: {
      clientDataJSON: new Uint8Array([0x7b]).buffer,
      authenticatorData: new Uint8Array([0xaa]).buffer,
      signature: new Uint8Array([0xbb]).buffer,
      userHandle: null,
    },
    getClientExtensionResults: () => ({}),
  };
}

describe("registerPasskey", () => {
  it("happy path: start → create → finish", async () => {
    stubCredentials({ create: vi.fn().mockResolvedValue(fakeAttestation()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456"); // get a session
    const out = await client.registerPasskey({ deviceName: "MacBook" });
    expect(out.passkeyId).toBe("pk_x");
    expect(lastFinishBody.registrationId).toBe("reg_x");
    expect(lastFinishBody.deviceName).toBe("MacBook");
    expect(typeof lastFinishBody.credential).toBe("object");
    expect(lastFinishBody.credential.id).toBeDefined();
    expect(lastFinishBody.credential.response.attestationObject).toBeDefined();
  });

  it("registerPasskey without deviceName omits the field", async () => {
    stubCredentials({ create: vi.fn().mockResolvedValue(fakeAttestation()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    await client.registerPasskey();
    expect(lastFinishBody.deviceName).toBeUndefined();
  });

  it("registerPasskey surfaces NotAllowedError as passkey_cancelled", async () => {
    stubCredentials({
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error("denied"), { name: "NotAllowedError" })
      ),
    });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    try {
      await client.registerPasskey();
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_cancelled");
    }
  });
});

describe("signInWithPasskey", () => {
  it("happy path: start → get → finish, persists token", async () => {
    stubCredentials({ get: vi.fn().mockResolvedValue(fakeAssertion()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.signInWithPasskey();
    expect(out.user.id).toBe("u_1");
    expect((out as any).sessionToken).toBeUndefined();
    expect(localStorage.getItem("passkey-sdk:session")).toBe("tok_pk");
    expect(lastFinishBody.signInId).toBe("auth_x");
  });

  it("surfaces invalid_credential", async () => {
    server.use(
      http.post(`${BASE}/passkey/sign-in/finish`, () =>
        HttpResponse.json({ error: "invalid_credential", message: "bad sig" }, { status: 401 })
      )
    );
    stubCredentials({ get: vi.fn().mockResolvedValue(fakeAssertion()) });
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    try {
      await client.signInWithPasskey();
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("invalid_credential");
    }
  });
});
