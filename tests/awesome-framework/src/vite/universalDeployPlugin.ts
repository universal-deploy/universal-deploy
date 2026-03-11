import { addEntry } from "@universal-deploy/store";
import universalDeploy from "@universal-deploy/vite";
import type { Plugin } from "vite";
import type { Options } from "./types.js";

// The vite config file can be loaded multiple times (once per env + 1),
// meaning that the `config` hook of all plugins can run multiple times.
let injected = false;
export function universalDeployPlugin(options?: Options): Plugin[] {
  return [
    {
      name: "awesome-framework:universal-deploy",
      config: {
        order: "pre",
        handler() {
          if (injected) return;
          injected = true;
          // Declaring server entries through @universal-deploy/store
          addEntry({
            id: "awesome-framework/api",
            route: "/api",
          });
          addEntry({
            id: "awesome-framework/ssr",
            route: "/**",
          });
          if (options?.additionalEntries) {
            options.additionalEntries.forEach((e) => {
              addEntry(e);
            });
          }
        },
      },
    },
    ...universalDeploy({
      node: {
        importer: "awesome-framework",
      },
    }),
  ];
}
