import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createBuilder, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { node } from "./vite.js";

const execFileAsync = promisify(execFile);

/**
 * Dependencies such as React pick their development or production build while their module
 * evaluates, so `NODE_ENV` has to be set before the user entry (and everything it imports) runs.
 * The fixture records the value it sees at evaluation time, then exits once the server is ready.
 */
const userEntry = `
const env = globalThis.process.env;
if (env.UD_TEST_FAIL_START) {
  // Like Vike's listener: logs the error and leaves the exit code unset.
  process.on("uncaughtException", (error) => console.error(error));
  if (env.UD_TEST_FAIL_START === "pending-work") setInterval(() => {}, 1000);
  if (env.UD_TEST_FAIL_START === "1" || env.UD_TEST_FAIL_START === "pending-work") throw new Error("refusing to start");
}
const atEvaluation = env[["NODE", "ENV"].join("_")] ?? null;
export default {
  port: Number(env.UD_TEST_PORT ?? 0),
  hostname: "127.0.0.1",
  silent: true,
  fetch: () => new Response("ok"),
  onReady: (server) => {
    if (env.UD_TEST_FAIL_START === "on-ready" || env.UD_TEST_FAIL_START === "on-ready-async") {
      console.log(server.url);
      const error = new Error("refusing to start");
      if (env.UD_TEST_FAIL_START === "on-ready-async") return Promise.reject(error);
      throw error;
    }
    console.log(JSON.stringify({ atEvaluation, atReady: env[["NODE", "ENV"].join("_")] ?? null }));
    process.exit(0);
  },
};
`;

function fixture(entry: string): Plugin {
  return {
    name: "test:fixture",
    enforce: "pre",
    resolveId(id) {
      if (id === "virtual:ud:catch-all") return entry;
      // Build against the sources under test rather than a previously built dist/.
      if (id === "@universal-deploy/node/serve") return resolve(import.meta.dirname, "serve.ts");
    },
  };
}

describe("built node entry", () => {
  let root: string;
  let outFile: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ud-node-env-"));
    const entry = join(root, "entry.js");
    await writeFile(entry, userEntry);
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [fixture(entry), node({ static: false })],
      environments: {
        ssr: {
          build: { outDir: join(root, "dist") },
          resolve: { noExternal: true },
        },
      },
    });
    const ssr = builder.environments.ssr;
    if (!ssr) throw new Error("Missing ssr environment");
    await builder.build(ssr);
    outFile = join(root, "dist", "index.js");
  }, 60_000);

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function run(nodeEnv: string | undefined) {
    const env = { ...process.env };
    delete env.NODE_ENV;
    if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
    const { stdout } = await execFileAsync(process.execPath, [outFile], { env, timeout: 20_000 });
    const line = stdout.trim().split("\n").at(-1) ?? "";
    return JSON.parse(line) as { atEvaluation: string | null; atReady: string | null };
  }

  it("sets NODE_ENV before the user entry is evaluated", async () => {
    expect(await run(undefined)).toEqual({ atEvaluation: "production", atReady: "production" });
  });

  it("keeps an explicitly provided NODE_ENV", async () => {
    expect(await run("development")).toEqual({ atEvaluation: "development", atReady: "development" });
  });

  it("exits with code 1 when the user entry throws while it loads", async () => {
    const env = { ...process.env, UD_TEST_FAIL_START: "1" };
    await expect(execFileAsync(process.execPath, [outFile], { env, timeout: 4_000 })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("refusing to start"),
    });
  });

  it("exits with code 1 when pending work outlives a failed start", { timeout: 20_000 }, async () => {
    const env = { ...process.env, UD_TEST_FAIL_START: "pending-work" };
    await expect(execFileAsync(process.execPath, [outFile], { env, timeout: 15_000 })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("refusing to start"),
    });
  });

  it.each([
    ["throws", "on-ready"],
    ["rejects", "on-ready-async"],
  ])("stops serving when onReady %s", async (_, mode) => {
    const env = { ...process.env, UD_TEST_FAIL_START: mode };
    const run = execFileAsync(process.execPath, [outFile], { env, timeout: 4_000 });
    const exitCode = run.catch((error) => error.code);
    let stdout = "";
    let stderr = "";
    run.child.stdout?.on("data", (chunk) => (stdout += chunk));
    run.child.stderr?.on("data", (chunk) => (stderr += chunk));
    await vi.waitFor(() => {
      expect(stdout).toContain("http://127.0.0.1:");
      expect(stderr).toContain("refusing to start");
    });
    await expect(fetch(stdout.trim())).rejects.toMatchObject({ cause: { code: "ECONNREFUSED" } });
    expect(await exitCode).toBe(1);
  });

  it("reports a port already in use once and exits with code 1", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = blocker.address() as AddressInfo;
      const env = { ...process.env, UD_TEST_FAIL_START: "port-taken", UD_TEST_PORT: String(port) };
      const error = await execFileAsync(process.execPath, [outFile], { env, timeout: 4_000 }).catch((error) => error);
      expect(error.code).toBe(1);
      expect(error.stderr.match(/EADDRINUSE: address already in use/g)).toHaveLength(1);
    } finally {
      blocker.close();
    }
  });
});
