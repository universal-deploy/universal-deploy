import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from "node:zlib";
import { staticMiddleware } from "srvx/static";
import type { Environment } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodingsMap, precompressDir, type ResolvedPrecompress, resolvePrecompress } from "./precompress.js";
import { type ResolvedStaticOptions, resolveStaticOptions } from "./static-options.js";
import { resolveStaticDir, resolveStaticHint } from "./vite.js";

/**
 * Vite 8 leaves `build.outDir` relative to `config.root`, so a resolver that anchors
 * either operand to `process.cwd()` addresses a different tree whenever the build runs
 * from elsewhere (`vite build --root <subdir>`). The incumbent `vite.spec.ts` covers the
 * layout matrix at the hint interface, but only with absolute outDirs, where the anchor
 * is the identity and this regression is invisible.
 */
it("walker and server address one directory when config.root is not the cwd", () => {
  const root = resolve(process.cwd(), "..", "ud-fixture-root");
  const env = {
    config: { root, build: { outDir: "dist/server" } },
    getTopLevelConfig: () => ({ environments: {} }),
  } as unknown as Environment;

  const walked = resolveStaticDir(env, "dist/client");
  const hint = resolveStaticHint(env, "dist/client");

  expect(walked).toBe(resolve(root, "dist/client"));
  expect(hint).toBe("../client");
  // `serve.ts` resolves the hint against the server entry's directory at runtime.
  expect(resolve(resolve(root, "dist/server"), hint as string)).toBe(walked);
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

describe("repeat passes over one directory", () => {
  it("a second pass does no work — emission runs once per environment", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    const first = await precompressDir(dir, ALL);
    const before = (await stat(join(dir, "app.js.br"))).mtimeMs;
    const second = await precompressDir(dir, ALL);
    expect(first.written).toBe(2);
    expect(second.written).toBe(0);
    // Not merely "reported nothing": the file was not rewritten either.
    expect((await stat(join(dir, "app.js.br"))).mtimeMs).toBe(before);
  });

  it("a file written between passes is still covered", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    // What a framework's pre-render does: more servable files appear after the first pass.
    await writeFile(join(dir, "page.html"), COMPRESSIBLE);
    const second = await precompressDir(dir, ALL);
    expect(second.written).toBe(2);
    expect(await exists(join(dir, "page.html.br"))).toBe(true);
  });

  it("reconciles a changed identity whose mtime was preserved below its variant's", async () => {
    const changed = `${COMPRESSIBLE}export const changed = true;\n`;
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    await writeFile(join(dir, "app.js"), changed);
    // A cache restore, an archive extraction or a timestamp-preserving copy leaves the
    // identity older than the variant made from its previous contents. Metadata says
    // "current"; the bytes say otherwise, and the bytes decide.
    const variant = await stat(join(dir, "app.js.br"));
    const backdated = new Date(variant.mtimeMs - 5000);
    await utimes(join(dir, "app.js"), backdated, backdated);
    await precompressDir(dir, ALL);
    expect(brotliDecompressSync(await readFile(join(dir, "app.js.br"))).toString()).toBe(changed);
    expect(gunzipSync(await readFile(join(dir, "app.js.gz"))).toString()).toBe(changed);
  });

  it("retires variants that no longer meet a raised threshold", async () => {
    await writeFile(join(dir, "app.js"), "x".repeat(4096));
    await precompressDir(dir, resolvePrecompress({ threshold: 0 }) as ResolvedPrecompress);
    // The variants still decode to the identity, so byte correspondence alone would keep
    // them — but this build's policy no longer wants them at all.
    await precompressDir(dir, resolvePrecompress({ threshold: 8192 }) as ResolvedPrecompress);
    expect(await exists(join(dir, "app.js.br"))).toBe(false);
    expect(await exists(join(dir, "app.js.gz"))).toBe(false);
  });

  it("replaces a correspondent variant that is not smaller than its identity", async () => {
    const brOnly = resolvePrecompress({ threshold: 0, encodings: ["br"] }) as ResolvedPrecompress;
    await writeFile(join(dir, "tiny.js"), "x");
    // Valid brotli that decodes to the identity, yet larger than it. srvx compares nothing,
    // so serving this would make the response bigger.
    await writeFile(join(dir, "tiny.js.br"), brotliCompressSync(Buffer.from("x")));
    await precompressDir(dir, brOnly);
    expect(await exists(join(dir, "tiny.js.br"))).toBe(false);
  });

  it("the reported count matches the variants actually written", async () => {
    for (let i = 0; i < 10; i++) {
      await writeFile(join(dir, `f${i}.js`), `${COMPRESSIBLE}// ${i}\n`);
    }
    const { written } = await precompressDir(dir, ALL);
    const names = await readdir(dir);
    expect(written).toBe(names.filter((n) => n.endsWith(".br") || n.endsWith(".gz")).length);
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
