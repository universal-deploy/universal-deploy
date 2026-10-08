import { catchAllEntry } from "@universal-deploy/store";
import type { BuildEnvironmentOptions, Plugin } from "vite";

/**
 * A generic target plugin that overrides the server entry with a custom entry.
 *
 * @param catchAll whether the entry forwards requests to `virtual:ud:catch-all` (default: `true`)
 */
export default function target(entry: string, { catchAll = true }: { catchAll?: boolean } = {}): Plugin {
  let resolvedEntry: string | undefined;
  return {
    name: "ud:target:emit",
    apply: "build",
    config: {
      order: "post",
      handler() {
        const buildEnvOptions: BuildEnvironmentOptions = {};
        if (this.meta?.rolldownVersion) {
          buildEnvOptions.rolldownOptions = {
            input: {
              index: entry,
            },
          };
        } else {
          buildEnvOptions.rollupOptions = {
            input: {
              index: entry,
            },
          };
        }

        return {
          environments: {
            ssr: {
              build: {
                ...buildEnvOptions,
              },
            },
          },
        };
      },
    },
    async buildStart() {
      const resolved = await this.resolve(entry);
      if (resolved) {
        resolvedEntry = resolved.id;
      }
    },
    buildEnd(error) {
      if (error) return;
      // The entry handles requests itself
      if (!catchAll) return;
      const moduleIds = [...this.getModuleIds()];
      // Only check the build that bundles the entry
      if (!resolvedEntry || !moduleIds.includes(resolvedEntry)) return;
      // The entry can import virtual:ud:catch-all directly, or indirectly (e.g. a framework that imports it on the entry's behalf)
      if (!moduleIds.some(isCatchAll)) {
        this.warn(`{ entry: "${entry}" } doesn't import "${catchAllEntry}" (directly or indirectly).`);
      }
    },
  };
}

function isCatchAll(id: string) {
  return id === catchAllEntry || id.startsWith(`${catchAllEntry}?`);
}
