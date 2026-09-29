import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createBuilder, type Plugin } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { node } from "./vite.js";

const execFileAsync = promisify(execFile);

/**
 * Dependencies such as React pick their development or production build while their module
 * evaluates, so `NODE_ENV` has to be set before the user entry (and everything it imports) runs.
 * The fixture records the value it sees at evaluation time, then exits once the server is ready.
 */
const userEntry = `
const env = globalThis.process.env;
const atEvaluation = env[["NODE", "ENV"].join("_")] ?? null;
export default {
  port: 0,
  hostname: "127.0.0.1",
  silent: true,
  fetch: () => new Response("ok"),
  onReady: () => {
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
});
