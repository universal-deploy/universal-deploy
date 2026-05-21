import type { BuildEnvironmentOptions, Plugin } from "vite";

/**
 * A generic target plugin that overrides the server entry with a custom wrapper.
 */
export default function target(entry: string): Plugin {
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
    transform(code, id) {
      if (resolvedEntry && id === resolvedEntry) {
        if (!code.includes("virtual:ud:")) {
          this.warn(
            `The defined UD wrapper "${entry}" does not seem to import any "virtual:ud:" entries.`
          );
        }
      }
    },
  };
}
