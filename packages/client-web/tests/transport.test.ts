import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createTransport } from "../src/transport.js";
import { createSessionStorage } from "../src/storage.js";
import { AuthClientError } from "../src/errors.js";

const BASE = "https://api.example.test/auth";

let lastRequest: { method: string; url: string; headers: Record<string, string>; body: any } | null = null;

const server = setupServer(
  http.post(`${BASE}/email/start`, async ({ request }) => {
    lastRequest = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await request.json(),
    };
    return HttpResponse.json({ otpId: "otp_x", expiresInSeconds: 600 });
  }),
  http.get(`${BASE}/me`, ({ request }) => {
    lastRequest = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: null,
    };
    return HttpResponse.json({ user: { id: "u_1", email: "matt@example.com" } });
  }),
  http.post(`${BASE}/sign-out`, ({ request }) => {
    lastRequest = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: null,
    };
    return HttpResponse.json({ ok: true });
  }),
  http.post(`${BASE}/email/verify`, () =>
    HttpResponse.json({ error: "invalid_otp", message: "wrong" }, { status: 401 })
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  lastRequest = null;
  localStorage.clear();
  // jsdom document.cookie isolation
  for (const c of document.cookie.split(";")) {
    const k = c.split("=")[0]?.trim();
    if (k) document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
});

describe("transport — request shape", () => {
  it("composes baseUrl with the path", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    await t.request("/email/start", { method: "POST", body: { email: "a@b.c" } });
    expect(lastRequest?.url).toBe(`${BASE}/email/start`);
  });

  it("sets content-type on JSON bodies", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    await t.request("/email/start", { method: "POST", body: { email: "a@b.c" } });
    expect(lastRequest?.headers["content-type"]).toMatch(/application\/json/);
  });

  it("parses JSON response on 2xx", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    const res = await t.request<{ otpId: string }>("/email/start", {
      method: "POST",
      body: { email: "a@b.c" },
    });
    expect(res.otpId).toBe("otp_x");
  });
});

describe("transport — header mode", () => {
  it("attaches Authorization: Bearer when token saved", async () => {
    const storage = createSessionStorage("header");
    storage.save("tok_abc");
    const t = createTransport({ baseUrl: BASE, storage });
    await t.request("/me", { method: "GET" });
    expect(lastRequest?.headers["authorization"]).toBe("Bearer tok_abc");
  });

  it("does not add Authorization when no token saved", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    await t.request("/me", { method: "GET" });
    expect(lastRequest?.headers["authorization"]).toBeUndefined();
  });
});

describe("transport — cookie mode CSRF", () => {
  it("adds X-CSRF-Token when csrf cookie is present and method is non-GET", async () => {
    document.cookie = "csrf=csrf_value; path=/";
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
    });
    await t.request("/sign-out", { method: "POST" });
    expect(lastRequest?.headers["x-csrf-token"]).toBe("csrf_value");
  });

  it("uses configured csrfCookieName", async () => {
    document.cookie = "my_csrf=abc123; path=/";
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
      csrfCookieName: "my_csrf",
    });
    await t.request("/sign-out", { method: "POST" });
    expect(lastRequest?.headers["x-csrf-token"]).toBe("abc123");
  });

  it("does not add X-CSRF-Token on GET", async () => {
    document.cookie = "csrf=csrf_value; path=/";
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
    });
    await t.request("/me", { method: "GET" });
    expect(lastRequest?.headers["x-csrf-token"]).toBeUndefined();
  });

  it("omits X-CSRF-Token when csrf cookie is absent (lets server return 403)", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("cookie"),
    });
    await t.request("/sign-out", { method: "POST" });
    expect(lastRequest?.headers["x-csrf-token"]).toBeUndefined();
  });
});

describe("transport — error mapping", () => {
  it("non-2xx with known error code throws AuthClientError with that code", async () => {
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    try {
      await t.request("/email/verify", {
        method: "POST",
        body: { otpId: "x", code: "000000" },
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthClientError);
      expect((e as AuthClientError).code).toBe("invalid_otp");
      expect((e as AuthClientError).status).toBe(401);
    }
  });

  it("network/non-JSON failure throws AuthClientError network", async () => {
    server.use(
      http.post(`${BASE}/email/start`, () => HttpResponse.error()),
    );
    const t = createTransport({
      baseUrl: BASE,
      storage: createSessionStorage("header"),
    });
    try {
      await t.request("/email/start", { method: "POST", body: { email: "a@b.c" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthClientError);
      expect((e as AuthClientError).code).toBe("network");
    }
  });
});
