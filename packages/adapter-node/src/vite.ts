import { builtinModules, createRequire } from "node:module";
import MagicString from "magic-string";
import {
  type BuildEnvironmentOptions,
  defaultClientConditions,
  defaultExternalConditions,
  defaultServerConditions,
  type Environment,
  type Plugin,
} from "vite";

// @ts-expect-error Bun global
const isBun = typeof Bun !== "undefined";
// @ts-expect-error Deno global
const isDeno = typeof Deno !== "undefined";
const re_udNode = /^virtual:ud:node-entry$/;

function findClientOutDir(env: Environment) {
  const envs = Object.values(env.getTopLevelConfig().environments);
  return envs.find((e) => e.consumer === "client")?.build.outDir;
}

// Creates a server and listens for connections in Node/Deno/Bun
export function node(options?: { static?: string | boolean; importer?: string }): Plugin[] {
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
          code: [/__UD_STATIC__/, /__UD_PROD__/],
        },
        handler(code) {
          const outDir = findClientOutDir(this.environment);

          const s = new MagicString(code);

          s.replace(
            /__UD_STATIC__/g,
            JSON.stringify(
              typeof options?.static === "string" || typeof options?.static === "boolean"
                ? options.static
                : typeof outDir === "string"
                  ? outDir
                  : true,
            ),
          );

          s.replace(/__UD_PROD__/g, JSON.stringify(true));

          if (s.hasChanged()) {
            return {
              code: s.toString(),
              map: s.generateMap({ hires: true }),
            };
          }
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

export default node;
