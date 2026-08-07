import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, gunzipSync } from "node:zlib";
import { staticMiddleware } from "srvx/static";
import type { Environment } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodingsMap,
  forgetReconciled,
  precompressDir,
  type ResolvedPrecompress,
  resolvePrecompress,
} from "./precompress.js";
import { type ResolvedStaticOptions, resolveStaticOptions } from "./static-options.js";
import { node, resolveStaticDir, resolveStaticHint } from "./vite.js";

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

/** Deterministic bytes that neither brotli nor gzip can shrink. A linear generator is
 *  not enough — its output still compresses by roughly a third. */
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

/** Absence, and only absence. A permission or I/O error would otherwise read as "not
 *  there" and let a negative assertion pass without the file being gone. */
const exists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

/** A second instance of the module under test: the query makes the loader treat it as a distinct
 *  specifier, which is what a second copy on disk is. */
function loadSecondCopy(): Promise<typeof import("./precompress.js")> {
  const distinctSpecifier = "./precompress.js?copy=2";
  return import(distinctSpecifier);
}

async function request(options: ResolvedStaticOptions, encoding: string) {
  const middleware = staticMiddleware(options);
  return middleware(
    new Request("http://x/app.js", { headers: { "accept-encoding": encoding } }),
    () => new Response(null, { status: 404 }),
  );
}

describe("precompress emission", () => {
  it("emits a variant smaller than its identity", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    const identity = await stat(join(dir, "app.js"));
    const variant = await stat(join(dir, "app.js.br"));
    expect(variant.size).toBeLessThan(identity.size);
  });

  it("skips an extension srvx never negotiates", async () => {
    await writeFile(join(dir, "app.js.map"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "app.js.map.br"))).toBe(false);
  });
});

