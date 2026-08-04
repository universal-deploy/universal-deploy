import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { staticMiddleware } from "srvx/static";
import type { Environment } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodingsMap, precompressDir, type ResolvedPrecompress, resolvePrecompress } from "./precompress.js";
import { type ResolvedStaticOptions, resolveStaticOptions } from "./static-options.js";
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

// ── emission, serving, and the F3 retire mechanism ──────────────────────────────

/**
 * Deterministic bytes that neither encoder can shrink — a SHA-256 chain, so no
 * `Math.random` and no fixture file. Measured: brotli q11 and gzip 9 both come out
 * larger than the input. (A linear generator is not enough; its output still
 * compresses by roughly a third.)
 */
function incompressible(length: number): Buffer {
  const chunks: Buffer[] = [];
  let total = 0;
  let block = Buffer.from("ud-precompress");
  while (total < length) {
    block = createHash("sha256").update(block).digest();
    chunks.push(block);
    total += block.length;
  }
  return Buffer.concat(chunks, length);
}

/** Compresses well and is comfortably over the default threshold. */
const COMPRESSIBLE = `export const greeting = ${JSON.stringify("hello ".repeat(900))};\n`;

const ALL = resolvePrecompress(true) as ResolvedPrecompress;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ud-precompress-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function request(options: ResolvedStaticOptions, encoding: string) {
  const middleware = staticMiddleware(options);
  return middleware(
    new Request("http://x/app.js", { headers: { "accept-encoding": encoding } }),
    () => new Response(null, { status: 404 }),
  );
}

describe("precompress emission", () => {
  it("A1 emits a variant smaller than its identity (emission only, not proof of serving)", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    const identity = await stat(join(dir, "app.js"));
    const variant = await stat(join(dir, "app.js.br"));
    expect(variant.size).toBeLessThan(identity.size);
  });

  it("A2 skips an extension srvx never negotiates", async () => {
    await writeFile(join(dir, "app.js.map"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "app.js.map.br"))).toBe(false);
  });

  it("A3 skips an eligible, above-threshold file whose encoding is not smaller", async () => {
    const noise = incompressible(2048);
    await writeFile(join(dir, "noise.txt"), noise);
    expect(noise.byteLength).toBeGreaterThan(ALL.threshold);
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "noise.txt.br"))).toBe(false);
    expect(await exists(join(dir, "noise.txt.gz"))).toBe(false);
  });

  it("A3b skips a file under the threshold", async () => {
    await writeFile(join(dir, "tiny.js"), "export const a = 1;\n");
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "tiny.js.br"))).toBe(false);
  });
});

describe("A4 encodings order and selection", () => {
  it("emits only the configured encoding and bakes only its suffix", async () => {
    const gzipOnly = resolvePrecompress({ encodings: ["gzip"] }) as ResolvedPrecompress;
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, gzipOnly);
    expect(encodingsMap(gzipOnly)).toEqual({ gzip: ".gz" });
    expect(await exists(join(dir, "app.js.gz"))).toBe(true);
    expect(await exists(join(dir, "app.js.br"))).toBe(false);
  });

  it("map insertion order beats the client Accept-Encoding order", async () => {
    const gzipFirst = resolvePrecompress({ encodings: ["gzip", "br"] }) as ResolvedPrecompress;
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, gzipFirst);
    expect(Object.keys(encodingsMap(gzipFirst))).toEqual(["gzip", "br"]);
    const response = await request({ dir, encodings: encodingsMap(gzipFirst) }, "br, gzip");
    expect(response.headers.get("content-encoding")).toBe("gzip");
  });
});

describe("A5 serving", () => {
  it("serves the file on disk, so Content-Length equals its size", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    const variant = await stat(join(dir, "app.js.br"));
    const response = await request({ dir, encodings: encodingsMap(ALL) }, "br");
    expect(response.headers.get("content-encoding")).toBe("br");
    // The discriminator: an on-the-fly encode is chunked and carries no length.
    expect(response.headers.get("content-length")).toBe(String(variant.size));
  });
});

describe("A6 rebuild reconciles variant content", () => {
  it("a changed identity gets a variant of the new bytes", async () => {
    const after = `${COMPRESSIBLE}export const added = ${JSON.stringify("x".repeat(500))};\n`;
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    await writeFile(join(dir, "app.js"), after);
    await precompressDir(dir, ALL);
    const decoded = brotliDecompressSync(await readFile(join(dir, "app.js.br"))).toString();
    expect(decoded).toBe(after);
  });
});

