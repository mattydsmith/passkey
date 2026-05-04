import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decodeCreationOptions,
  decodeRequestOptions,
  encodePublicKeyCredential,
  performRegistration,
  performSignIn,
  bufferToBase64url,
} from "../src/webauthn.js";
import { AuthClientError } from "../src/errors.js";

const sampleCreationOptions = {
  challenge: "Y2g=",  // base64url for "ch" (no padding stripped here for clarity)
  rp: { id: "example.com", name: "example" },
  user: { id: "dV9hYmM", name: "matt@example.com", displayName: "matt@example.com" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  excludeCredentials: [{ type: "public-key", id: "Y3JlZA", transports: ["internal"] }],
  authenticatorSelection: { userVerification: "preferred" },
  timeout: 60000,
};

const sampleRequestOptions = {
  challenge: "Y2g",
  rpId: "example.com",
  allowCredentials: [],
  userVerification: "preferred",
  timeout: 60000,
};

describe("decodeCreationOptions", () => {
  it("converts base64url challenge and user.id to ArrayBuffers", () => {
    const decoded = decodeCreationOptions(sampleCreationOptions);
    expect(decoded.challenge).toBeInstanceOf(ArrayBuffer);
    expect(decoded.user.id).toBeInstanceOf(ArrayBuffer);
    expect(decoded.rp.id).toBe("example.com");
    expect(decoded.user.name).toBe("matt@example.com");
  });

  it("converts excludeCredentials[].id", () => {
    const decoded = decodeCreationOptions(sampleCreationOptions);
    expect(decoded.excludeCredentials).toHaveLength(1);
    expect(decoded.excludeCredentials![0].id).toBeInstanceOf(ArrayBuffer);
    expect(decoded.excludeCredentials![0].transports).toEqual(["internal"]);
  });
});

describe("decodeRequestOptions", () => {
  it("converts challenge and allowCredentials[].id", () => {
    const opts = {
      ...sampleRequestOptions,
      allowCredentials: [{ type: "public-key", id: "Y3JlZA" }],
    };
    const decoded = decodeRequestOptions(opts);
    expect(decoded.challenge).toBeInstanceOf(ArrayBuffer);
    expect(decoded.allowCredentials![0].id).toBeInstanceOf(ArrayBuffer);
  });

  it("handles empty allowCredentials", () => {
    const decoded = decodeRequestOptions(sampleRequestOptions);
    expect(decoded.allowCredentials).toEqual([]);
  });
});

describe("encodePublicKeyCredential", () => {
  function makeAttestationCredential() {
    const rawId = new Uint8Array([1, 2, 3]).buffer;
    const clientDataJSON = new Uint8Array([0x7b, 0x7d]).buffer; // "{}"
    const attestationObject = new Uint8Array([0x40, 0x40]).buffer;
    return {
      id: bufferToBase64url(rawId),
      rawId,
      type: "public-key",
      response: {
        clientDataJSON,
        attestationObject,
      } as AuthenticatorAttestationResponse,
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
  }

  function makeAssertionCredential() {
    const rawId = new Uint8Array([4, 5, 6]).buffer;
    const clientDataJSON = new Uint8Array([0x7b, 0x7d]).buffer;
    const authenticatorData = new Uint8Array([0xaa]).buffer;
    const signature = new Uint8Array([0xbb]).buffer;
    const userHandle = new Uint8Array([0xcc]).buffer;
    return {
      id: bufferToBase64url(rawId),
      rawId,
      type: "public-key",
      response: {
        clientDataJSON,
        authenticatorData,
        signature,
        userHandle,
      } as AuthenticatorAssertionResponse,
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
  }

  it("encodes an attestation credential to JSON", () => {
    const cred = makeAttestationCredential();
    const out = encodePublicKeyCredential(cred);
    expect(out.id).toBe(bufferToBase64url(new Uint8Array([1, 2, 3]).buffer));
    expect(out.rawId).toBe(out.id);
    expect(out.type).toBe("public-key");
    expect(out.response.clientDataJSON).toBe(bufferToBase64url(new Uint8Array([0x7b, 0x7d]).buffer));
    expect(out.response.attestationObject).toBe(bufferToBase64url(new Uint8Array([0x40, 0x40]).buffer));
    expect(out.response.authenticatorData).toBeUndefined();
  });

  it("encodes an assertion credential to JSON", () => {
    const cred = makeAssertionCredential();
    const out = encodePublicKeyCredential(cred);
    expect(out.response.attestationObject).toBeUndefined();
    expect(out.response.authenticatorData).toBe(bufferToBase64url(new Uint8Array([0xaa]).buffer));
    expect(out.response.signature).toBe(bufferToBase64url(new Uint8Array([0xbb]).buffer));
    expect(out.response.userHandle).toBe(bufferToBase64url(new Uint8Array([0xcc]).buffer));
  });
});

describe("performRegistration / performSignIn", () => {
  let originalCredentials: any;

  beforeEach(() => {
    originalCredentials = (globalThis as any).navigator?.credentials;
  });

  afterEach(() => {
    if (originalCredentials !== undefined) {
      Object.defineProperty(globalThis.navigator, "credentials", {
        value: originalCredentials,
        configurable: true,
      });
    }
  });

  function stubCredentials(stub: { create?: any; get?: any }) {
    Object.defineProperty(globalThis.navigator, "credentials", {
      value: stub,
      configurable: true,
    });
  }

  it("performRegistration calls navigator.credentials.create with decoded options", async () => {
    const fakeCred = {
      id: "abc",
      rawId: new Uint8Array([1]).buffer,
      type: "public-key",
      response: {
        clientDataJSON: new Uint8Array([0x7b, 0x7d]).buffer,
        attestationObject: new Uint8Array([0x40]).buffer,
      },
      getClientExtensionResults: () => ({}),
    };
    const create = vi.fn().mockResolvedValue(fakeCred);
    stubCredentials({ create });
    const out = await performRegistration(sampleCreationOptions);
    expect(create).toHaveBeenCalledOnce();
    const arg = create.mock.calls[0][0];
    expect(arg.publicKey.challenge).toBeInstanceOf(ArrayBuffer);
    expect(out.id).toBe("abc");
  });

  it("maps NotAllowedError to passkey_cancelled", async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" })
    );
    stubCredentials({ create });
    await expect(performRegistration(sampleCreationOptions))
      .rejects.toThrowError(AuthClientError);
    try {
      await performRegistration(sampleCreationOptions);
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_cancelled");
    }
  });

  it("maps AbortError to passkey_cancelled", async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );
    stubCredentials({ create });
    try {
      await performRegistration(sampleCreationOptions);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_cancelled");
    }
  });

  it("maps unknown errors to passkey_failed", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    stubCredentials({ create });
    try {
      await performRegistration(sampleCreationOptions);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("passkey_failed");
    }
  });

  it("throws unsupported when navigator.credentials is missing", async () => {
    Object.defineProperty(globalThis.navigator, "credentials", {
      value: undefined,
      configurable: true,
    });
    try {
      await performRegistration(sampleCreationOptions);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as AuthClientError).code).toBe("unsupported");
    }
  });

  it("performSignIn calls navigator.credentials.get and encodes assertion", async () => {
    const fakeAssertion = {
      id: "asn",
      rawId: new Uint8Array([2]).buffer,
      type: "public-key",
      response: {
        clientDataJSON: new Uint8Array([0x7b]).buffer,
        authenticatorData: new Uint8Array([0xaa]).buffer,
        signature: new Uint8Array([0xbb]).buffer,
        userHandle: null,
      },
      getClientExtensionResults: () => ({}),
    };
    const get = vi.fn().mockResolvedValue(fakeAssertion);
    stubCredentials({ get });
    const out = await performSignIn(sampleRequestOptions);
    expect(get).toHaveBeenCalledOnce();
    expect(out.id).toBe("asn");
    expect(out.response.signature).toBeDefined();
    expect(out.response.userHandle).toBeUndefined();
  });
});
