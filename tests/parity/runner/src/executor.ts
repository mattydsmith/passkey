import {
  interpolate,
  pickJsonPath,
  type Context,
  type Expect,
  type Scenario,
  type Step,
} from "./scenario.js";
import { match, type MatchResult } from "./matcher.js";
import {
  Transport,
  type TransportResponse,
} from "./transport.js";
import type { WebAuthnHarness, CeremonyKind } from "./webauthn.js";

export interface RunOptions {
  baseUrl: string;
  harness?: WebAuthnHarness;
}

export interface StepResult {
  step: number;
  request: { method: string; path: string };
  response: TransportResponse | null;
  check: MatchResult;
}

export type ScenarioResult =
  | { ok: true; scenario: string; steps: StepResult[] }
  | {
      ok: false;
      scenario: string;
      steps: StepResult[];
      failureStep: number;
      reason: string;
    };

export async function runScenario(
  scenario: Scenario,
  opts: RunOptions,
): Promise<ScenarioResult> {
  const transport = new Transport({
    baseUrl: opts.baseUrl,
    mode: scenario.mode,
  });
  const ctx: Context = {};
  const results: StepResult[] = [];

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]!;
    const stepNumber = i + 1;
    let response: TransportResponse | null = null;
    try {
      const request = await processStepRequest(step, ctx, opts.harness ?? null);
      response = await transport.execute(request);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      results.push({
        step: stepNumber,
        request: { method: step.request.method, path: step.request.path },
        response: null,
        check: { ok: false, path: "$.request", reason },
      });
      return {
        ok: false,
        scenario: scenario.name,
        steps: results,
        failureStep: stepNumber,
        reason,
      };
    }

    const check = checkResponse(step.expect, response);
    results.push({
      step: stepNumber,
      request: { method: step.request.method, path: step.request.path },
      response,
      check,
    });
    if (!check.ok) {
      return {
        ok: false,
        scenario: scenario.name,
        steps: results,
        failureStep: stepNumber,
        reason: `${check.path}: ${check.reason}`,
      };
    }

    if (step.capture !== undefined) {
      try {
        applyCaptures(step.capture, response, ctx);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          scenario: scenario.name,
          steps: results,
          failureStep: stepNumber,
          reason,
        };
      }
    }
  }

  return { ok: true, scenario: scenario.name, steps: results };
}

interface PreparedRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  omitCsrf?: boolean;
}

async function processStepRequest(
  step: Step,
  ctx: Context,
  harness: WebAuthnHarness | null,
): Promise<PreparedRequest> {
  const req = step.request;
  const path = interpolate(req.path, ctx);
  const out: PreparedRequest = {
    method: req.method,
    path,
  };
  if (req.body !== undefined) {
    out.body = await processBody(req.body, ctx, harness);
  }
  if (req.headers !== undefined) {
    out.headers = interpolate(req.headers, ctx);
  }
  if (req.omitCsrf !== undefined) {
    out.omitCsrf = req.omitCsrf;
  }
  return out;
}

async function processBody(
  value: unknown,
  ctx: Context,
  harness: WebAuthnHarness | null,
): Promise<unknown> {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return await Promise.all(
      value.map((v) => processBody(v, ctx, harness)),
    );
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$webauthn" in obj) {
      const kind = obj.$webauthn;
      if (kind !== "create" && kind !== "get") {
        throw new Error(
          `invalid $webauthn kind: ${JSON.stringify(kind)} (expected "create" or "get")`,
        );
      }
      if (harness === null) {
        throw new Error(
          `step uses $webauthn but no WebAuthn harness was provided to runScenario`,
        );
      }
      const rawOptions = obj.options;
      if (rawOptions === undefined) {
        throw new Error(`$webauthn marker requires an "options" field`);
      }
      const options = interpolate(rawOptions, ctx);
      return await harness.ceremony(kind as CeremonyKind, options);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = await processBody(v, ctx, harness);
    }
    return out;
  }
  return interpolate(value, ctx);
}

function checkResponse(
  expected: Expect,
  response: TransportResponse,
): MatchResult {
  if (response.status !== expected.status) {
    return {
      ok: false,
      path: "$.status",
      reason: `expected status ${expected.status}, got ${response.status}`,
    };
  }
  if (expected.body !== undefined) {
    const r = match(expected.body, response.body, "$.body");
    if (!r.ok) return r;
  }
  if (expected.headers !== undefined) {
    const r = match(expected.headers, response.headers, "$.headers");
    if (!r.ok) return r;
  }
  return { ok: true };
}

function applyCaptures(
  captures: Record<string, string>,
  response: TransportResponse,
  ctx: Context,
): void {
  for (const [name, path] of Object.entries(captures)) {
    ctx[name] = pickJsonPath(response, path);
  }
}
