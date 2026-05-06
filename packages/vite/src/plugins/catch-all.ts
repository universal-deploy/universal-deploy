import { getAllEntries } from "@universal-deploy/store";
import { addRoute, createRouter } from "rou3";
import { compileRouterToString } from "rou3/compiler";
import type { Plugin } from "vite";
import { catchAllId } from "../const.js";
import { assertFetchable, shortenId } from "../utils.js";

// A virtual module aggregating all routes defined in the store. Can be overridden by plugins
const re_catchAll = /^virtual:ud:catch-all$/;
// Always resolves through this plugin. Should NOT be overridden
const re_catchAllDefault = /^virtual:ud:catch-all\?default$/;

interface Entry {
  key: string;
  resolvedId: string;
  label: string;
  eager: boolean;
  routes: Set<string>;
}

function generateCode(entries: Entry[], compiledFindRoute: string): string {
  const eagerEntries = entries.filter((e) => e.eager);

  const staticImports = eagerEntries
    .map((e) => `import __eager_${e.key} from ${JSON.stringify(e.resolvedId)};`)
    .join("\n");

  const mapEntries = entries
    .map((e) =>
      e.eager
        ? `  "${e.key}": () => Promise.resolve({ default: __eager_${e.key} })`
        : `  "${e.key}": () => import(${JSON.stringify(e.resolvedId)})`,
    )
    .join(",\n");

  const idEntries = entries.map((e) => `  "${e.key}": ${JSON.stringify(e.label)}`).join(",\n");

  const reExports = eagerEntries.map((e) => `export * from ${JSON.stringify(e.resolvedId)};`).join("\n");
  const spreads = eagerEntries.map((e) => `  ...__eager_${e.key},`).join("\n");

  //language=js
  return `
${staticImports}
const __map = {
${mapEntries}
};
const __ids = {
${idEntries}
};

${compiledFindRoute}

${assertFetchable.toString()}

${reExports}
export default {
${spreads}
  async fetch(request, ...args) {
    const url = new URL(request.url);
    const key = findRoute(request.method, url.pathname);
    if (!key || !key.data) return;
    const mod = await __map[key.data]();
    return assertFetchable(mod, __ids[key.data]).fetch(request, ...args);
  }
}`;
}

export function catchAll(): Plugin {
  let root = "";
  return {
    name: catchAllId,
    configResolved(config) {
      root = config.root;
    },
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
        const router = createRouter<string>();
        const entries: Entry[] = [];
        const seen = new Map<string, Entry>();
        const duplicates = new Set<string>();

        for (const meta of getAllEntries()) {
          const resolved = await this.resolve(meta.id);
          if (!resolved) {
            throw new Error(`Failed to resolve ${meta.id}`);
          }
          const routes = new Set(Array.isArray(meta.route) ? meta.route : [meta.route]);
          const methods = Array.isArray(meta.method) ? meta.method : [meta.method ?? ""];

          const existing = seen.get(resolved.id);
          if (existing) {
            let added = false;
            for (const route of routes) {
              if (!existing.routes.has(route)) {
                added = true;
                existing.routes.add(route);
                for (const method of methods) {
                  addRoute(router, method, route, existing.key);
                }
              }
            }
            if (!added) {
              duplicates.add(resolved.id);
            }
            if (routes.has("/**")) {
              existing.eager = true;
            }
          } else {
            const entry: Entry = {
              key: `m${entries.length}`,
              resolvedId: resolved.id,
              label: shortenId(resolved.id, root),
              eager: routes.has("/**"),
              routes,
            };
            entries.push(entry);
            seen.set(resolved.id, entry);
            for (const route of routes) {
              for (const method of methods) {
                addRoute(router, method, route, entry.key);
              }
            }
          }
        }

        if (duplicates.size > 0) {
          this.warn(
            `\nDuplicate entries detected in virtual:ud:catch-all. \nDuplicates:\n - ${Array.from(duplicates.values()).join("\n - ")}`,
          );
        }

        return generateCode(entries, compileRouterToString(router, "findRoute"));
      },
    },
  };
}
