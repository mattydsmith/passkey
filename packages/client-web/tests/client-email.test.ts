import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createAuthClient } from "../src/client.js";
import { AuthClientError } from "../src/errors.js";

const BASE = "https://api.example.test/auth";

let lastBody: any = null;
let lastHeaders: Record<string, string> = {};

const server = setupServer(
  http.post(`${BASE}/email/start`, async ({ request }) => {
    lastBody = await request.json();
    return HttpResponse.json({ otpId: "otp_x", expiresInSeconds: 600 });
  }),
  http.post(`${BASE}/email/verify`, async ({ request }) => {
    lastBody = await request.json();
    lastHeaders = Object.fromEntries(request.headers);
    return HttpResponse.json({
      sessionToken: "tok_abc",
      user: { id: "u_1", email: "matt@example.com" },
    });
  }),
  http.get(`${BASE}/me`, ({ request }) => {
    lastHeaders = Object.fromEntries(request.headers);
    return HttpResponse.json({ user: { id: "u_1", email: "matt@example.com" } });
  }),
  http.post(`${BASE}/sign-out`, ({ request }) => {
    lastHeaders = Object.fromEntries(request.headers);
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(() => {
  lastBody = null;
  lastHeaders = {};
  localStorage.clear();
});

describe("createAuthClient — email flow (header mode)", () => {
  it("startEmailSignIn returns otpId + expiresInSeconds", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.startEmailSignIn("matt@example.com");
    expect(out.otpId).toBe("otp_x");
    expect(out.expiresInSeconds).toBe(600);
    expect(lastBody.email).toBe("matt@example.com");
  });

  it("verifyEmailOtp returns { user } and persists token in header mode", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.verifyEmailOtp("otp_x", "123456");
    expect(out.user.id).toBe("u_1");
    expect((out as any).sessionToken).toBeUndefined();
    expect(localStorage.getItem("passkey-sdk:session")).toBe("tok_abc");
  });

  it("getCurrentUser uses persisted token", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    const me = await client.getCurrentUser();
    expect(me.user.id).toBe("u_1");
    expect(lastHeaders["authorization"]).toBe("Bearer tok_abc");
  });

  it("signOut clears the persisted token in header mode", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.verifyEmailOtp("otp_x", "123456");
    expect(localStorage.getItem("passkey-sdk:session")).toBe("tok_abc");
    await client.signOut();
    expect(localStorage.getItem("passkey-sdk:session")).toBeNull();
  });

  it("verifyEmailOtp surfaces invalid_otp", async () => {
    server.use(
      http.post(`${BASE}/email/verify`, () =>
        HttpResponse.json({ error: "invalid_otp", message: "wrong" }, { status: 401 })
      )
    );
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    try {
      await client.verifyEmailOtp("otp_x", "000000");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("invalid_otp");
    }
  });
});

describe("createAuthClient — email flow (cookie mode)", () => {
  it("verifyEmailOtp does not persist token in cookie mode", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "cookie" });
    const out = await client.verifyEmailOtp("otp_x", "123456");
    expect(out.user.id).toBe("u_1");
    expect(localStorage.getItem("passkey-sdk:session")).toBeNull();
  });
});
