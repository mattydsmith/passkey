import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const HONO_APP_DIR = resolve(REPO_ROOT, "examples", "hono-app");
const HONO_APP_ENTRY = resolve(HONO_APP_DIR, "src", "index.ts");
const TSX_BIN = resolve(HONO_APP_DIR, "node_modules", ".bin", "tsx");

export interface ServerHandle {
  url: string;
  stop: () => Promise<void>;
}

export async function bootHonoApp(): Promise<ServerHandle> {
  const port = await getFreePort();
  const cwd = await mkdtemp(join(tmpdir(), "parity-hono-"));

  const child = spawn(TSX_BIN, [HONO_APP_ENTRY], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      AUTH_ORIGINS: `http://localhost:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrChunks: Buffer[] = [];
  child.stdout?.on("data", () => {
    /* drop in normal mode */
  });
  child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

  let exited = false;
  let started = false;
  child.on("exit", (code, signal) => {
    exited = true;
    if (!started && code !== 0 && signal === null) {
      const out = Buffer.concat(stderrChunks).toString();
      process.stderr.write(
        `hono-app subprocess exited with code ${code}\n${out}\n`,
      );
    }
  });

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) {
      await rm(cwd, { recursive: true, force: true });
      throw new Error(
        `hono-app subprocess exited before becoming reachable\n${Buffer.concat(stderrChunks).toString()}`,
      );
    }
    try {
      const res = await fetch(`${url}/`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.status > 0) {
        started = true;
        return makeHandle(child, url, cwd);
      }
    } catch {
      /* server not up yet */
    }
    await sleep(150);
  }

  child.kill("SIGTERM");
  await rm(cwd, { recursive: true, force: true });
  throw new Error(`hono-app did not become reachable on ${url} within 30s`);
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
