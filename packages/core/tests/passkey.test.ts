import { describe, it, expect, beforeEach, vi } from "vitest";
import { beginPasskeyRegistration } from "../src/flows/passkey-register.js";
import { beginPasskeySignIn } from "../src/flows/passkey-signin.js";
import { createHarness, type Harness } from "./setup.js";

describe("beginPasskeyRegistration", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("returns options with rp, user, challenge, pubKeyCredParams", async () => {
    const result = await beginPasskeyRegistration({
      db: h.db,
      deps: h.deps,
      userId: "u_1",
      userEmail: "matt@example.com",
      rpId: "example.com",
      rpName: "Example",
      userVerification: "preferred",
    });

    expect(result.options.rp.id).toBe("example.com");
    expect(result.options.rp.name).toBe("Example");
    expect(result.options.user.name).toBe("matt@example.com");
    expect(typeof result.options.challenge).toBe("string");
    expect(result.options.challenge.length).toBeGreaterThan(0);
    expect(Array.isArray(result.options.pubKeyCredParams)).toBe(true);
    expect(result.options.pubKeyCredParams.length).toBeGreaterThan(0);
  });

  it("excludes already-registered credentials of the same user", async () => {
    h.db.prepare(
      "INSERT INTO auth_passkeys (credential_id, user_id, public_key, sign_count, created_at) VALUES (?, ?, ?, 0, 100)"
    ).run(new Uint8Array([1, 2, 3]), "u_1", new Uint8Array([9]));

    const result = await beginPasskeyRegistration({
      db: h.db, deps: h.deps,
      userId: "u_1", userEmail: "matt@example.com",
      rpId: "example.com", rpName: "Example",
      userVerification: "preferred",
    });
    expect(result.options.excludeCredentials?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns a registrationId that can later be redeemed by finish", async () => {
    const result = await beginPasskeyRegistration({
      db: h.db, deps: h.deps,
      userId: "u_1", userEmail: "matt@example.com",
      rpId: "example.com", rpName: "Example",
      userVerification: "preferred",
    });
    expect(result.registrationId).toMatch(/^reg_/);
  });
});

describe("beginPasskeySignIn", () => {
  let h: Harness;
  beforeEach(() => { h = createHarness(); });

  it("returns options with rpId, challenge, empty allowCredentials", async () => {
    const result = await beginPasskeySignIn({
      db: h.db, deps: h.deps,
      rpId: "example.com",
      userVerification: "preferred",
    });
    expect(result.options.rpId).toBe("example.com");
    expect(typeof result.options.challenge).toBe("string");
    expect(result.options.allowCredentials).toEqual([]);
    expect(result.signInId).toMatch(/^auth_/);
  });
});
