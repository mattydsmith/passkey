import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

export type ServerName = "ts" | "go";

export interface ServerHandle {
  url: string;
  stop: () => Promise<void>;
}

export async function bootServer(name: ServerName): Promise<ServerHandle> {
  switch (name) {
    case "ts":
      return bootHonoApp();
    case "go":
      return bootGoApp();
  }
}

async function bootHonoApp(): Promise<ServerHandle> {
  const HONO_APP_DIR = resolve(REPO_ROOT, "examples", "hono-app");
  const HONO_APP_ENTRY = resolve(HONO_APP_DIR, "src", "index.ts");
  const TSX_BIN = resolve(HONO_APP_DIR, "node_modules", ".bin", "tsx");
  return bootSubprocess({
    label: "hono-app",
    cmd: TSX_BIN,
    args: [HONO_APP_ENTRY],
    deadlineMs: 30_000,
  });
}

async function bootGoApp(): Promise<ServerHandle> {
  const GO_APP_DIR = resolve(REPO_ROOT, "examples", "go-app");
  return bootSubprocess({
    label: "go-app",
    cmd: "go",
    args: ["run", "."],
    cwdOverride: GO_APP_DIR,
    deadlineMs: 60_000, // generous to absorb `go run` cold-start
  });
}

interface BootArgs {
  label: string;
  cmd: string;
  args: string[];
  cwdOverride?: string; // override the temp cwd if the binary needs to be invoked from its module dir
  deadlineMs?: number;  // how long to wait for the subprocess to become reachable
}

async function bootSubprocess(b: BootArgs): Promise<ServerHandle> {
  const port = await getFreePort();
  // Always created. Used as the subprocess cwd unless cwdOverride is set
  // (Go path: subprocess runs from its module dir, but tmpCwd is still its
  // scratch space for the sqlite db via PASSKEY_DB_DIR below).
  const tmpCwd = await mkdtemp(join(tmpdir(), `parity-${b.label}-`));
  const cwd = b.cwdOverride ?? tmpCwd;
  const deadlineMs = b.deadlineMs ?? 60_000;

  const child = spawn(b.cmd, b.args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      AUTH_ORIGINS: `http://localhost:${port}`,
      // For Go: tells the binary to write its sqlite db into the temp dir
      // (used in Phase 3+; harmless when the binary doesn't read it).
      PASSKEY_DB_DIR: tmpCwd,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrChunks: Buffer[] = [];
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

  let exited = false;
  let started = false;
  child.on("exit", (code, signal) => {
    exited = true;
    if (!started && code !== 0 && signal === null) {
      const out = Buffer.concat(stderrChunks).toString();
      process.stderr.write(
        `${b.label} subprocess exited with code ${code}\n${out}\n`,
      );
    }
  });

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (exited) {
      await rm(tmpCwd, { recursive: true, force: true });
      throw new Error(
        `${b.label} subprocess exited before becoming reachable\n${Buffer.concat(stderrChunks).toString()}`,
      );
    }
    try {
      const res = await fetch(`${url}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.status > 0) {
        started = true;
        return makeHandle(child, url, tmpCwd);
      }
    } catch {
      /* server not up yet */
    }
    await sleep(150);
  }

  child.kill("SIGTERM");
  await rm(tmpCwd, { recursive: true, force: true });
  throw new Error(
    `${b.label} did not become reachable on ${url} within ${deadlineMs}ms`,
  );
}

function makeHandle(
  child: ChildProcess,
  url: string,
  cwd: string,
): ServerHandle {
  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        const cleanup = async () => {
          await rm(cwd, { recursive: true, force: true });
          resolve();
        };
        if (child.exitCode !== null) {
          void cleanup();
          return;
        }
        child.once("exit", () => {
          void cleanup();
        });
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 5_000);
      }),
  };
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("could not bind to ephemeral port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}
