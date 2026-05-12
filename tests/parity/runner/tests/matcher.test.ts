import { describe, it, expect } from "vitest";
import { match } from "../src/matcher.js";

describe("match - type:string", () => {
  it("accepts any string", () => {
    expect(match({ type: "string" }, "x").ok).toBe(true);
    expect(match({ type: "string" }, "").ok).toBe(true);
  });
  it("rejects non-strings", () => {
    const r = match({ type: "string" }, 7);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expected string/);
  });
  it("nonEmpty rejects empty strings", () => {
    expect(match({ type: "string", nonEmpty: true }, "x").ok).toBe(true);
    expect(match({ type: "string", nonEmpty: true }, "").ok).toBe(false);
  });
});

describe("match - type:number", () => {
  it("accepts numbers", () => {
    expect(match({ type: "number" }, 7).ok).toBe(true);
    expect(match({ type: "number" }, 0).ok).toBe(true);
  });
  it("rejects non-numbers", () => {
    expect(match({ type: "number" }, "7").ok).toBe(false);
  });
  it("enforces min", () => {
    expect(match({ type: "number", min: 1 }, 1).ok).toBe(true);
    expect(match({ type: "number", min: 1 }, 0).ok).toBe(false);
  });
  it("enforces max", () => {
    expect(match({ type: "number", max: 10 }, 10).ok).toBe(true);
    expect(match({ type: "number", max: 10 }, 11).ok).toBe(false);
  });
});

describe("match - type:boolean", () => {
  it("accepts booleans", () => {
    expect(match({ type: "boolean" }, true).ok).toBe(true);
    expect(match({ type: "boolean" }, false).ok).toBe(true);
  });
  it("rejects non-booleans", () => {
    expect(match({ type: "boolean" }, "true").ok).toBe(false);
  });
});

describe("match - const", () => {
  it("matches primitives by equality", () => {
    expect(match({ const: "x" }, "x").ok).toBe(true);
    expect(match({ const: 7 }, 7).ok).toBe(true);
    expect(match({ const: null }, null).ok).toBe(true);
    expect(match({ const: true }, true).ok).toBe(true);
  });
  it("rejects mismatches", () => {
    expect(match({ const: "x" }, "y").ok).toBe(false);
    expect(match({ const: 7 }, "7").ok).toBe(false);
  });
  it("matches deeply equal objects and arrays", () => {
    expect(match({ const: { a: 1, b: [2, 3] } }, { a: 1, b: [2, 3] }).ok).toBe(
      true,
    );
    expect(match({ const: [1, 2] }, [1, 2]).ok).toBe(true);
  });
  it("rejects deep mismatches", () => {
    expect(match({ const: { a: 1 } }, { a: 2 }).ok).toBe(false);
    expect(match({ const: [1, 2] }, [1, 2, 3]).ok).toBe(false);
  });
});

describe("match - regex", () => {
  it("matches strings against the pattern", () => {
    expect(match({ regex: "^u_" }, "u_abc").ok).toBe(true);
    expect(match({ regex: "^u_" }, "x_abc").ok).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(match({ regex: "^x" }, 7).ok).toBe(false);
  });
});

describe("match - array", () => {
  it("accepts any array when no constraints given", () => {
    expect(match({ array: {} }, []).ok).toBe(true);
    expect(match({ array: {} }, [1, 2]).ok).toBe(true);
  });
  it("rejects non-arrays", () => {
    expect(match({ array: {} }, "x").ok).toBe(false);
    expect(match({ array: {} }, { length: 1 }).ok).toBe(false);
  });
  it("enforces minLength", () => {
    expect(match({ array: { minLength: 2 } }, [1, 2]).ok).toBe(true);
    expect(match({ array: { minLength: 2 } }, [1]).ok).toBe(false);
  });
  it("applies items matcher to each entry", () => {
    expect(
      match({ array: { items: { type: "string" } } }, ["a", "b"]).ok,
    ).toBe(true);
    const r = match({ array: { items: { type: "string" } } }, ["a", 7]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe("$[1]");
  });
});

describe("match - $any", () => {
  it("accepts any value", () => {
    expect(match({ $any: true }, "x").ok).toBe(true);
    expect(match({ $any: true }, null).ok).toBe(true);
    expect(match({ $any: true }, { a: 1 }).ok).toBe(true);
    expect(match({ $any: true }, undefined).ok).toBe(true);
  });
});

describe("match - error", () => {
  it("accepts a valid error envelope", () => {
    expect(
      match(
        { error: "invalid_otp" },
        { error: "invalid_otp", message: "wrong code" },
      ).ok,
    ).toBe(true);
  });
  it("rejects mismatched error codes", () => {
    const r = match(
      { error: "invalid_otp" },
      { error: "otp_expired", message: "x" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe("$.error");
  });
  it("requires a non-empty string message", () => {
    expect(match({ error: "x" }, { error: "x", message: "" }).ok).toBe(false);
    expect(match({ error: "x" }, { error: "x" }).ok).toBe(false);
    expect(match({ error: "x" }, { error: "x", message: 0 }).ok).toBe(false);
  });
  it("rejects non-object values", () => {
    expect(match({ error: "x" }, "x").ok).toBe(false);
    expect(match({ error: "x" }, null).ok).toBe(false);
  });
});

describe("match - nested objects", () => {
  it("recurses through nested matchers", () => {
    expect(
      match(
        { user: { id: { type: "string", nonEmpty: true } } },
        { user: { id: "u_1" } },
      ).ok,
    ).toBe(true);
  });
  it("reports the full path on nested mismatch", () => {
    const r = match(
      { user: { id: { type: "string" } } },
      { user: { id: 7 } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.user.id");
      expect(r.reason).toMatch(/expected string/);
    }
  });
  it("reports missing fields", () => {
    const r = match({ user: { id: { type: "string" } } }, { user: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.path).toBe("$.user.id");
      expect(r.reason).toMatch(/missing/);
    }
  });
  it("rejects when expecting an object and getting a primitive", () => {
    const r = match({ user: { id: { type: "string" } } }, { user: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe("$.user");
  });
  it("ignores extra fields on the value side", () => {
    expect(
      match(
        { id: { type: "string" } },
        { id: "u_1", extra: "ignored" },
      ).ok,
    ).toBe(true);
  });
});

describe("match - top-level errors", () => {
  it("rejects array specs", () => {
    expect(match([], "x").ok).toBe(false);
  });
  it("rejects null and primitive specs", () => {
    expect(match(null, "x").ok).toBe(false);
    expect(match("x", "x").ok).toBe(false);
  });
});