describe("F3 retire", () => {
  it("m5 retires a variant this build did not emit", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "app.js.br"))).toBe(true);
    // The same path stops being compressible: the old variant must not survive.
    await writeFile(join(dir, "app.js"), incompressible(2048));
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "app.js.br"))).toBe(false);
    expect(await exists(join(dir, "app.js.gz"))).toBe(false);
  });

  it("m7 leaves an orphan variant alone, because iteration is identity to variant", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await writeFile(join(dir, "orphan.js.br"), "not ours");
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "orphan.js.br"))).toBe(true);
  });

  it("m6 leaves a suffix outside this build's encodings untouched", async () => {
    const brOnly = resolvePrecompress({ encodings: ["br"] }) as ResolvedPrecompress;
    const leftover = "from a build that had gzip on";
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await writeFile(join(dir, "app.js.gz"), leftover);
    await precompressDir(dir, brOnly);
    // Neither retired nor rewritten: srvx never probes a suffix outside the baked map.
    expect(await readFile(join(dir, "app.js.gz"), "utf8")).toBe(leftover);
  });

  it("m8 never touches a publicDir pass-through variant", async () => {
    const userOwned = "user supplied, deliberately not matching";
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await writeFile(join(dir, "app.js.br"), userOwned);
    await precompressDir(dir, ALL, { passThrough: new Set(["app.js"]) });
    expect(await readFile(join(dir, "app.js.br"), "utf8")).toBe(userOwned);
  });

  it("m9 throws when a variant cannot be removed", async () => {
    await writeFile(join(dir, "app.js"), incompressible(2048));
    // A directory where a variant would be retired: non-recursive rm rejects.
    await mkdir(join(dir, "app.js.br"));
    await writeFile(join(dir, "app.js.br", "blocker.txt"), "blocks rm");
    await expect(precompressDir(dir, ALL)).rejects.toThrow(/could not remove/);
  });
});

describe("PG-4 lookup is enabled only for the reconciled directory", () => {
  const encodings: Record<string, string> = { br: ".br" };
  const entryDir = resolve("/srv/app/dist/server");

  it("A7 the same resolved directory retains lookup", () => {
    const options = resolveStaticOptions({
      entryDir,
      bakedStatic: "../client",
      runtimeStatic: undefined,
      encodings,
    });
    expect(options).toEqual({ dir: resolve(entryDir, "../client"), encodings });
  });

  it("A7b the same directory spelled differently at runtime still retains lookup", () => {
    const options = resolveStaticOptions({
      entryDir,
      bakedStatic: "../client",
      runtimeStatic: "./../client",
      encodings,
    });
    expect(options?.encodings).toEqual(encodings);
  });

  it("A8 a different runtime directory disables lookup", () => {
    const options = resolveStaticOptions({
      entryDir,
      bakedStatic: "../client",
      runtimeStatic: "../other",
      encodings,
    });
    expect(options).toEqual({ dir: resolve(entryDir, "../other") });
  });

  it("A8b a disabled lookup serves the identity, not a planted stale variant", async () => {
    const stale = `export const stale = ${JSON.stringify("STALE".repeat(400))};\n`;
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await writeFile(join(dir, "app.js.br"), Buffer.from(stale));
    // The override tree was never walked, so `encodings` must not be passed.
    const options = resolveStaticOptions({
      entryDir,
      bakedStatic: "../client",
      runtimeStatic: dir,
      encodings,
    });
    expect(options?.encodings).toBeUndefined();
    const response = await request(options as ResolvedStaticOptions, "br");
    const body = Buffer.from(await response.arrayBuffer());
    const decoded =
      response.headers.get("content-encoding") === "br" ? brotliDecompressSync(body).toString() : body.toString();
    expect(decoded).toBe(COMPRESSIBLE);
    expect(decoded).not.toContain("STALE");
  });

  it("A9 no baked directory means no reconciled tree, so no lookup", () => {
    const options = resolveStaticOptions({
      entryDir,
      bakedStatic: false,
      runtimeStatic: "../client",
      encodings,
    });
    expect(options).toEqual({ dir: resolve(entryDir, "../client") });
  });

  it("a non-string effective value yields no static middleware at all", () => {
    for (const runtimeStatic of [false, true, undefined] as const) {
      expect(resolveStaticOptions({ entryDir, bakedStatic: false, runtimeStatic, encodings })).toBeUndefined();
    }
  });

  it("a gzip variant decodes to the identity bytes", async () => {
    const gzipOnly = resolvePrecompress({ encodings: ["gzip"] }) as ResolvedPrecompress;
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, gzipOnly);
    const response = await request({ dir, encodings: encodingsMap(gzipOnly) }, "gzip");
    expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(COMPRESSIBLE);
  });
});

describe("off is inert", () => {
  it("resolvePrecompress returns undefined for every off value", () => {
    for (const off of [undefined, false] as const) expect(resolvePrecompress(off)).toBeUndefined();
  });

  it("encodings default to br then gzip", () => {
    expect(resolvePrecompress(true)?.encodings).toEqual(["br", "gzip"]);
    expect(encodingsMap(resolvePrecompress(true) as ResolvedPrecompress)).toEqual({ br: ".br", gzip: ".gz" });
  });
});
