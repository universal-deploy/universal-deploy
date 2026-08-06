import { createHash } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, posix, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gunzip, gzip } from "node:zlib";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const brotliDecompressAsync = promisify(brotliDecompress);
const gunzipAsync = promisify(gunzip);

export type PrecompressEncoding = "br" | "gzip";

interface Codec {
  /** Suffix of the variant file, and the value srvx is handed to look one up. */
  ext: string;
  encode: (source: Buffer) => Promise<Buffer>;
  decode: (bytes: Buffer) => Promise<Buffer>;
}

/** Everything one encoding needs — suffix, encode, decode — in one entry, checked against
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
    decode: (bytes) => brotliDecompressAsync(bytes),
  },
  gzip: {
    ext: ".gz",
    encode: (source) => gzipAsync(source, { level: constants.Z_BEST_COMPRESSION }),
    decode: (bytes) => gunzipAsync(bytes),
  },
} satisfies Record<PrecompressEncoding, Codec>;

export interface PrecompressOptions {
  /**
   * Encodings to emit, in server-preference order: the first one the client accepts
   * wins. This order is also the order baked into srvx's `encodings` map.
   *
   * @default ["br", "gzip"]
   */
  encodings?: PrecompressEncoding[];
  /**
   * Minimum size, in bytes, of the original file. No upper bound: precompression is
   * the only way to compress a file past srvx's 10 MiB on-the-fly ceiling.
   *
   * @default 1024
   */
  threshold?: number;
}

export interface ResolvedPrecompress {
  encodings: PrecompressEncoding[];
  threshold: number;
}

/**
 * Extensions srvx negotiates an encoding for: the entries of its `COMMON_MIME_TYPES`
 * whose type passes its `isCompressible()`. A variant outside this set can never be
 * served, so emitting one would be dead bytes on disk.
 */
const NEGOTIABLE = new Set([".css", ".htm", ".html", ".js", ".json", ".mjs", ".svg", ".txt", ".wasm", ".xml"]);

// `node:zlib`'s async calls run on libuv's threadpool, which defaults to 4 workers;
// queueing past it buys no parallelism while multiplying peak memory.
const CONCURRENCY = 4;

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

/** Paths under `dir`, relative to it and with `/` separators. */
export async function collectRelativeFiles(dir: string): Promise<Set<string>> {
  const files = await collectFiles(dir);
  return new Set(files.map(relativeTo(dir)));
}

export interface PrecompressContext {
  /** Paths under `publicDir`, relative to the served directory with `/` separators. They
   *  are re-copied from source every build, so their variants are the user's. */
  passThrough?: ReadonlySet<string>;
}

interface Reconciled {
  digest: string;
  /** The configured encodings at the time, so a differently-configured pass cannot hit. */
  under: string;
  /**
   * Digest of the bytes written for each suffix. A configured suffix **absent from this map**
   * was deliberately not written, and a later pass must prove it is still absent — an entry
   * existing is not evidence the entry is ours.
   */
  wrote: ReadonlyMap<string, string>;
}

function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * What this process has already reconciled, by absolute path. Keyed on **content**, never on
 * the path alone: a later environment may rewrite a file an earlier pass handled, and a
 * path-keyed memo would skip it and leave the earlier bytes' variants in place.
 */
const reconciled = new Map<string, Reconciled>();

/**
 * The digests of every configured variant, when each one decodes to exactly the identity
 * beside it — `null` when any is missing, undecodable, or different. Returning the digests
 * rather than a flag lets a directory that was already correct be recorded without a second
 * read: the bytes were in hand anyway.
 */
async function decodesToSource(
  filePath: string,
  source: Buffer,
  resolved: ResolvedPrecompress,
): Promise<Map<string, string> | null> {
  const digests = new Map<string, string>();
  for (const encoding of resolved.encodings) {
    const codec = CODECS[encoding];
    // Unreadable for any reason means not usable as-is — the reconcile loop then deals with it.
    const bytes = await readFile(filePath + codec.ext).catch(() => null);
    if (!bytes || !notLarger(source, bytes)) return null;
    const decoded = await codec.decode(bytes).catch(() => null);
    if (!decoded || !decoded.equals(source)) return null;
    digests.set(codec.ext, digestOf(bytes));
  }
  return digests;
}

