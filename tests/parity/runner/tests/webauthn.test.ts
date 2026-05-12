import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { WebAuthnHarness, closeBrowser } from "../src/webauthn.js";

function randomB64u(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

function decodeClientDataJson(b64u: string): { type: string; challenge: string; origin: string } {
  const padded = b64u
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(b64u.length + ((4 - (b64u.length % 4)) % 4), "=");
  return JSON.parse(Buffer.from(padded, "base64").toString());
}

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((_, res) => {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address() as AddressInfo;
  origin = `http://localhost:${addr.port}`;
});

afterAll(async () => {
  await closeBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("WebAuthnHarness", () => {
  it("performs a registration ceremony with a virtual authenticator", async () => {
    const harness = await WebAuthnHarness.create({ origin });
    try {
      const challenge = randomB64u();
      const cred = await harness.ceremony("create", {
        challenge,
        rp: { id: "localhost", name: "Parity Test" },
        user: {
          id: randomB64u(16),
          name: "test@example.com",
          displayName: "Test User",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        timeout: 60_000,
        attestation: "none",
      });

      expect(cred.type).toBe("public-key");
      expect(typeof cred.id).toBe("string");
      expect(cred.id.length).toBeGreaterThan(0);
      expect(typeof cred.rawId).toBe("string");
      expect(typeof cred.response.clientDataJSON).toBe("string");
      expect(typeof cred.response.attestationObject).toBe("string");

      const cdj = decodeClientDataJson(cred.response.clientDataJSON);
      expect(cdj.type).toBe("webauthn.create");
      expect(cdj.challenge).toBe(challenge);
      expect(cdj.origin).toBe(origin);
    } finally {
      await harness.destroy();
    }
  }, 60_000);

  it("performs a sign-in ceremony against a previously registered credential", async () => {
    const harness = await WebAuthnHarness.create({ origin });
    try {
      const registerChallenge = randomB64u();
      const created = await harness.ceremony("create", {
        challenge: registerChallenge,
        rp: { id: "localhost", name: "Parity Test" },
        user: {
          id: randomB64u(16),
          name: "test",
          displayName: "Test",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      });

      const signInChallenge = randomB64u();
      const assertion = await harness.ceremony("get", {
        challenge: signInChallenge,
        rpId: "localhost",
        allowCredentials: [{ type: "public-key", id: created.rawId }],
      });

      expect(assertion.id).toBe(created.id);
      expect(assertion.type).toBe("public-key");
      expect(typeof assertion.response.signature).toBe("string");
      expect(typeof assertion.response.authenticatorData).toBe("string");

      const cdj = decodeClientDataJson(assertion.response.clientDataJSON);
      expect(cdj.type).toBe("webauthn.get");
      expect(cdj.challenge).toBe(signInChallenge);
    } finally {
      await harness.destroy();
    }
  }, 60_000);

  it("isolates credentials between harness instances", async () => {
    const a = await WebAuthnHarness.create({ origin });
    const b = await WebAuthnHarness.create({ origin });
    try {
      const createOpts = {
        challenge: randomB64u(),
        rp: { id: "localhost", name: "Parity Test" },
        user: {
          id: randomB64u(16),
          name: "test",
          displayName: "Test",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      };
      const aCred = await a.ceremony("create", createOpts);

      await expect(
        b.ceremony("get", {
          challenge: randomB64u(),
          rpId: "localhost",
          allowCredentials: [{ type: "public-key", id: aCred.rawId }],
        }),
      ).rejects.toThrow();
    } finally {
      await a.destroy();
      await b.destroy();
    }
  }, 60_000);
});
