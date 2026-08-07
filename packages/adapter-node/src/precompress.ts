import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, posix, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

export type PrecompressEncoding = "br" | "gzip";

export interface PrecompressOptions {
  /**
   * Encodings to emit, in server-preference order: the first one the client accepts
   * wins. This order is also the order baked into srvx's `encodings` map.
   *
   * @default ["br", "gzip"]
   */
  encodings?: PrecompressEncoding[];
  /**
   * Minimum size, in bytes, of the original file. No upper bound — unlike srvx's on-the-fly
   * path, precompression has no 10 MiB ceiling.
   *
   * @default 1024
   */
  threshold?: number;
}

export interface ResolvedPrecompress {
  encodings: PrecompressEncoding[];
  threshold: number;
}

export interface PrecompressContext {
  /** Paths under `publicDir`, relative to the served directory with `/` separators. They
   *  are re-copied from source every build, so their variants are the user's. */
  passThrough?: ReadonlySet<string>;
}

/**
 * Emit `.br`/`.gz` variants beside the eligible files under `dir`, and retire the
 * current encodings' variants beside the ones that got none.
 */
export async function precompressDir(
  dir: string,
  resolved: ResolvedPrecompress,
  context: PrecompressContext = {},
): Promise<{ written: number }> {
  const files = await collectFiles(dir);
  const toRelative = relativeTo(dir);

  // One cursor shared by every worker, so each file is handed out exactly once.
  const queue = files[Symbol.iterator]();
  let written = 0;
  const worker = async (): Promise<void> => {
    for (const filePath of queue) {
      const count = await processFile(filePath, toRelative(filePath), resolved, context);
      written += count;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  return { written };
}

/** `undefined` when precompression is off — the single off-switch. */
export function resolvePrecompress(
  configured: boolean | PrecompressOptions | undefined,
): ResolvedPrecompress | undefined {
  if (!configured) return undefined;
  const options = configured === true ? {} : configured;
  return {
    // Deduplicated, insertion-ordered: a repeated encoding would re-encode and rewrite
    // the same path and inflate the reported count, while `encodingsMap` collapses it anyway.
    encodings: [...new Set<PrecompressEncoding>(options.encodings ?? ["br", "gzip"])],
    threshold: options.threshold ?? 1024,
  };
}

/**
 * The `encodings` map handed to srvx. Insertion order is srvx's server preference and
 * beats the client's `Accept-Encoding` order, so it must follow `encodings`.
 */
export function encodingsMap(resolved: ResolvedPrecompress): Record<string, string> {
  return Object.fromEntries(resolved.encodings.map((name) => [name, CODECS[name].ext]));
}

/** Paths under `dir`, relative to it and with `/` separators. */
export async function collectRelativeFiles(dir: string): Promise<Set<string>> {
  const files = await collectFiles(dir);
  return new Set(files.map(relativeTo(dir)));
}

async function processFile(
  filePath: string,
  relPath: string,
  resolved: ResolvedPrecompress,
  context: PrecompressContext,
): Promise<number> {
  if (!ownsVariantsFor(filePath, relPath, context)) return 0;

  const source = await readIfPresent(filePath);
  if (!source) return 0;

  const eligible = source.length >= resolved.threshold;
  // Eligibility first: an ineligible file must reach `reconcile`, or a variant left by a
  // lower threshold would survive.
  const record = eligible ? recordOf(source, resolved) : undefined;
  if (record !== undefined && reconciled.get(filePath) === record) return 0;

  const written = await reconcile(filePath, source, eligible, resolved);
  if (record !== undefined) reconciled.set(filePath, record);
  return written;
}

/** Whether the variants beside this file are ours to write and remove. */
function ownsVariantsFor(filePath: string, relPath: string, context: PrecompressContext): boolean {
  if (!NEGOTIABLE.has(extname(filePath).toLowerCase())) return false;
  return !context.passThrough?.has(relPath);
}

/** Write the variants this build owes and remove the ones it does not, returning how many were
 *  written. */
async function reconcile(
  filePath: string,
  source: Buffer,
  eligible: boolean,
  resolved: ResolvedPrecompress,
): Promise<number> {
  let written = 0;
  for (const encoding of resolved.encodings) {
    const codec = CODECS[encoding];
    const variantPath = filePath + codec.ext;
    if (eligible) {
      const encoded = await codec.encode(source);
      if (notLarger(source, encoded)) {
        await writeFile(variantPath, encoded);
        written++;
        continue;
      }
    }
    // A leftover beside a changed file is how stale bytes get served, so a retire that
    // fails is not swallowed: it stops the build.
    await rm(variantPath, { force: true });
  }
  return written;
}

/** Every file under `dir`, as absolute paths. Nothing is filtered here — extensions are
 *  a per-file decision, never a traversal filter. */
async function collectFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      // A directory can vanish mid-walk; anything else means the listing is not trustworthy.
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(full);
    }
  };
  await walk(dir);
  return found;
}

/** Maps absolute paths under `dir` to `dir`-relative, `/`-separated ones. */
function relativeTo(dir: string): (file: string) => string {
  const prefix = dir.endsWith(sep) ? dir.length : dir.length + 1;
  return (file) => file.slice(prefix).split(sep).join(posix.sep);
}

/** A file can vanish between the walk listing it and this read. Only ENOENT is benign —
 *  reading any other error as "absent" would leave the variants beside it in place. */
async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** srvx compares no sizes: whatever variant is on disk is what it serves. */
function notLarger(source: Buffer, variant: Buffer): boolean {
  return variant.length <= source.length;
}

function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** What a pass records for a file: the source bytes it reconciled, under the configuration it
 *  reconciled them for. A differently-configured pass owes different variants, so it must miss. */
function recordOf(source: Buffer, resolved: ResolvedPrecompress): string {
  return `${digestOf(source)}\0${resolved.encodings.join()}`;
}

const brotliAsync = promisify(brotliCompress);

const gzipAsync = promisify(gzip);

interface Codec {
  /** Suffix of the variant file, and the value srvx is handed to look one up. */
  ext: string;
  encode: (source: Buffer) => Promise<Buffer>;
}

/** Everything one encoding needs — suffix and encoder — in one entry, checked against
 *  `PrecompressEncoding` so the table and the union cannot disagree. */
const CODECS = {
  br: {
    ext: ".br",
    encode: (source) =>
      brotliAsync(source, {
        params: {
          // Build time, once — the whole point of not paying it per request.
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      }),
  },
  gzip: {
    ext: ".gz",
    encode: (source) => gzipAsync(source, { level: constants.Z_BEST_COMPRESSION }),
  },
} satisfies Record<PrecompressEncoding, Codec>;

/**
 * Extensions srvx negotiates an encoding for: the entries of its `COMMON_MIME_TYPES`
 * whose type passes its `isCompressible()`. A variant outside this set can never be
 * served, so emitting one would be dead bytes on disk.
 */
const NEGOTIABLE = new Set([".css", ".htm", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".wasm", ".xml"]);

// `node:zlib`'s async calls run on libuv's threadpool, which defaults to 4 workers;
// queueing past it buys no parallelism while multiplying peak memory.
const CONCURRENCY = 4;

/**
 * What this build has already reconciled, by absolute path. Keyed on **content**, never on
 * the path alone: a later environment may rewrite a file an earlier pass handled, and a
 * path-keyed memo would skip it and leave the earlier bytes' variants in place.
 */
const reconciled = new Map<string, string>();

/** A later build may empty the output directory, so a record that outlived one would describe
 *  files that are gone. Cleared during config resolution, before any environment `buildStart`. */
export function forgetReconciled(): void {
  reconciled.clear();
}