/**
 * Whether every configured suffix still matches what the recorded pass left: the same bytes
 * where one was written, and nothing at all where one was not.
 *
 * Both halves are load-bearing. srvx serves an adjacent variant without comparing it to the
 * identity, so a variant that is present-but-altered, or present where reconciliation removed
 * one, is wrong bytes on a live URL. A directory entry existing is not evidence it is ours.
 */
async function matchesRecord(
  filePath: string,
  resolved: ResolvedPrecompress,
  wrote: ReadonlyMap<string, string>,
): Promise<boolean> {
  for (const encoding of resolved.encodings) {
    const suffix = CODECS[encoding].ext;
    // `readIfPresent`, not a swallowing catch: only ENOENT may count as absent. Reading
    // EACCES or EIO as "nothing there" would make the absence proof vacuous on exactly the
    // machines where it matters, and pass every test a healthy filesystem can run.
    const bytes = await readIfPresent(filePath + suffix);
    const expected = wrote.get(suffix);
    if (expected === undefined) {
      if (bytes) return false;
    } else if (!bytes || digestOf(bytes) !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Whether this file's variants are already correct. A memo hit reads each variant and hashes
 * it; a miss decodes them instead. Hashing the stored representation is far cheaper than
 * decompressing it, which is where the saving comes from — not from checking less.
 */
async function isCurrent(filePath: string, source: Buffer, resolved: ResolvedPrecompress): Promise<boolean> {
  const digest = digestOf(source);
  const memo = reconciled.get(filePath);
  if (memo?.digest === digest && memo.under === resolved.encodings.join()) {
    if (await matchesRecord(filePath, resolved, memo.wrote)) return true;
  }

  // For a directory that was already correct, this is the only place an entry is ever written:
  // returning true here makes `processFile` return before reaching its own `remember`. Delete
  // it and that state re-decodes on every later pass, having no other way to be recorded.
  const verified = await decodesToSource(filePath, source, resolved);
  if (verified) remember(filePath, source, resolved, verified);
  return verified !== null;
}

/** Record what these exact bytes reconciled to, so later passes verify by hash rather than by
 *  decode. Only `reconcile` records: it is the one place that knows what was written. */
function remember(
  filePath: string,
  source: Buffer,
  resolved: ResolvedPrecompress,
  wrote: ReadonlyMap<string, string>,
): void {
  reconciled.set(filePath, { digest: digestOf(source), under: resolved.encodings.join(), wrote });
}

/** Whether the variants beside this file are ours to write and remove. */
function ownsVariantsFor(filePath: string, relPath: string, context: PrecompressContext): boolean {
  if (!NEGOTIABLE.has(extname(filePath).toLowerCase())) return false;
  return !context.passThrough?.has(relPath);
}

/** Write the variants this build owes and remove the ones it does not, returning the suffixes
 *  written. */
async function reconcile(
  filePath: string,
  source: Buffer,
  eligible: boolean,
  resolved: ResolvedPrecompress,
): Promise<Map<string, string>> {
  const wrote = new Map<string, string>();
  for (const encoding of resolved.encodings) {
    const codec = CODECS[encoding];
    const variantPath = filePath + codec.ext;
    if (eligible) {
      const encoded = await codec.encode(source);
      if (notLarger(source, encoded)) {
        await writeFile(variantPath, encoded);
        // Digested here, while the buffer is already in hand: free at write time, and it is
        // what lets a later pass verify by hash instead of by decode.
        wrote.set(codec.ext, digestOf(encoded));
        continue;
      }
    }
    // A leftover beside a changed file is how stale bytes get served, so a retire that
    // fails is not swallowed: it stops the build.
    await rm(variantPath, { force: true });
  }
  return wrote;
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
  if (eligible && (await isCurrent(filePath, source, resolved))) return 0;

  const wrote = await reconcile(filePath, source, eligible, resolved);
  if (eligible) remember(filePath, source, resolved, wrote);
  return wrote.size;
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
