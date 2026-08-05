import { resolve } from "node:path";
import type { Environment } from "vite";
import { describe, expect, it } from "vitest";
import { resolveStaticDir, resolveStaticHint } from "./vite.js";

/**
 * Vite 8 leaves `build.outDir` **relative to `config.root`** — in `configResolved`,
 * per-environment, and in `getTopLevelConfig().environments`. This stub models that
 * shape; `vite.spec.ts`'s older stub passes absolute outDirs, which Vite never produces.
 */
function makeEnv(opts: { root: string; serverOutDir: string; clientOutDir?: string }): Environment {
  const envs: Record<string, { consumer: string; build: { outDir: string } }> = {
    ssr: { consumer: "server", build: { outDir: opts.serverOutDir } },
  };
  if (opts.clientOutDir !== undefined) {
    envs.client = { consumer: "client", build: { outDir: opts.clientOutDir } };
  }
  return {
    config: { root: opts.root, build: { outDir: opts.serverOutDir } },
    getTopLevelConfig: () => ({ environments: envs }),
  } as unknown as Environment;
}

/**
 * A root that is deliberately NOT `process.cwd()`. Anything anchored to the cwd instead
 * of to `config.root` resolves somewhere else entirely from here.
 */
const ROOT = resolve(process.cwd(), "..", "ud-fixture-root");

describe("resolveStaticDir", () => {
  it("anchors a relative client outDir to config.root, not to process.cwd()", () => {
    const env = makeEnv({ root: ROOT, serverOutDir: "dist/server", clientOutDir: "dist/client" });
    expect(resolveStaticDir(env, undefined)).toBe(resolve(ROOT, "dist/client"));
  });

  it("anchors a relative configured path to config.root", () => {
    const env = makeEnv({ root: ROOT, serverOutDir: "dist/server" });
    expect(resolveStaticDir(env, "public-assets")).toBe(resolve(ROOT, "public-assets"));
  });

  it("returns undefined when static serving is off", () => {
    const env = makeEnv({ root: ROOT, serverOutDir: "dist/server", clientOutDir: "dist/client" });
    expect(resolveStaticDir(env, false)).toBeUndefined();
  });

  it("returns undefined when no client environment exists and nothing is configured", () => {
    const env = makeEnv({ root: ROOT, serverOutDir: "dist/server" });
    expect(resolveStaticDir(env, undefined)).toBeUndefined();
  });
});

describe("resolveStaticHint with a relative outDir", () => {
  it("is independent of process.cwd() for a configured path", () => {
    const env = makeEnv({ root: ROOT, serverOutDir: "dist/server" });
    expect(resolveStaticHint(env, "dist/client")).toBe("../client");
  });

  it("is independent of process.cwd() for an auto-detected client outDir", () => {
    const env = makeEnv({ root: ROOT, serverOutDir: "dist/server", clientOutDir: "dist/client" });
    expect(resolveStaticHint(env, undefined)).toBe("../client");
  });
});

/**
 * The property U2 exists for: the directory precompression walks and the directory the
 * built server resolves at runtime are the same path. `serve.ts` computes the latter as
 * `resolve(<dir of the server entry>, hint)`, which is the server outDir at runtime.
 */
describe("walker and server agree on one directory", () => {
  const cases: Array<[string, string | boolean | undefined, string, string?]> = [
    ["auto-detected sibling", undefined, "dist/server", "dist/client"],
    ["configured relative path", "dist/client", "dist/server", "dist/client"],
    ["configured path outside the build tree", "../shared/static", "dist/server", "dist/client"],
    ["nested server outDir", undefined, "dist/nested/server", "dist/nested/client"],
    ["same directory for both", undefined, "dist", "dist"],
  ];

  for (const [name, configured, serverOutDir, clientOutDir] of cases) {
    it(name, () => {
      const env = makeEnv({ root: ROOT, serverOutDir, clientOutDir });
      const walked = resolveStaticDir(env, configured);
      const hint = resolveStaticHint(env, configured);
      expect(hint).not.toBe(false);
      const servedAtRuntime = resolve(resolve(ROOT, serverOutDir), hint as string);
      expect(servedAtRuntime).toBe(walked);
    });
  }

  it("holds for an absolute configured path, from any runtime location", () => {
    const abs = resolve(ROOT, "var", "www", "static");
    const env = makeEnv({ root: ROOT, serverOutDir: "dist/server" });
    const hint = resolveStaticHint(env, abs);
    expect(resolve("/somewhere/else/entirely", hint as string)).toBe(resolveStaticDir(env, abs));
  });
});
