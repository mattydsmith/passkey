import { randomBytes as nodeRandomBytes } from "node:crypto";

export interface Deps {
  /** Unix seconds (integer). */
  now: () => number;
  /** N cryptographically random bytes. */
  randomBytes: (n: number) => Uint8Array;
  /** Short opaque ID with a prefix, e.g. "otp_abc123". */
  randomId: (prefix: string) => string;
}

const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // no 0/1/l/o ambiguity

function randomIdImpl(prefix: string): string {
  const bytes = nodeRandomBytes(12);
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return `${prefix}_${s}`;
}

export const defaultDeps: Deps = {
  now: () => Math.floor(Date.now() / 1000),
  randomBytes: (n) => new Uint8Array(nodeRandomBytes(n)),
  randomId: randomIdImpl,
};