describe("encodings order and selection", () => {
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

describe("serving", () => {
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

describe("repeat passes over one directory", () => {
  it("a second pass does no work — emission runs once per environment", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    const first = await precompressDir(dir, ALL);
    // Backdate the variant far outside timer resolution, then read back what the filesystem
    // actually stored — comparing that to a clock reading would assert a conversion, not the
    // property. A rewrite replaces it with "now", a minute away from any granularity.
    const fresh = (await stat(join(dir, "app.js.br"))).mtimeMs;
    const sentinel = new Date(Date.now() - 60_000);
    await utimes(join(dir, "app.js.br"), sentinel, sentinel);
    const backdated = (await stat(join(dir, "app.js.br"))).mtimeMs;
    // The margin everything below rests on. Had `utimes` not taken, `backdated` would be
    // the first pass's own mtime and a rewrite inside granularity would compare equal.
    expect(fresh - backdated).toBeGreaterThan(30_000);
    const second = await precompressDir(dir, ALL);
    expect(first.written).toBe(2);
    expect(second.written).toBe(0);
    expect((await stat(join(dir, "app.js.br"))).mtimeMs).toBe(backdated);
  });

  it("a pass configured with more encodings does not hit an earlier pass's memo", async () => {
    const brOnly = resolvePrecompress({ encodings: ["br"] }) as ResolvedPrecompress;
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, brOnly);
    expect(await exists(join(dir, "app.js.gz"))).toBe(false);
    // Same bytes, so the digest matches; only the recorded configuration separates them.
    const second = await precompressDir(dir, ALL);
    expect(second.written).toBe(2);
    expect(await exists(join(dir, "app.js.gz"))).toBe(true);
  });

  it("emits again for a second build in the same process", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    const first = await precompressDir(dir, ALL);
    expect(first.written).toBe(2);

    // Models a second `vite.build()` in one process, where the output directory was emptied and
    // byte-identical sources rebuilt. The sources are back and their digests still match, while
    // the variants beside them are gone — so without the reset the whole tree is skipped and
    // nothing is emitted.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    forgetReconciled();

    const second = await precompressDir(dir, ALL);
    expect(second.written).toBe(2);
    expect(await exists(join(dir, "app.js.br"))).toBe(true);
    expect(await exists(join(dir, "app.js.gz"))).toBe(true);
  });

  it("a second copy of this module shares the memo", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    expect((await precompressDir(dir, ALL)).written).toBe(2);

    // What dual resolution or two installed versions produce: another instance of this module,
    // with its own module scope. A memo living there re-encodes what this pass just wrote.
    const copy = await loadSecondCopy();
    expect((await copy.precompressDir(dir, ALL)).written).toBe(0);
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
    // The source is unchanged, so the record still matches it — but eligibility is decided
    // before the record is consulted, and this build's policy no longer wants them at all.
    // This is the only control on that ordering: invert it and every other test still passes.
    await precompressDir(dir, resolvePrecompress({ threshold: 8192 }) as ResolvedPrecompress);
    expect(await exists(join(dir, "app.js.br"))).toBe(false);
    expect(await exists(join(dir, "app.js.gz"))).toBe(false);
  });

  it("keeps a variant exactly the same size as its identity", async () => {
    const brOnly = resolvePrecompress({ threshold: 0, encodings: ["br"] }) as ResolvedPrecompress;
    // Boundary witness: brotli q11 encodes 10 repeated bytes to exactly 10 bytes. The
    // hazard is a *larger* variant; an equal one costs the same on the wire and still
    // spares the server an on-the-fly encode.
    await writeFile(join(dir, "app.js"), "a".repeat(10));
    const { written } = await precompressDir(dir, brOnly);
    expect((await stat(join(dir, "app.js.br"))).size).toBe((await stat(join(dir, "app.js"))).size);
    expect(written).toBe(1);
  });

  it("replaces a correspondent variant that is larger than its identity", async () => {
    const brOnly = resolvePrecompress({ threshold: 0, encodings: ["br"] }) as ResolvedPrecompress;
    await writeFile(join(dir, "tiny.js"), "x");
    // Valid brotli that decodes to the identity, yet larger than it. srvx compares nothing,
    // so serving this would make the response bigger.
    await writeFile(join(dir, "tiny.js.br"), brotliCompressSync(Buffer.from("x")));
    await precompressDir(dir, brOnly);
    expect(await exists(join(dir, "tiny.js.br"))).toBe(false);
  });

  it("a repeated encoding is emitted once", async () => {
    const duplicated = resolvePrecompress({ encodings: ["br", "br"] }) as ResolvedPrecompress;
    expect(duplicated.encodings).toEqual(["br"]);
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    const { written } = await precompressDir(dir, duplicated);
    expect(written).toBe(1);
    expect(Object.keys(encodingsMap(duplicated))).toEqual(["br"]);
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

describe("retiring variants this build did not write", () => {
  it("retires a variant this build did not emit", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "app.js.br"))).toBe(true);
    // The same path stops being compressible: the old variant must not survive.
    await writeFile(join(dir, "app.js"), incompressible(2048));
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "app.js.br"))).toBe(false);
    expect(await exists(join(dir, "app.js.gz"))).toBe(false);
  });

  it("leaves an orphan variant alone: iteration goes identity to variant", async () => {
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await writeFile(join(dir, "orphan.js.br"), "not ours");
    await precompressDir(dir, ALL);
    expect(await exists(join(dir, "orphan.js.br"))).toBe(true);
  });

  it("leaves a suffix outside this build's encodings untouched", async () => {
    const brOnly = resolvePrecompress({ encodings: ["br"] }) as ResolvedPrecompress;
    const leftover = "from a build that had gzip on";
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await writeFile(join(dir, "app.js.gz"), leftover);
    await precompressDir(dir, brOnly);
    // Neither retired nor rewritten: srvx never probes a suffix outside the baked map.
    expect(await readFile(join(dir, "app.js.gz"), "utf8")).toBe(leftover);
  });

  it("never touches a publicDir pass-through variant", async () => {
    const userOwned = "user supplied, deliberately not matching";
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await writeFile(join(dir, "app.js.br"), userOwned);
    await precompressDir(dir, ALL, { passThrough: new Set(["app.js"]) });
    expect(await readFile(join(dir, "app.js.br"), "utf8")).toBe(userOwned);
  });

  it("fails the build when a variant cannot be removed", async () => {
    await writeFile(join(dir, "app.js"), incompressible(2048));
    // A directory where a variant would be retired: non-recursive rm rejects.
    await mkdir(join(dir, "app.js.br"));
    await writeFile(join(dir, "app.js.br", "blocker.txt"), "blocks rm");
    // The build must stop: a variant that cannot be removed would be served as this
    // file's body. The rejection is Node's own; the product promise is that it propagates.
    await expect(precompressDir(dir, ALL)).rejects.toThrow();
  });
});

