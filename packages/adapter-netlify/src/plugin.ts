import { catchAllEntry } from "@universal-deploy/store";
import type { Plugin } from "vite";

const moduleId = "ud:netlify";

function netlify(): Plugin[] {
  return [
    {
      name: `${moduleId}:apply-store`,
      apply: "build",
      enforce: "post",
      applyToEnvironment(env) {
        return env.name === "ssr";
      },
      configEnvironment: {
        // Give some time to other plugins to declare an entry in the store
        order: "post",
        handler(name, env) {
          if (env.consumer !== "server" && name !== "ssr") return;
          const optionName = this.meta?.rolldownVersion ? "rolldownOptions" : "rollupOptions";

          return {
            build: {
              [optionName]: {
                input: {
                  index: catchAllEntry,
                },
              },
            },
          };
        },
      },
      generateBundle(_opts, bundle) {
        // The current version of @netlify/vite-plugin (2.11.3) scans chunks with `isEntry: true` to find the server entry
        // and crashes when more than 1 is found.
        // The following ensures that the only entry tagged with `isEntry: true` is `virtual:ud:catch-all`.
        Object.values(bundle).forEach((v) => {
          if (v.type !== "chunk") return;
          if (v.isEntry && v.facadeModuleId !== catchAllEntry) {
            v.isEntry = false;
          }
        });
      },
    },
  ];
}

export { netlify, netlify as default };
