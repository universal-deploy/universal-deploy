// Imported by serve.ts, so this module ships inside every built server: it must
// import nothing build-time.
import { resolve } from "node:path";

export interface StaticOptionsInput {
  /** Directory of the running server entry — what a relative hint resolves against. */
  entryDir: string;
  /** `__UD_STATIC__`: the entry-relative hint baked at build time, or `false`. */
  bakedStatic: string | false;
  /** The server entry's own `static`, which overrides the baked hint. */
  runtimeStatic: string | boolean | undefined;
  /** `__UD_ENCODINGS__`: the variant suffixes this build emitted, or `false`. */
  encodings: Record<string, string> | false;
}

export interface ResolvedStaticOptions {
  dir: string;
  encodings?: Record<string, string>;
}

/** Whether to serve static files, from where, and whether variants may be looked up. */
export function resolveStaticOptions(input: StaticOptionsInput): ResolvedStaticOptions | undefined {
  const { entryDir, bakedStatic, runtimeStatic, encodings } = input;

  const dir = servedDir(entryDir, bakedStatic, runtimeStatic);
  if (dir === undefined) return undefined;

  const serveVariants = encodings && servesThisBuildsOutput(entryDir, bakedStatic, dir);
  return serveVariants ? { dir, encodings } : { dir };
}

/** Absolute directory to serve, or `undefined` when static serving is off. The server
 *  entry's own `static` overrides the hint baked at build time. */
function servedDir(entryDir: string, baked: string | false, runtime: string | boolean | undefined): string | undefined {
  const effective = runtime ?? baked;
  if (typeof effective !== "string") return undefined;
  return resolve(entryDir, effective);
}

/** Whether `dir` is the directory this build precompressed. Both sides resolve at runtime
 *  from `entryDir`, so a relocated build still compares equal. */
function servesThisBuildsOutput(entryDir: string, baked: string | false, dir: string): boolean {
  return typeof baked === "string" && dir === resolve(entryDir, baked);
}
