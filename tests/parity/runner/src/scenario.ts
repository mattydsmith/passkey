import { z } from "zod";

export const httpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

export const requestSchema = z
  .object({
    method: httpMethodSchema,
    path: z.string().min(1),
    body: z.unknown().optional(),
    headers: z.record(z.string()).optional(),
    omitCsrf: z.boolean().optional(),
  })
  .strict();
export type Request = z.infer<typeof requestSchema>;

export const expectSchema = z
  .object({
    status: z.number().int(),
    body: z.unknown().optional(),
    headers: z.record(z.unknown()).optional(),
  })
  .strict();
export type Expect = z.infer<typeof expectSchema>;

export const stepSchema = z
  .object({
    request: requestSchema,
    expect: expectSchema,
    capture: z.record(z.string()).optional(),
  })
  .strict();
export type Step = z.infer<typeof stepSchema>;

export const scenarioSchema = z
  .object({
    name: z.string().min(1),
    mode: z.enum(["bearer", "cookie"]),
    steps: z.array(stepSchema).min(1),
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;

export function parseScenario(raw: unknown): Scenario {
  return scenarioSchema.parse(raw);
}

export type Context = Record<string, unknown>;

const VAR_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;
const FULL_VAR_PATTERN = /^\{\{\s*([\w.]+)\s*\}\}$/;

export function interpolate<T>(template: T, ctx: Context): T {
  if (typeof template === "string") {
    const full = template.match(FULL_VAR_PATTERN);
    if (full && full[1]) {
      return resolveVar(full[1], ctx) as T;
    }
    return template.replace(VAR_PATTERN, (_, name: string) => {
      const value = resolveVar(name, ctx);
      return String(value);
    }) as T;
  }
  if (Array.isArray(template)) {
    return template.map((item) => interpolate(item, ctx)) as T;
  }
  if (template !== null && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = interpolate(v, ctx);
    }
    return out as T;
  }
  return template;
}

function resolveVar(name: string, ctx: Context): unknown {
  const parts = name.split(".");
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      throw new Error(`unresolved variable: {{${name}}}`);
    }
    const obj = cur as Record<string, unknown>;
    if (!(part in obj)) {
      throw new Error(`unresolved variable: {{${name}}}`);
    }
    cur = obj[part];
  }
  if (cur === undefined) {
    throw new Error(`unresolved variable: {{${name}}}`);
  }
  return cur;
}

export function pickJsonPath(root: unknown, path: string): unknown {
  if (!path.startsWith("$.")) {
    throw new Error(`invalid json path (must start with "$."): ${path}`);
  }
  const parts = path.slice(2).split(".");
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined) {
      throw new Error(`cannot resolve ${path}: nullish at "${part}"`);
    }
    if (typeof cur !== "object") {
      throw new Error(`cannot resolve ${path}: not an object at "${part}"`);
    }
    const obj = cur as Record<string, unknown>;
    if (!(part in obj)) {
      throw new Error(`cannot resolve ${path}: missing key "${part}"`);
    }
    cur = obj[part];
  }
  return cur;
}
