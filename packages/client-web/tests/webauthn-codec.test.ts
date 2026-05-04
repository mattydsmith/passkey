import { describe, it, expect } from "vitest";
import { bufferToBase64url, base64urlToBuffer } from "../src/webauthn.js";

describe("base64url codec", () => {
  it("round-trips an empty buffer", () => {
    const b = new Uint8Array([]).buffer;
    expect(bufferToBase64url(b)).toBe("");
    expect(base64urlToBuffer("").byteLength).toBe(0);
  });

  it("round-trips a known short buffer", () => {
    // bytes [0xff, 0xfe, 0xfd] → "//79" in standard base64 → "__79" in base64url
    const b = new Uint8Array([0xff, 0xfe, 0xfd]).buffer;
    expect(bufferToBase64url(b)).toBe("__79");
    const decoded = new Uint8Array(base64urlToBuffer("__79"));
    expect(Array.from(decoded)).toEqual([0xff, 0xfe, 0xfd]);
  });

  it("strips padding (=) on encode", () => {
    // 1 byte → 2 char + 2 pad in standard base64; base64url drops pad
    const b = new Uint8Array([0x4d]).buffer;
    expect(bufferToBase64url(b)).toBe("TQ");
  });

  it("accepts padded input on decode", () => {
    const a = new Uint8Array(base64urlToBuffer("TQ=="));
    expect(Array.from(a)).toEqual([0x4d]);
  });

  it("round-trips random 256 bytes", () => {
    const bytes = new Uint8Array(256);
    crypto.getRandomValues(bytes);
    const encoded = bufferToBase64url(bytes.buffer);
    const decoded = new Uint8Array(base64urlToBuffer(encoded));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("base64url uses - and _ instead of + and /", () => {
    // bytes that produce + and / in standard base64
    // [0x3e] → "Pg==" standard; [0x3f] → "Pw==" — find one that produces +//
    const b = new Uint8Array([0xfb, 0xff]).buffer; // "+/8=" standard
    const out = bufferToBase64url(b);
    expect(out).not.toMatch(/[+/=]/);
    expect(out).toBe("-_8");
  });
});
