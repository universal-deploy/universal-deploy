import type { BuildEnvironmentOptions, Plugin } from "vite";

export interface TargetPluginOptions {
  /**
   * The entry point to your custom server implementation.
   * e.g. `'./server/entrypoint.ts'`
   */
  entry: string;
}

/**
 * A generic target plugin that overrides the server entry with a custom wrapper.
 */
export default function target(options: TargetPluginOptions): Plugin[] {
  return [
    {
      name: "ud:target:emit",
      apply: "build",
      config: {
        order: "post",
        handler() {
          const buildEnvOptions: BuildEnvironmentOptions = {};
          if (this.meta?.rolldownVersion) {
            buildEnvOptions.rolldownOptions = {
              input: {
                index: options.entry,
              },
            };
          } else {
            buildEnvOptions.rollupOptions = {
              input: {
                index: options.entry,
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
    },
  ];
}
