import { node } from "@universal-deploy/node/vite";
import type { Plugin } from "vite";
import { INSTANCE } from "../const.js";
import { catchAll, devServer } from "../index.js";
import { enablePluginIf } from "../utils.js";
import { netlifyGlue } from "./glue.js";
import { noDeploymentTargetFound } from "./supported.js";
import target from "./target.js";

type NodePluginOptions = Parameters<typeof node>[0];

/**
 * Automatically enables the node adapter if no other deployment target (Vercel, Cloudflare, Netlify) is detected.
 */
export function auto(options?: {
  node?: NodePluginOptions;
  /**
   * Custom server entry, used instead of the node adapter's server entry.
   *
   * By default, it's expected to forward requests to `virtual:ud:catch-all`. Set `catchAll: false` if it handles
   * requests itself: `devServer()` is then not added, and the framework serves requests in development (e.g. by
   * running the entry).
   */
  entry?: string | { id: string; catchAll?: boolean };
}): Plugin[] {
  const instance = Symbol("instance");
  const entry = typeof options?.entry === "string" ? { id: options.entry } : options?.entry;
  const usesCatchAll = entry?.catchAll ?? true;
  return [
    catchAll(),
    ...(usesCatchAll ? [devServer()] : []),
    ...(entry
      ? [target(entry.id, { catchAll: usesCatchAll })]
      : [
          // Enable node adapter only if no other deployment target has been found
          ...node(options?.node).map((p) => {
            // @ts-expect-error
            p[INSTANCE] = instance;
            // Disable node() plugin later when Vite's config() hook runs, because noDeploymentTargetFound() requires `config`
            return enablePluginIf((config) => noDeploymentTargetFound(p, config), p);
          }),
          ...netlifyGlue(),
        ]),
  ];
}
