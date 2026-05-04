import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { csrfMiddleware } from "../src/csrf.js";

function buildApp() {
  const app = new Hono();
  app.use("*", csrfMiddleware({ sessionCookieName: "session", csrfCookieName: "csrf" }));
  app.post("/x", (c) => c.json({ ok: true }));
  app.get("/y", (c) => c.json({ ok: true }));
  return app;
}

describe("csrfMiddleware", () => {
  it("allows GET requests with no cookies", async () => {
    const app = buildApp();
    const res = await app.request("/y");
    expect(res.status).toBe(200);
  });

  it("allows POST when no session cookie is present", async () => {
    const app = buildApp();
    const res = await app.request("/x", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows POST in bearer mode (session header but no session cookie)", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: { Authorization: "Bearer tok_abc" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects POST with session cookie but no X-CSRF-Token", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: { Cookie: "session=tok_abc; csrf=csrf_value" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("csrf_required");
  });

  it("rejects POST with session cookie and mismatching X-CSRF-Token", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        Cookie: "session=tok_abc; csrf=csrf_value",
        "X-CSRF-Token": "wrong",
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("csrf_required");
  });

  it("rejects POST with session cookie and no csrf cookie", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        Cookie: "session=tok_abc",
        "X-CSRF-Token": "anything",
      },
    });
    expect(res.status).toBe(403);
  });

  it("allows POST with matching csrf cookie and X-CSRF-Token header", async () => {
    const app = buildApp();
    const res = await app.request("/x", {
      method: "POST",
      headers: {
        Cookie: "session=tok_abc; csrf=csrf_value",
        "X-CSRF-Token": "csrf_value",
      },
    });
    expect(res.status).toBe(200);
  });

  it("HEAD is exempt", async () => {
    const app = buildApp();
    const res = await app.request("/y", { method: "HEAD" });
    expect(res.status).toBe(200);
  });
});
