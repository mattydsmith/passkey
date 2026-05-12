export type MatchResult =
  | { ok: true }
  | { ok: false; path: string; reason: string };

export type LeafMatcher =
  | { type: "string"; nonEmpty?: boolean }
  | { type: "number"; min?: number; max?: number }
  | { type: "boolean" }
  | { const: unknown }
  | { regex: string }
  | { array: { minLength?: number; items?: Matcher } }
  | { $any: true }
  | { error: string };

export type Matcher = LeafMatcher | { [key: string]: Matcher };

const LEAF_KEYS = ["type", "const", "regex", "array", "$any", "error"] as const;

export function match(spec: unknown, value: unknown, path = "$"): MatchResult {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return fail(path, `invalid matcher spec: ${describe(spec)}`);
  }
  const obj = spec as Record<string, unknown>;

  for (const key of LEAF_KEYS) {
    if (key in obj) return matchLeaf(key, obj, value, path);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, `expected object, got ${describe(value)}`);
  }
  const v = value as Record<string, unknown>;
  for (const [k, sub] of Object.entries(obj)) {
    if (!(k in v)) {
      return fail(`${path}.${k}`, "missing field");
    }
    const r = match(sub, v[k], `${path}.${k}`);
    if (!r.ok) return r;
  }
  return { ok: true };
}

function matchLeaf(
  kind: (typeof LEAF_KEYS)[number],
  spec: Record<string, unknown>,
  value: unknown,
  path: string,
): MatchResult {
  switch (kind) {
    case "type":
      return matchType(spec, value, path);
    case "const":
      return matchConst(spec.const, value, path);
    case "regex":
      return matchRegex(spec.regex, value, path);
    case "array":
      return matchArray(spec.array, value, path);
    case "$any":
      return spec.$any === true
        ? { ok: true }
        : fail(path, `$any must be true`);
    case "error":
      return matchError(spec.error, value, path);
  }
}

function matchType(
  spec: Record<string, unknown>,
  value: unknown,
  path: string,
): MatchResult {
  const t = spec.type;
  if (t === "string") {
    if (typeof value !== "string") {
      return fail(path, `expected string, got ${describe(value)}`);
    }
    if (spec.nonEmpty === true && value.length === 0) {
      return fail(path, `expected non-empty string`);
    }
    return { ok: true };
  }
  if (t === "number") {
    if (typeof value !== "number") {
      return fail(path, `expected number, got ${describe(value)}`);
    }
    if (typeof spec.min === "number" && value < spec.min) {
      return fail(path, `expected number >= ${spec.min}, got ${value}`);
    }
    if (typeof spec.max === "number" && value > spec.max) {
      return fail(path, `expected number <= ${spec.max}, got ${value}`);
    }
    return { ok: true };
  }
  if (t === "boolean") {
    if (typeof value !== "boolean") {
      return fail(path, `expected boolean, got ${describe(value)}`);
    }
    return { ok: true };
  }
  return fail(path, `unknown type matcher: ${JSON.stringify(t)}`);
}

function matchConst(
  expected: unknown,
  value: unknown,
  path: string,
): MatchResult {
  if (deepEqual(expected, value)) return { ok: true };
  return fail(
    path,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`,
  );
}

function matchRegex(
  pattern: unknown,
  value: unknown,
  path: string,
): MatchResult {
  if (typeof pattern !== "string") {
    return fail(path, `regex matcher requires string pattern`);
  }
  if (typeof value !== "string") {
    return fail(path, `expected string for regex, got ${describe(value)}`);
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    return fail(path, `invalid regex ${JSON.stringify(pattern)}: ${String(e)}`);
  }
  if (!re.test(value)) {
    return fail(
      path,
      `value ${JSON.stringify(value)} did not match regex ${pattern}`,
    );
  }
  return { ok: true };
}

function matchArray(
  spec: unknown,
  value: unknown,
  path: string,
): MatchResult {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return fail(path, `array spec must be an object`);
  }
  const a = spec as { minLength?: unknown; items?: unknown };
  if (!Array.isArray(value)) {
    return fail(path, `expected array, got ${describe(value)}`);
  }
  if (typeof a.minLength === "number" && value.length < a.minLength) {
    return fail(
      path,
      `expected array length >= ${a.minLength}, got ${value.length}`,
    );
  }
  if (a.items !== undefined) {
    for (let i = 0; i < value.length; i++) {
      const r = match(a.items, value[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
  }
  return { ok: true };
}

function matchError(
  code: unknown,
  value: unknown,
  path: string,
): MatchResult {
  if (typeof code !== "string") {
    return fail(path, `error matcher requires string code`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, `expected error envelope object, got ${describe(value)}`);
  }
  const v = value as Record<string, unknown>;
  if (v.error !== code) {
    return fail(
      `${path}.error`,
      `expected error code "${code}", got ${JSON.stringify(v.error)}`,
    );
  }
  if (typeof v.message !== "string" || v.message.length === 0) {
    return fail(`${path}.message`, `expected non-empty string`);
  }
  return { ok: true };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function fail(path: string, reason: string): MatchResult {
  return { ok: false, path, reason };
}
