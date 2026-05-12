import { describe, it, expect } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { runScenario } from "../src/executor.js";
import { parseScenario } from "../src/scenario.js";

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

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

describe("runScenario - happy paths", () => {
  it("runs a single GET step and matches a body shape", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ otpId: "abc", expiresInSeconds: 60 }));
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "ok",
          mode: "bearer",
          steps: [
            {
              request: { method: "GET", path: "/x" },
              expect: {
                status: 200,
                body: {
                  otpId: { type: "string", nonEmpty: true },
                  expiresInSeconds: { type: "number", min: 1 },
                },
              },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(true);
      },
    );
  });

  it("captures variables and uses them in a later step", async () => {
    let secondBody: unknown;
    await withServer(
      async (req, res) => {
        if (req.url === "/start") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ otpId: "id_123" }));
        } else {
          secondBody = await readJsonBody(req);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "capture",
          mode: "bearer",
          steps: [
            {
              request: { method: "POST", path: "/start", body: {} },
              expect: { status: 200 },
              capture: { otpId: "$.body.otpId" },
            },
            {
              request: {
                method: "POST",
                path: "/verify",
                body: { otpId: "{{otpId}}", code: "000000" },
              },
              expect: { status: 200 },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(true);
        expect(secondBody).toEqual({ otpId: "id_123", code: "000000" });
      },
    );
  });

  it("interpolates variables into the request path", async () => {
    let receivedPath: string | undefined;
    await withServer(
      (req, res) => {
        if (req.url === "/start") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: "abc" }));
        } else {
          receivedPath = req.url ?? undefined;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "path-interp",
          mode: "bearer",
          steps: [
            {
              request: { method: "POST", path: "/start", body: {} },
              expect: { status: 200 },
              capture: { id: "$.body.id" },
            },
            {
              request: { method: "DELETE", path: "/things/{{id}}" },
              expect: { status: 200 },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(true);
        expect(receivedPath).toBe("/things/abc");
      },
    );
  });

  it("attaches Bearer token after a sessionToken-issuing response", async () => {
    let secondAuth: string | string[] | undefined;
    let i = 0;
    await withServer(
      (req, res) => {
        i++;
        if (i === 1) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ sessionToken: "tok-xyz" }));
        } else {
          secondAuth = req.headers["authorization"];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "bearer-flow",
          mode: "bearer",
          steps: [
            {
              request: { method: "POST", path: "/login", body: {} },
              expect: { status: 200 },
            },
            {
              request: { method: "GET", path: "/me" },
              expect: { status: 200 },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(true);
        expect(secondAuth).toBe("Bearer tok-xyz");
      },
    );
  });
});

describe("runScenario - failures", () => {
  it("reports status mismatch", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "x",
          mode: "bearer",
          steps: [
            {
              request: { method: "GET", path: "/x" },
              expect: { status: 200 },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.failureStep).toBe(1);
          expect(result.reason).toMatch(/status 200/);
        }
      },
    );
  });

  it("reports body shape mismatch with a path", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ user: { id: 7 } }));
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "x",
          mode: "bearer",
          steps: [
            {
              request: { method: "GET", path: "/me" },
              expect: {
                status: 200,
                body: { user: { id: { type: "string" } } },
              },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toContain("$.body.user.id");
          expect(result.reason).toMatch(/expected string/);
        }
      },
    );
  });

  it("matches an error envelope via the error shortcut", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_otp", message: "wrong" }));
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "x",
          mode: "bearer",
          steps: [
            {
              request: { method: "POST", path: "/verify", body: {} },
              expect: { status: 401, body: { error: "invalid_otp" } },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(true);
      },
    );
  });

  it("fails when capture path is missing from response", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ other: 1 }));
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "x",
          mode: "bearer",
          steps: [
            {
              request: { method: "GET", path: "/x" },
              expect: { status: 200 },
              capture: { otpId: "$.body.otpId" },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toMatch(/missing key/);
        }
      },
    );
  });

  it("fails when an unsubstituted variable is referenced", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "x",
          mode: "bearer",
          steps: [
            {
              request: {
                method: "POST",
                path: "/x",
                body: { otpId: "{{otpId}}" },
              },
              expect: { status: 200 },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toMatch(/unresolved/);
        }
      },
    );
  });
});

describe("runScenario - $webauthn marker", () => {
  it("rejects $webauthn steps when no harness is provided", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "wa",
          mode: "bearer",
          steps: [
            {
              request: {
                method: "POST",
                path: "/finish",
                body: {
                  credential: {
                    $webauthn: "create",
                    options: { challenge: "x" },
                  },
                },
              },
              expect: { status: 200 },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toMatch(/no WebAuthn harness/);
        }
      },
    );
  });

  it("rejects an invalid $webauthn kind", async () => {
    await withServer(
      (_, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      },
      async (baseUrl) => {
        const scenario = parseScenario({
          name: "wa",
          mode: "bearer",
          steps: [
            {
              request: {
                method: "POST",
                path: "/finish",
                body: {
                  credential: {
                    $webauthn: "register",
                    options: {},
                  },
                },
              },
              expect: { status: 200 },
            },
          ],
        });
        const result = await runScenario(scenario, { baseUrl });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toMatch(/invalid \$webauthn kind/);
        }
      },
    );
  });
});
