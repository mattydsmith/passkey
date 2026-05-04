import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createAuthClient } from "../src/client.js";
import { AuthClientError } from "../src/errors.js";

const BASE = "https://api.example.test/auth";

let lastUrl: string | null = null;

const server = setupServer(
  http.get(`${BASE}/sessions`, () =>
    HttpResponse.json({
      sessions: [
        { createdAt: 100, expiresAt: 200, lastSeenAt: 150, userAgent: "ua", ip: "1.2.3.4" },
      ],
    })
  ),
  http.get(`${BASE}/passkeys`, () =>
    HttpResponse.json({
      passkeys: [
        {
          id: "pk_1",
          deviceName: "MacBook",
          createdAt: 100,
          lastUsedAt: 200,
          transports: ["internal"],
        },
      ],
    })
  ),
  http.delete(`${BASE}/passkeys/:id`, ({ request }) => {
    lastUrl = request.url;
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  lastUrl = null;
  localStorage.clear();
});

describe("listSessions", () => {
  it("returns the sessions array", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.listSessions();
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0].userAgent).toBe("ua");
  });
});

describe("listPasskeys", () => {
  it("returns the passkeys array", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    const out = await client.listPasskeys();
    expect(out.passkeys[0].id).toBe("pk_1");
    expect(out.passkeys[0].transports).toEqual(["internal"]);
  });
});

describe("deletePasskey", () => {
  it("DELETE /auth/passkeys/:id", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.deletePasskey("pk_1");
    expect(lastUrl).toBe(`${BASE}/passkeys/pk_1`);
  });

  it("URL-encodes the id", async () => {
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    await client.deletePasskey("a/b+c");
    // %2F %2B %3D etc; just assert the raw chars don't appear unencoded
    expect(lastUrl).not.toContain("a/b+c");
    expect(lastUrl).toContain("a%2Fb%2Bc");
  });

  it("surfaces unknown_credential as AuthClientError", async () => {
    server.use(
      http.delete(`${BASE}/passkeys/:id`, () =>
        HttpResponse.json({ error: "unknown_credential", message: "Not yours" }, { status: 404 })
      )
    );
    const client = createAuthClient({ baseUrl: BASE, storage: "header" });
    try {
      await client.deletePasskey("pk_other");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("unknown_credential");
    }
  });
});
