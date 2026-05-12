import { describe, it, expect } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { AddressInfo } from "node:net";
import { Transport } from "../src/transport.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

async function withServer<T>(
  handler: Handler,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      if (raw.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

describe("Transport - basics", () => {
  it("returns status, headers, and parsed JSON body", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ hello: "world" }));
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        const r = await t.execute({ method: "GET", path: "/" });
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ hello: "world" });
        expect(r.headers["content-type"]).toContain("application/json");
      },
    );
  });

  it("returns undefined body when response is empty", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(204);
        res.end();
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        const r = await t.execute({ method: "GET", path: "/" });
        expect(r.status).toBe(204);
        expect(r.body).toBeUndefined();
      },
    );
  });

  it("sends JSON body with Content-Type for non-GET methods", async () => {
    let receivedBody: unknown;
    let receivedCT: string | string[] | undefined;
    await withServer(
      async (req, res) => {
        receivedCT = req.headers["content-type"];
        receivedBody = await readJsonBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        await t.execute({
          method: "POST",
          path: "/x",
          body: { a: 1 },
        });
        expect(receivedCT).toBe("application/json");
        expect(receivedBody).toEqual({ a: 1 });
      },
    );
  });

  it("strips trailing slash from baseUrl", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl: `${baseUrl}/`, mode: "bearer" });
        const r = await t.execute({ method: "GET", path: "/x" });
        expect(r.status).toBe(200);
      },
    );
  });
});

describe("Transport - bearer mode", () => {
  it("does not send Authorization before any sessionToken capture", async () => {
    let receivedAuth: string | string[] | undefined;
    await withServer(
      (req, res) => {
        receivedAuth = req.headers["authorization"];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        await t.execute({ method: "GET", path: "/me" });
        expect(receivedAuth).toBeUndefined();
      },
    );
  });

  it("captures sessionToken from response body and sends it on subsequent calls", async () => {
    let lastAuth: string | string[] | undefined;
    await withServer(
      (req, res) => {
        lastAuth = req.headers["authorization"];
        if (req.url === "/login") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ sessionToken: "tok_abc", user: {} }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ user: {} }));
        }
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        await t.execute({ method: "POST", path: "/login", body: {} });
        expect(t.getSessionToken()).toBe("tok_abc");
        await t.execute({ method: "GET", path: "/me" });
        expect(lastAuth).toBe("Bearer tok_abc");
      },
    );
  });

  it("does not capture an empty or non-string sessionToken", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessionToken: "", other: 7 }));
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        await t.execute({ method: "POST", path: "/x", body: {} });
        expect(t.getSessionToken()).toBeNull();
      },
    );
  });

  it("updates sessionToken if a later response includes a new one", async () => {
    const tokens = ["tok_first", "tok_second"];
    let i = 0;
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessionToken: tokens[i++] }));
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        await t.execute({ method: "POST", path: "/a", body: {} });
        expect(t.getSessionToken()).toBe("tok_first");
        await t.execute({ method: "POST", path: "/b", body: {} });
        expect(t.getSessionToken()).toBe("tok_second");
      },
    );
  });

  it("bearer mode does not parse Set-Cookie into a jar", async () => {
    let cookieHeader: string | string[] | undefined;
    await withServer(
      (req, res) => {
        cookieHeader = req.headers["cookie"];
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": "session=abc; Path=/",
        });
        res.end("{}");
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "bearer" });
        await t.execute({ method: "GET", path: "/a" });
        await t.execute({ method: "GET", path: "/b" });
        expect(cookieHeader).toBeUndefined();
      },
    );
  });
});

describe("Transport - cookie mode", () => {
  it("persists cookies across requests", async () => {
    let secondCookie: string | string[] | undefined;
    let i = 0;
    await withServer(
      (req, res) => {
        i++;
        if (i === 1) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": "session=abc123; Path=/",
          });
          res.end("{}");
        } else {
          secondCookie = req.headers["cookie"];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "cookie" });
        await t.execute({ method: "POST", path: "/login", body: {} });
        await t.execute({ method: "GET", path: "/me" });
        expect(secondCookie).toContain("session=abc123");
      },
    );
  });

  it("echoes X-CSRF-Token on non-GET requests once csrf cookie is set", async () => {
    let csrfHeader: string | string[] | undefined;
    let i = 0;
    await withServer(
      (req, res) => {
        i++;
        if (i === 1) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": [
              "session=sess1; Path=/",
              "csrf=csrf-token-xyz; Path=/",
            ],
          });
          res.end("{}");
        } else {
          csrfHeader = req.headers["x-csrf-token"];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "cookie" });
        await t.execute({ method: "POST", path: "/login", body: {} });
        await t.execute({ method: "POST", path: "/something", body: {} });
        expect(csrfHeader).toBe("csrf-token-xyz");
      },
    );
  });

  it("does not echo X-CSRF-Token on GET requests", async () => {
    let csrfHeader: string | string[] | undefined;
    let i = 0;
    await withServer(
      (req, res) => {
        i++;
        if (i === 1) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": ["csrf=csrf-xyz; Path=/"],
          });
          res.end("{}");
        } else {
          csrfHeader = req.headers["x-csrf-token"];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "cookie" });
        await t.execute({ method: "POST", path: "/login", body: {} });
        await t.execute({ method: "GET", path: "/me" });
        expect(csrfHeader).toBeUndefined();
      },
    );
  });

  it("respects omitCsrf flag to allow negative-path vectors", async () => {
    let csrfHeader: string | string[] | undefined;
    let i = 0;
    await withServer(
      (req, res) => {
        i++;
        if (i === 1) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": ["csrf=csrf-xyz; Path=/"],
          });
          res.end("{}");
        } else {
          csrfHeader = req.headers["x-csrf-token"];
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "csrf_required" }));
        }
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "cookie" });
        await t.execute({ method: "POST", path: "/login", body: {} });
        const r = await t.execute({
          method: "POST",
          path: "/protected",
          body: {},
          omitCsrf: true,
        });
        expect(csrfHeader).toBeUndefined();
        expect(r.status).toBe(403);
      },
    );
  });

  it("does not send X-CSRF-Token before any csrf cookie exists", async () => {
    let csrfHeader: string | string[] | undefined;
    await withServer(
      (req, res) => {
        csrfHeader = req.headers["x-csrf-token"];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "cookie" });
        await t.execute({ method: "POST", path: "/auth/email/start", body: {} });
        expect(csrfHeader).toBeUndefined();
      },
    );
  });

  it("clears cookies on expired Set-Cookie (sign-out flow)", async () => {
    let lastCookie: string | string[] | undefined;
    let i = 0;
    await withServer(
      (req, res) => {
        i++;
        if (i === 1) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": ["session=tok; Path=/"],
          });
          res.end("{}");
        } else if (i === 2) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": [
              "session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
            ],
          });
          res.end("{}");
        } else {
          lastCookie = req.headers["cookie"];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
      },
      async (baseUrl) => {
        const t = new Transport({ baseUrl, mode: "cookie" });
        await t.execute({ method: "POST", path: "/login", body: {} });
        await t.execute({ method: "POST", path: "/sign-out", body: {} });
        await t.execute({ method: "GET", path: "/me" });
        expect(lastCookie ?? "").not.toContain("session=tok");
      },
    );
  });
});
