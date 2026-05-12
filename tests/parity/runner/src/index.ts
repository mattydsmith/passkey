import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario, type Scenario } from "./scenario.js";
import { runScenario, type RunOptions } from "./executor.js";
import { WebAuthnHarness, closeBrowser } from "./webauthn.js";
import { bootServer, type ServerHandle, type ServerName } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS_DIR = resolve(__dirname, "..", "..", "vectors");

interface CliArgs {
  url?: string;
  only?: string;
  server: ServerName;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { server: "ts" };
  for (const a of argv) {
    if (a.startsWith("--url=")) out.url = a.slice(6);
    else if (a.startsWith("--only=")) out.only = a.slice(7);
    else if (a.startsWith("--server=")) {
      const v = a.slice(9);
      if (v !== "ts" && v !== "go") {
        console.error(`--server must be 'ts' or 'go', got: ${v}`);
        process.exit(2);
      }
      out.server = v;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  return out;
}

function printHelp(): void {
  console.log(
    [
      "Usage: tsx src/index.ts [--server=ts|go] [--url=<base>] [--only=<substring>]",
      "",
      "  --server=ts|go     Which server implementation to boot. Default: ts.",
      "                     Ignored when --url is given.",
      "  --url=<base>       Run vectors against an external server URL.",
      "                     If omitted, boots the chosen example app.",
      "  --only=<sub>       Only run vectors whose path matches the substring.",
      "                     e.g. --only=email/verify",
      "",
      "Exit status: 0 if all vectors pass, 1 if any fail, 2 on usage error.",
    ].join("\n"),
  );
}

async function discoverVectors(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
    }
  }
  await walk(VECTORS_DIR);
  return out.sort();
}

function containsWebauthnMarker(v: unknown): boolean {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return v.some(containsWebauthnMarker);
  const obj = v as Record<string, unknown>;
  if ("$webauthn" in obj) return true;
  return Object.values(obj).some(containsWebauthnMarker);
}

function scenarioUsesWebauthn(s: Scenario): boolean {
  return s.steps.some((step) => containsWebauthnMarker(step.request.body));
}

interface ParsedVector {
  path: string;
  relPath: string;
  scenario: Scenario;
}

async function loadVectors(filter?: string): Promise<ParsedVector[]> {
  const files = await discoverVectors();
  const filtered =
    filter !== undefined
      ? files.filter((f) =>
          relative(VECTORS_DIR, f).replaceAll("\\", "/").includes(filter),
        )
      : files;
  if (filtered.length === 0) {
    const msg =
      filter !== undefined
        ? `no vectors matched --only=${filter}`
        : "no vectors found";
    throw new Error(msg);
  }

  const out: ParsedVector[] = [];
  for (const p of filtered) {
    const raw = JSON.parse(await readFile(p, "utf8"));
    try {
      const scenario = parseScenario(raw);
      out.push({
        path: p,
        relPath: relative(VECTORS_DIR, p).replaceAll("\\", "/"),
        scenario,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`malformed vector ${relative(VECTORS_DIR, p)}: ${msg}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let vectors: ParsedVector[];
  try {
    vectors = await loadVectors(args.only);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }

  let server: ServerHandle | null = null;
  let baseUrl: string;
  if (args.url !== undefined) {
    baseUrl = args.url;
  } else {
    console.error(`Booting ${args.server}-app...`);
    server = await bootServer(args.server);
    baseUrl = server.url;
    console.error(`${args.server}-app ready on ${baseUrl}`);
  }

  const origin = new URL(baseUrl).origin;
  let passed = 0;
  let failed = 0;

  try {
    for (const v of vectors) {
      let harness: WebAuthnHarness | undefined;
      if (scenarioUsesWebauthn(v.scenario)) {
        harness = await WebAuthnHarness.create({ origin });
      }
      const opts: RunOptions = { baseUrl };
      if (harness !== undefined) opts.harness = harness;

      try {
        const result = await runScenario(v.scenario, opts);
        if (result.ok) {
          passed++;
          console.log(
            `PASS  ${v.scenario.name}  (${result.steps.length} steps)`,
          );
        } else {
          failed++;
          console.log(
            `FAIL  ${v.scenario.name}  step ${result.failureStep}: ${result.reason}`,
          );
        }
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`ERROR ${v.scenario.name}  ${msg}`);
      } finally {
        if (harness !== undefined) await harness.destroy();
      }
    }
  } finally {
    await closeBrowser();
    if (server !== null) await server.stop();
  }

  console.log();
  console.log(
    `Summary: ${passed} passed, ${failed} failed (${vectors.length} total)`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

await main();
