import { describe, it, expect } from "vitest";
import { defaultDeps, type Deps } from "../src/deps.js";

describe("defaultDeps", () => {
  it("now returns unix seconds (integer, near current time)", () => {
    const t = defaultDeps.now();
    expect(Number.isInteger(t)).toBe(true);
    expect(Math.abs(t - Math.floor(Date.now() / 1000))).toBeLessThan(2);
  });

  it("randomBytes(n) returns Uint8Array of length n", () => {
    const bytes = defaultDeps.randomBytes(32);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    const second = defaultDeps.randomBytes(32);
    expect(Buffer.from(bytes).equals(Buffer.from(second))).toBe(false);
  });

  it("randomId(prefix) returns prefix_<base32-ish>", () => {
    const id = defaultDeps.randomId("otp");
    expect(id.startsWith("otp_")).toBe(true);
    expect(id.length).toBeGreaterThan(8);
    expect(id).not.toBe(defaultDeps.randomId("otp"));
  });

  it("Deps is structurally substitutable for tests", () => {
    const fake: Deps = {
      now: () => 1_700_000_000,
      randomBytes: (n) => new Uint8Array(n),
      randomId: (p) => `${p}_test`,
    };
    expect(fake.now()).toBe(1_700_000_000);
    expect(fake.randomId("x")).toBe("x_test");
  });
});
