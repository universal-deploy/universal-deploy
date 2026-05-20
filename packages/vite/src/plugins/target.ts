import type { BuildEnvironmentOptions, Plugin } from "vite";

/**
 * A generic target plugin that overrides the server entry with a custom wrapper.
 */
export default function target(entry: string): Plugin {
  return {
    name: "ud:target:emit",
    apply: "build",
    config: {
      order: "post",
      handler() {
        const buildEnvOptions: BuildEnvironmentOptions = {};
        if (this.meta.rolldownVersion) {
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
  };
}