import { builtinModules, createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import MagicString from "magic-string";
import {
  type BuildEnvironmentOptions,
  defaultClientConditions,
  defaultExternalConditions,
  defaultServerConditions,
  type Environment,
  normalizePath,
  type Plugin,
} from "vite";
import {
  collectRelativeFiles,
  encodingsMap,
  forgetReconciled,
  type PrecompressOptions,
  precompressDir,
  resolvePrecompress,
} from "./precompress.js";

// @ts-expect-error Bun global
const isBun = typeof Bun !== "undefined";
// @ts-expect-error Deno global
const isDeno = typeof Deno !== "undefined";
const re_udNode = /^virtual:ud:node-entry$/;

function findClientOutDir(env: Environment) {
  const envs = Object.values(env.getTopLevelConfig().environments);
  return envs.find((e) => e.consumer === "client")?.build.outDir;
}

/** Absolute path of the directory that will be served, or `undefined` when static
 *  serving is off. Always the **client** environment's directory, whichever environment
 *  is passed — `env` supplies only the shared top-level config and root. Vite leaves
 *  `build.outDir` and a configured path relative to `config.root`, so both are anchored
 *  to it rather than to `process.cwd()`. */
export function resolveStaticDir(env: Environment, configured: string | boolean | undefined): string | undefined {
  if (configured === false) return undefined;
  const path = typeof configured === "string" ? configured : findClientOutDir(env);
  if (path === undefined) return undefined;
  return resolve(env.config.root, path);
}

/** Compute the value baked into `__UD_STATIC__`. Absolute paths pass through —
 *  the user owns them. Otherwise we emit a path relative to the server entry so
 *  the artifact is portable across filesystems.
 *
 *  Derives from `resolveStaticDir` so the directory precompression walks and the
 *  directory the server resolves at runtime cannot diverge. */
export function resolveStaticHint(env: Environment, configured: string | boolean | undefined): string | false {
  if (typeof configured === "string" && isAbsolute(configured)) return normalizePath(configured);
  const abs = resolveStaticDir(env, configured);
  if (abs === undefined) return false;
  const serverOutDir = resolve(env.config.root, env.config.build.outDir);
  // POSIX-style embedded path so a Windows build runs on POSIX too.
  return normalizePath(relative(serverOutDir, abs)) || ".";
}

// Creates a server and listens for connections in Node/Deno/Bun
export function node(options?: {
  static?: string | boolean;
  importer?: string;
  /**
   * Emit `.br`/`.gz` variants of the served static assets at build time and serve
   * them instead of compressing on every request.
   *
   * @default false
   */
  precompress?: boolean | PrecompressOptions;
}): Plugin[] {
  const precompress = resolvePrecompress(options?.precompress);
  return [
    // Resolves virtual:ud:node-entry to its node runtime id
    {
      name: "ud:node:entry",
      apply: "build",

      resolveId: {
        filter: {
          id: re_udNode,
        },
        async handler(id, importer) {
          let importerResolvedId: string | undefined;
          if (options?.importer) {
            const importerResolved = await this.resolve(options.importer);
            importerResolvedId = importerResolved?.id;
          }

          const resolved = await this.resolve("@universal-deploy/node/serve", importerResolvedId ?? importer);
          if (!resolved) {
            try {
              // Use node resolution to find a sub dependency
              const require = createRequire(import.meta.url);
              const entry = require.resolve("@universal-deploy/node/serve");

              return {
                id: entry,
              };
            } catch {
              throw new Error(`Cannot find server entry ${JSON.stringify(id)}`);
            }
          }

          return {
            id: resolved.id,
          };
        },
      },

      transform: {
        filter: {
          code: [/__UD_STATIC__/, /__UD_PROD__/, /__UD_ENCODINGS__/],
        },
        handler(code) {
          const s = new MagicString(code);
          s.replace(/__UD_STATIC__/g, JSON.stringify(resolveStaticHint(this.environment, options?.static)));
          s.replace(/__UD_PROD__/g, JSON.stringify(true));
          // Derived from the same resolved object that drives emission, so the suffixes
          // served and the suffixes written cannot disagree.
          s.replace(/__UD_ENCODINGS__/g, JSON.stringify(precompress ? encodingsMap(precompress) : false));
          if (s.hasChanged()) {
            return {
              code: s.toString(),
              map: s.generateMap({ hires: true }),
            };
          }
        },
      },
    },
    // Emit precompressed variants beside the static assets, once they are on disk.
    // Runs at EVERY environment's `closeBundle`, not just the client's: a framework may
    // write more servable files from a later environment — vike pre-renders HTML inside
    // the ssr environment's `writeBundle` — and those would otherwise never be seen.
    // A later pass still walks; what it skips is re-encoding what this build already did.
    {
      name: "ud:node:precompress",
      apply: "build",
      // The memo records which source and configuration this build already reconciled, and a
      // later build may empty the output directory, so a record that outlived a build would
      // describe files that are gone.
      // `configResolved` fires before any environment's `buildStart`, so clearing here resets
      // between builds without clearing between the client and ssr passes of one.
      configResolved() {
        forgetReconciled();
      },
      // No `applyToEnvironment`: emission is not scoped to one environment. Excluding any
      // environment would drop the files it alone writes — vike pre-renders HTML inside the
      // ssr environment — and nothing later would ever look at them.
      closeBundle: {
        // Runs after the default-order `closeBundle` hooks, so files they write are in the
        // walk. (`sequential` adds nothing: rolldown runs every hook sequentially already,
        // and deprecates the option.)
        order: "post",
        async handler() {
          if (!precompress) return;
          // The client's directory in every pass, including the ssr one — the walk targets
          // what is served, not what the current environment emitted.
          const dir = resolveStaticDir(this.environment, options?.static);
          if (dir === undefined) return;

          const { publicDir, build } = this.environment.config;
          // Pass-throughs are re-copied from source every build, so their variants are
          // the user's: neither emitted nor retired here.
          const passThrough = build.copyPublicDir && publicDir ? await collectRelativeFiles(publicDir) : undefined;

          const { written } = await precompressDir(dir, precompress, { passThrough });
          // A later environment's pass usually has nothing left to do; stay quiet then.
          if (written > 0) this.environment.logger.info(`precompressed ${written} variants`);
        },
      },
    },
    // Bun and Deno conditions
    {
      name: "ud:node:node-like",
      configEnvironment(_name, config) {
        const defaultCondition = config.consumer === "client" ? defaultClientConditions : defaultServerConditions;
        const additionalCondition = isBun ? ["bun"] : isDeno ? ["deno"] : [];

        return {
          resolve: {
            conditions: [...additionalCondition, ...defaultCondition],
            externalConditions: [...additionalCondition, ...defaultExternalConditions],
          },
        };
      },
    },
    // Emit the node entry
    {
      name: "ud:node:emit",
      apply: "build",
      config: {
        order: "post",
        handler() {
          const buildEnvOptions: BuildEnvironmentOptions = {};
          if (this.meta.rolldownVersion) {
            buildEnvOptions.rolldownOptions = {
              input: {
                index: "virtual:ud:node-entry",
              },
              output: {
                // Avoids circular references when using dynamic imports
                codeSplitting: {
                  groups: [{ name: "srvx", test: /node_modules[\\/]srvx/ }],
                },
              },
            };
          } else {
            buildEnvOptions.rollupOptions = {
              input: {
                index: "virtual:ud:node-entry",
              },
              output: {
                manualChunks(id) {
                  if (/node_modules[\\/]srvx/.test(id)) {
                    return "srvx";
                  }

                  return null;
                },
              },
            };
          }

          return {
            environments: {
              ssr: {
                build: {
                  ...buildEnvOptions,
                },
                resolve: {
                  // Do not mark import("@universal-deploy/node/server") as external as it contains a virtual module
                  noExternal: ["@universal-deploy/node"],
                },
              },
            },
            resolve: {
              // Ensure that all native node modules start with `node:`, mostly for Deno compat
              alias: Object.fromEntries(
                builtinModules.filter((m) => !m.startsWith("node:")).map((m) => [m, `node:${m}`]),
              ),
            },
          };
        },
      },
    },
  ];
}

export type { PrecompressEncoding, PrecompressOptions } from "./precompress.js";

export default node;
