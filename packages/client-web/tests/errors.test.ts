import { describe, it, expect } from "vitest";
import { AuthClientError, isAuthClientError } from "../src/errors.js";

describe("AuthClientError", () => {
  it("has code, message, and optional status/cause", () => {
    const e = new AuthClientError("invalid_otp", "Wrong code", { status: 401 });
    expect(e.code).toBe("invalid_otp");
    expect(e.message).toBe("Wrong code");
    expect(e.status).toBe(401);
    expect(e.cause).toBeUndefined();
    expect(e.name).toBe("AuthClientError");
  });

  it("preserves cause", () => {
    const inner = new Error("network down");
    const e = new AuthClientError("network", "fetch failed", { cause: inner });
    expect(e.cause).toBe(inner);
  });

  it("isAuthClientError narrows the type", () => {
    const e: unknown = new AuthClientError("unauthenticated", "x");
    if (isAuthClientError(e)) {
      // type test: code is the union
      expect(e.code).toBe("unauthenticated");
    } else {
      throw new Error("guard failed");
    }
    expect(isAuthClientError(new Error("nope"))).toBe(false);
    expect(isAuthClientError("string")).toBe(false);
    expect(isAuthClientError(null)).toBe(false);
  });

  it("accepts an unknown server code as a fallback string", () => {
    const e = new AuthClientError("future_code" as any, "msg", { status: 418 });
    expect(e.code).toBe("future_code");
  });
});
