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

function shortenId(id: string, root: string): string {
  const nmIdx = id.lastIndexOf("/node_modules/");
  if (nmIdx !== -1) {
    const parts = id.slice(nmIdx + "/node_modules/".length).split("/");
    return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return id.startsWith(root) ? id.slice(root.length).replace(/^\//, "") : id;
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
        const imports = new Map<string, string>();
        const ids = new Map<string, string>();
        const router = createRouter<string>();
        const eagerModules: { id: string; default: string; export?: boolean }[] = [];

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
            // Promote to eager if this registration introduces /** and the module isn't eager yet
            if (rou3Paths.has("/**") && !eagerModules.some((m) => m.id === resolved.id)) {
              const eagerVarName = `__eager_m${i}`;
              eagerModules.push({ id: resolved.id, default: eagerVarName, export: true });
              imports.set(`m${i}`, `() => Promise.resolve({ default: ${eagerVarName} })`);
            }
          } else {
            const eagerVarName = rou3Paths.has("/**") ? `__eager_m${i}` : null;
            if (eagerVarName) {
              // Fallback routes (/**) are loaded eagerly and exported from the virtual module
              eagerModules.push({
                id: resolved.id,
                default: eagerVarName,
                export: true,
              });
            }
            seen.set(resolved.id, {
              routes: rou3Paths,
              i,
            });
            ids.set(`m${i}`, shortenId(resolved.id, root));
            // Use an eager reference to avoid the static+dynamic import warning from Rollup
            imports.set(
              `m${i}`,
              eagerVarName
                ? `() => Promise.resolve({ default: ${eagerVarName} })`
                : `() => import(${JSON.stringify(resolved.id)})`,
            );
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

        const eagerModuleExport = eagerModules.filter((m) => m.export);

        //language=js
        const code = `
${eagerModules.map(({ id, default: defaultExport }) => `import ${defaultExport} from ${JSON.stringify(id)};`).join("\n")}
const __map = {
  ${Array.from(imports.entries())
    .map(([k, v]) => `"${k}": ${v}`)
    .join(",\n  ")}
};
const __ids = {
  ${Array.from(ids.entries())
    .map(([k, v]) => `"${k}": ${JSON.stringify(v)}`)
    .join(",\n  ")}
};

${compiledFindRoute}

${assertFetchable.toString()}

${eagerModuleExport.map(({ id }) => `export * from ${JSON.stringify(id)};`).join("\n")}
export default {
  ${eagerModuleExport.map(({ default: defaultExport }) => `...${defaultExport},`).join("\n  ")}
  async fetch(request, ...args) {
    const url = new URL(request.url);
    const key = findRoute(request.method, url.pathname);
    if (!key || !key.data) return;
    const mod = await __map[key.data]();
    return assertFetchable(mod, __ids[key.data]).fetch(request, ...args);
  }
}`;
        return code;
      },
    },
  };
}
