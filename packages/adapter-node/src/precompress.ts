import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, posix, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gunzip, gzip } from "node:zlib";

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

const VARIANT_EXT: Record<PrecompressEncoding, string> = { br: ".br", gzip: ".gz" };

// `node:zlib`'s async calls run on libuv's threadpool, which defaults to 4 workers;
// queueing past it buys no parallelism while multiplying peak memory.
const CONCURRENCY = 4;

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const brotliDecompressAsync = promisify(brotliDecompress);
const gunzipAsync = promisify(gunzip);

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
  return Object.fromEntries(resolved.encodings.map((name) => [name, VARIANT_EXT[name]]));
}

function encode(encoding: PrecompressEncoding, source: Buffer): Promise<Buffer> {
  return encoding === "br"
    ? brotliAsync(source, {
        params: {
          // Build time, once — the whole point of not paying it per request.
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      })
    : gzipAsync(source, { level: constants.Z_BEST_COMPRESSION });
}

function decode(encoding: PrecompressEncoding, bytes: Buffer): Promise<Buffer> {
  return encoding === "br" ? brotliDecompressAsync(bytes) : gunzipAsync(bytes);
}

/**
 * Read a file that may legitimately have vanished since the walk listed it. Only ENOENT is
 * benign: a permission or I/O error means the tree is not what it appears to be, and
 * treating that as "absent" would leave whatever variants are already beside it.
 */
async function readIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The one size rule: a variant may not be larger than its identity. srvx compares nothing,
 * so a larger variant would be served and would make the response bigger — that is the
 * whole hazard, and an equal-sized variant does not cause it: the wire cost is identical
 * and the request still avoids on-the-fly compression. Used both to accept a fresh encode
 * and to accept one already on disk, so the two cannot drift apart.
 */
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

/** Paths under `dir`, relative to it and with `/` separators. */
export async function collectRelativeFiles(dir: string): Promise<Set<string>> {
  const files = await collectFiles(dir);
  const prefix = dir.endsWith(sep) ? dir.length : dir.length + 1;
  return new Set(files.map((file) => file.slice(prefix).split(sep).join(posix.sep)));
}

export interface PrecompressContext {
  /**
   * Paths copied verbatim from `publicDir`, relative to the served directory with `/`
   * separators. Those files are re-copied from source every build, so this build's
   * output can never go stale beside them: their variants are the user's, and are
   * neither emitted nor retired here.
   */
  passThrough?: ReadonlySet<string>;
}

/**
 * Whether every configured variant decodes to exactly the identity beside it.
 *
 * Only the decoded bytes decide. File metadata cannot: a timestamp is not a content
 * correspondence, and a cache restore, an archive extraction or a timestamp-preserving
 * copy can leave a changed identity whose mtime still predates its variant. Trusting that
 * would serve the old body under the new file's URL — the hazard this walk exists to
 * prevent, not an optimization. A missing variant, a decode failure, or any difference
 * means reconcile.
 */
async function isCurrent(filePath: string, source: Buffer, resolved: ResolvedPrecompress): Promise<boolean> {
  for (const encoding of resolved.encodings) {
    // Unreadable for any reason means not usable as-is; the reconcile path below then
    // deals with it and reports accurately if it cannot be removed.
    const bytes = await readFile(filePath + VARIANT_EXT[encoding]).catch(() => null);
    if (!bytes || !notLarger(source, bytes)) return false;
    const decoded = await decode(encoding, bytes).catch(() => null);
    if (!decoded || !decoded.equals(source)) return false;
  }
  return true;
}

async function processFile(
  filePath: string,
  relPath: string,
  resolved: ResolvedPrecompress,
  context: PrecompressContext,
): Promise<number> {
  if (!NEGOTIABLE.has(extname(filePath).toLowerCase())) return 0;
  if (context.passThrough?.has(relPath)) return 0;

  const source = await readIfPresent(filePath);
  if (!source) return 0;

  const eligible = source.length >= resolved.threshold;
  // Emission runs once per environment, so a multi-environment build walks the same
  // directory more than once; without this, every later pass re-encodes what the first
  // already did. Eligibility is decided FIRST: a file this build would not compress must
  // reach the reconcile path below, or a variant left by a lower threshold would survive.
  if (eligible && (await isCurrent(filePath, source, resolved))) return 0;

  let written = 0;
  for (const encoding of resolved.encodings) {
    const variantPath = filePath + VARIANT_EXT[encoding];
    if (eligible) {
      const encoded = await encode(encoding, source);
      if (notLarger(source, encoded)) {
        await writeFile(variantPath, encoded);
        written++;
        continue;
      }
    }
    // Anything this build did not write is removed: a leftover beside a file whose
    // contents or eligibility changed is how stale bytes get served. `force` ignores an
    // absent variant and rejects a real failure, which must stop the build.
    await rm(variantPath, { force: true });
  }
  return written;
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
  const prefix = dir.endsWith(sep) ? dir.length : dir.length + 1;

  let next = 0;
  let written = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const filePath = files[next++] as string;
      const relPath = filePath.slice(prefix).split(sep).join(posix.sep);
      const count = await processFile(filePath, relPath, resolved, context);
      written += count;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  return { written };
}
