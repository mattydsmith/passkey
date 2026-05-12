import { describe, it, expect } from "vitest";
import {
  parseScenario,
  interpolate,
  pickJsonPath,
} from "../src/scenario.js";

describe("parseScenario", () => {
  it("accepts a minimal valid scenario", () => {
    const parsed = parseScenario({
      name: "happy",
      mode: "bearer",
      steps: [
        {
          request: {
            method: "POST",
            path: "/auth/email/start",
            body: { email: "x@y" },
          },
          expect: { status: 200 },
        },
      ],
    });
    expect(parsed.name).toBe("happy");
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]!.request.method).toBe("POST");
  });

  it("accepts cookie mode and omitCsrf flag", () => {
    const parsed = parseScenario({
      name: "csrf",
      mode: "cookie",
      steps: [
        {
          request: { method: "POST", path: "/auth/sign-out", omitCsrf: true },
          expect: { status: 403 },
        },
      ],
    });
    expect(parsed.mode).toBe("cookie");
    expect(parsed.steps[0]!.request.omitCsrf).toBe(true);
  });

  it("rejects empty steps", () => {
    expect(() =>
      parseScenario({ name: "x", mode: "bearer", steps: [] })
    ).toThrow();
  });

  it("rejects unknown mode", () => {
    expect(() =>
      parseScenario({
        name: "x",
        mode: "session",
        steps: [
          {
            request: { method: "GET", path: "/" },
            expect: { status: 200 },
          },
        ],
      })
    ).toThrow();
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseScenario({
        name: "x",
        mode: "bearer",
        extra: 1,
        steps: [
          {
            request: { method: "GET", path: "/" },
            expect: { status: 200 },
          },
        ],
      })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => parseScenario({ name: "x" })).toThrow();
  });

  it("rejects unknown HTTP methods", () => {
    expect(() =>
      parseScenario({
        name: "x",
        mode: "bearer",
        steps: [
          {
            request: { method: "TRACE", path: "/" },
            expect: { status: 200 },
          },
        ],
      })
    ).toThrow();
  });
});

describe("interpolate", () => {
  it("replaces {{name}} in surrounding text", () => {
    expect(interpolate("hello {{name}}", { name: "world" })).toBe(
      "hello world"
    );
  });

  it("preserves type when the string is exactly {{name}}", () => {
    expect(interpolate("{{count}}", { count: 7 })).toBe(7);
  });

  it("preserves object identity when the string is exactly {{name}}", () => {
    const obj = { a: 1 };
    expect(interpolate("{{obj}}", { obj })).toBe(obj);
  });

  it("recurses through objects", () => {
    expect(interpolate({ a: "{{x}}", b: "lit" }, { x: "y" })).toEqual({
      a: "y",
      b: "lit",
    });
  });

  it("recurses through nested objects", () => {
    expect(
      interpolate({ outer: { inner: "{{x}}" } }, { x: "y" })
    ).toEqual({ outer: { inner: "y" } });
  });

  it("recurses through arrays", () => {
    expect(interpolate(["{{x}}", "lit", { a: "{{x}}" }], { x: "y" })).toEqual([
      "y",
      "lit",
      { a: "y" },
    ]);
  });

  it("supports dotted paths", () => {
    expect(
      interpolate("{{user.name}}", { user: { name: "matt" } })
    ).toBe("matt");
  });

  it("throws on missing top-level variable", () => {
    expect(() => interpolate("{{x}}", {})).toThrow(/unresolved/);
  });

  it("throws on missing nested variable", () => {
    expect(() =>
      interpolate("{{user.email}}", { user: { name: "matt" } })
    ).toThrow(/unresolved/);
  });

  it("throws on dotted path into a non-object", () => {
    expect(() =>
      interpolate("{{user.email}}", { user: "matt" })
    ).toThrow(/unresolved/);
  });

  it("leaves non-string primitives untouched", () => {
    expect(interpolate(7, {})).toBe(7);
    expect(interpolate(true, {})).toBe(true);
    expect(interpolate(null, {})).toBe(null);
  });

  it("handles multiple variables in a single string", () => {
    expect(
      interpolate("{{a}}-{{b}}", { a: "x", b: "y" })
    ).toBe("x-y");
  });
});

describe("pickJsonPath", () => {
  it("walks $.body.foo", () => {
    expect(pickJsonPath({ body: { foo: 1 } }, "$.body.foo")).toBe(1);
  });

  it("walks deeper nested paths", () => {
    expect(
      pickJsonPath({ body: { user: { id: "u_1" } } }, "$.body.user.id")
    ).toBe("u_1");
  });

  it("returns objects and arrays as-is", () => {
    const arr = [1, 2, 3];
    expect(pickJsonPath({ body: { items: arr } }, "$.body.items")).toBe(arr);
  });

  it("throws when path doesn't start with $.", () => {
    expect(() => pickJsonPath({}, "body.foo")).toThrow(/must start with/);
  });

  it("throws when intermediate is not an object", () => {
    expect(() => pickJsonPath({ body: "x" }, "$.body.foo")).toThrow(
      /not an object/
    );
  });

  it("throws when key is missing", () => {
    expect(() => pickJsonPath({ body: {} }, "$.body.foo")).toThrow(
      /missing key/
    );
  });
});
