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

/**
 * Decide whether to serve static files, from where, and whether precompressed
 * variants may be looked up.
 *
 * Both directories are resolved here, at runtime, from `entryDir` — neither is a
 * build-machine path, so a relocated build (Docker, build-here-serve-there) still
 * compares equal.
 */
export function resolveStaticOptions(input: StaticOptionsInput): ResolvedStaticOptions | undefined {
  const { entryDir, bakedStatic, runtimeStatic, encodings } = input;

  const effective = runtimeStatic ?? bakedStatic;
  // A non-string value — `false`, `true`, or nothing at all — means no static middleware.
  if (typeof effective !== "string") return undefined;
  const dir = resolve(entryDir, effective);

  const bakedDir = typeof bakedStatic === "string" ? resolve(entryDir, bakedStatic) : undefined;
  // Variants are only reconciled in the directory this build walked, so lookup is
  // enabled only there. Comparison is exact: two spellings of one directory fall back
  // to on-the-fly compression rather than risking variants no walk owns.
  const reconciled = bakedDir !== undefined && dir === bakedDir;

  return encodings && reconciled ? { dir, encodings } : { dir };
}