describe("lookup is enabled only for the reconciled directory", () => {
  const encodings: Record<string, string> = { br: ".br" };
  const entryDir = resolve("/srv/app/dist/server");

  it("the same resolved directory retains lookup", () => {
    const options = resolveStaticOptions({
      entryDir,
      bakedStatic: "../client",
      runtimeStatic: undefined,
      encodings,
    });
    expect(options).toEqual({ dir: resolve(entryDir, "../client"), encodings });
  });

  it("the same directory spelled differently at runtime still retains lookup", () => {
    const options = resolveStaticOptions({
      entryDir,
      bakedStatic: "../client",
      runtimeStatic: "./../client",
      encodings,
    });
    expect(options?.encodings).toEqual(encodings);
  });

  it("a disabled lookup serves the identity, not a planted stale variant", async () => {
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

  it("no baked directory means no reconciled tree, so no lookup", () => {
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
});

describe("the emission pass sees everything the build wrote", () => {
  interface PrecompressPlugin {
    applyToEnvironment?: unknown;
    configResolved: () => void;
    closeBundle: { order?: string; handler: (this: unknown) => Promise<void> };
  }

  function plugin(): PrecompressPlugin {
    const found = node({ precompress: true }).find((p) => p.name === "ud:node:precompress");
    if (!found) throw new Error("no ud:node:precompress plugin");
    return found as unknown as PrecompressPlugin;
  }

  /** What Vite binds as `this` for one environment's `closeBundle` — only the parts the
   *  handler reads. `served` is both the root and the client environment's outDir, so the
   *  resolver lands on it. */
  function dispatch(served: string) {
    return {
      environment: {
        name: "ssr",
        config: { root: served, publicDir: false, build: { outDir: ".", copyPublicDir: false } },
        getTopLevelConfig: () => ({ environments: { client: { consumer: "client", build: { outDir: "." } } } }),
        logger: { info: () => {} },
      },
    };
  }

  it("runs after the default-order closeBundle hooks, so their files are in the walk", () => {
    // Hook-local, and this plugin owns one hook — `enforce` would scope the same property
    // plugin-wide, which is broader than the property needs.
    expect(plugin().closeBundle.order).toBe("post");
  });

  it("precompresses the served directory during the pass that is not the client's", async () => {
    await writeFile(join(dir, "prerendered.html"), COMPRESSIBLE);
    await plugin().closeBundle.handler.call(dispatch(dir));
    // vike writes pre-rendered HTML from the ssr environment. Nothing else walks after it.
    expect(await exists(join(dir, "prerendered.html.br"))).toBe(true);
  });

  it("a second build through the plugin emits again, with no reset from the test", async () => {
    const p = plugin();
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);
    await p.closeBundle.handler.call(dispatch(dir));
    expect(await exists(join(dir, "app.js.br"))).toBe(true);

    // Models a second `vite.build()` that emptied the output directory and rebuilt identical sources.
    // The reset has to come from the plugin's own `configResolved` — this test never calls
    // `forgetReconciled`, so a record surviving the build boundary skips the whole tree.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "app.js"), COMPRESSIBLE);

    p.configResolved();
    await p.closeBundle.handler.call(dispatch(dir));
    expect(await exists(join(dir, "app.js.br"))).toBe(true);
    expect(await exists(join(dir, "app.js.gz"))).toBe(true);
  });

  it("declares no applyToEnvironment, so Vite dispatches it to all of them", () => {
    // Vite's only per-plugin environment filter. The assertion above cannot see it:
    // calling a handler directly bypasses the dispatch that consults it.
    expect(plugin().applyToEnvironment).toBeUndefined();
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
