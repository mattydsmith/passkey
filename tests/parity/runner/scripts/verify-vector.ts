import { readFile } from "node:fs/promises";
import { parseScenario } from "../src/scenario.js";
import { runScenario } from "../src/executor.js";

const args = process.argv.slice(2);
let baseUrl = "http://localhost:3001";
const paths: string[] = [];
for (const a of args) {
  if (a.startsWith("--url=")) baseUrl = a.slice(6);
  else paths.push(a);
}
if (paths.length === 0) {
  console.error("usage: verify-vector.ts [--url=...] <vector.json> [...]");
  process.exit(2);
}

let failed = 0;
for (const p of paths) {
  const raw = JSON.parse(await readFile(p, "utf8"));
  const scenario = parseScenario(raw);
  const result = await runScenario(scenario, { baseUrl });
  if (result.ok) {
    console.log(`PASS  ${scenario.name}  (${result.steps.length} steps)`);
  } else {
    failed++;
    console.log(
      `FAIL  ${scenario.name}  step ${result.failureStep}: ${result.reason}`,
    );
  }
}
process.exit(failed === 0 ? 0 : 1);
