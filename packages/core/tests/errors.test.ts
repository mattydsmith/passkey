import { describe, it, expect } from "vitest";
import { AuthError, type AuthErrorCode } from "../src/errors.js";

describe("AuthError", () => {
  it("attaches code and message", () => {
    const err = new AuthError("invalid_otp", "Code does not match");
    expect(err.code).toBe("invalid_otp");
    expect(err.message).toBe("Code does not match");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AuthError");
  });

  it("serializes to a JSON-friendly shape via toJSON", () => {
    const err = new AuthError("rate_limited", "Slow down");
    expect(err.toJSON()).toEqual({ error: "rate_limited", message: "Slow down" });
  });

  it("AuthError.is() narrows by code", () => {
    const err: unknown = new AuthError("invalid_otp", "");
    if (AuthError.is(err, "invalid_otp")) {
      const _typed: AuthErrorCode = err.code;
      expect(_typed).toBe("invalid_otp");
    } else {
      throw new Error("should have matched");
    }
  });
});
