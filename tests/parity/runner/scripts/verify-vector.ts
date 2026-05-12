import { readFile } from "node:fs/promises";
import { parseScenario, type Scenario } from "../src/scenario.js";
import { runScenario, type RunOptions } from "../src/executor.js";
import { WebAuthnHarness, closeBrowser } from "../src/webauthn.js";

function containsWebauthnMarker(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsWebauthnMarker);
  const obj = value as Record<string, unknown>;
  if ("$webauthn" in obj) return true;
  return Object.values(obj).some(containsWebauthnMarker);
}

function scenarioUsesWebauthn(scenario: Scenario): boolean {
  return scenario.steps.some((s) => containsWebauthnMarker(s.request.body));
}

const argv = process.argv.slice(2);
let baseUrl = "http://localhost:3001";
const paths: string[] = [];
for (const a of argv) {
  if (a.startsWith("--url=")) baseUrl = a.slice(6);
  else paths.push(a);
}
if (paths.length === 0) {
  console.error("usage: verify-vector.ts [--url=...] <vector.json> [...]");
  process.exit(2);
}

const origin = new URL(baseUrl).origin;
let failed = 0;

try {
  for (const p of paths) {
    const raw = JSON.parse(await readFile(p, "utf8"));
    const scenario = parseScenario(raw);

    let harness: WebAuthnHarness | undefined;
    if (scenarioUsesWebauthn(scenario)) {
      harness = await WebAuthnHarness.create({ origin });
    }

    const opts: RunOptions = { baseUrl };
    if (harness !== undefined) opts.harness = harness;

    try {
      const result = await runScenario(scenario, opts);
      if (result.ok) {
        console.log(`PASS  ${scenario.name}  (${result.steps.length} steps)`);
      } else {
        failed++;
        console.log(
          `FAIL  ${scenario.name}  step ${result.failureStep}: ${result.reason}`,
        );
      }
    } finally {
      if (harness !== undefined) await harness.destroy();
    }
  }
} finally {
  await closeBrowser();
}

process.exit(failed === 0 ? 0 : 1);
