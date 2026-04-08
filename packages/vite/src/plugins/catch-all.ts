import { getAllEntries } from "@universal-deploy/store";
import { addRoute, createRouter } from "rou3";
import { compileRouterToString } from "rou3/compiler";
import type { Plugin } from "vite";
import { catchAllId } from "../const.js";
import { assertFetchable } from "../utils.js";

// A virtual module aggregating all routes defined in the store. Can be overridden by plugins
const re_catchAll = /^virtual:ud:catch-all$/;
// Always resolves through this plugin. Should NOT be overridden
const re_catchAllDefault = /^virtual:ud:catch-all\?default$/;

export function catchAll(): Plugin {
  return {
    name: catchAllId,
    resolveId: {
      filter: {
        id: [re_catchAll, re_catchAllDefault],
      },
      handler(id) {
        return id;
      },
    },
    load: {
      filter: {
        id: [re_catchAll, re_catchAllDefault],
      },
      async handler() {
        const imports = new Map<string, string>();
        const router = createRouter<string>();

        let i = 0;
        const seen = new Map<
          string,
          {
            routes: Set<string>;
            i: number;
          }
        >();
        const duplicates = new Set<string>();

        for (const meta of getAllEntries()) {
          const resolved = await this.resolve(meta.id);
          if (!resolved) {
            throw new Error(`Failed to resolve ${meta.id}`);
          }
          const rou3Paths = new Set(Array.isArray(meta.route) ? meta.route : [meta.route]);
          const methods = Array.isArray(meta.method) ? meta.method : [meta.method ?? ""];
          if (seen.has(resolved.id)) {
            // biome-ignore lint/style/noNonNullAssertion: ok
            const { routes, i } = seen.get(resolved.id)!;
            let added = false;
            for (const route of rou3Paths) {
              if (!routes.has(route)) {
                added = true;
                routes.add(route);
                methods.forEach((method) => {
                  addRoute(router, method, route, `m${i}`);
                });
              }
            }
            if (!added) {
              duplicates.add(resolved.id);
            }
          } else {
            seen.set(resolved.id, {
              routes: rou3Paths,
              i,
            });
            imports.set(`m${i}`, `() => import(${JSON.stringify(resolved.id)}).then(m => m.default);`);
            rou3Paths.forEach((route) => {
              methods.forEach((method) => {
                addRoute(router, method, route, `m${i}`);
              });
            });
            i += 1;
          }
        }
        if (duplicates.size > 0) {
          this.warn(
            `\nDuplicate entries detected in virtual:ud:catch-all. \nDuplicates:\n - ${Array.from(duplicates.values()).join("\n - ")}`,
          );
        }

        // const findRoute=(m, p) => {}
        const compiledFindRoute = compileRouterToString(router, "findRoute");

        //language=js
        const code = `
const __map = {
  ${Array.from(imports.entries())
    .map(([k, v]) => `"${k}": ${v}`)
    .join(",\n  ")}
};

${compiledFindRoute};

${assertFetchable.toString()}

export default {
  async fetch(request, ...args) {
    const url = new URL(request.url);
    const key = findRoute(request.method, url.pathname);
    if (!key || !key.data) return;
    const mod = await __map[key.data];
    return assertFetchable(mod).fetch(request, ...args);
  }
}`;
        return code;
      },
    },
  };
}
