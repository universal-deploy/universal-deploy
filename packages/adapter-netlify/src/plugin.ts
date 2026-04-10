import { catchAllEntry } from "@universal-deploy/store";
import type { Plugin } from "vite";

const moduleId = "ud:netlify";

function netlify(): Plugin[] {
  return [
    {
      name: `${moduleId}:apply-store`,
      apply: "build",
      enforce: "post",
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
    },
  ];
}

export { netlify, netlify as default };
