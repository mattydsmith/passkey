import { describe, it, expect, beforeEach } from "vitest";
import { createSessionStorage } from "../src/storage.js";

describe("createSessionStorage — cookie mode", () => {
  it("load/save/clear are no-ops", () => {
    const s = createSessionStorage("cookie");
    expect(s.load()).toBeNull();
    s.save("tok_abc");
    expect(s.load()).toBeNull();
    s.clear();
    expect(s.load()).toBeNull();
  });

  it("attachToRequest does not add Authorization", () => {
    const s = createSessionStorage("cookie");
    const headers = new Headers();
    s.attachToRequest(headers);
    expect(headers.get("authorization")).toBeNull();
  });

  it("returns includeCredentials=true", () => {
    const s = createSessionStorage("cookie");
    expect(s.includeCredentials).toBe(true);
  });
});

describe("createSessionStorage — header mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("save/load round-trips through localStorage", () => {
    const s = createSessionStorage("header");
    expect(s.load()).toBeNull();
    s.save("tok_abc");
    expect(s.load()).toBe("tok_abc");
  });

  it("uses the configured storageKey", () => {
    const s = createSessionStorage("header", { storageKey: "custom:key" });
    s.save("tok_xyz");
    expect(localStorage.getItem("custom:key")).toBe("tok_xyz");
  });

  it("clear removes the entry", () => {
    const s = createSessionStorage("header");
    s.save("tok_abc");
    s.clear();
    expect(s.load()).toBeNull();
  });

  it("attachToRequest adds Authorization: Bearer when token present", () => {
    const s = createSessionStorage("header");
    s.save("tok_abc");
    const headers = new Headers();
    s.attachToRequest(headers);
    expect(headers.get("authorization")).toBe("Bearer tok_abc");
  });

  it("attachToRequest does not add header when no token", () => {
    const s = createSessionStorage("header");
    const headers = new Headers();
    s.attachToRequest(headers);
    expect(headers.get("authorization")).toBeNull();
  });

  it("returns includeCredentials=false", () => {
    const s = createSessionStorage("header");
    expect(s.includeCredentials).toBe(false);
  });
});
