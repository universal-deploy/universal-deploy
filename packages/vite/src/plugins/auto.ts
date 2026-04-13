import { node } from "@universal-deploy/node/vite";
import type { Plugin } from "vite";
import { INSTANCE } from "../const.js";
import { catchAll, devServer } from "../index.js";
import { enablePluginIf } from "../utils.js";
import { netlifyGlue } from "./glue.js";
import { noDeploymentTargetFound } from "./supported.js";

type NodePluginOptions = Parameters<typeof node>[0];

/**
 * Automatically enables the node adapter if no other deployment target (Vercel, Cloudflare, Netlify) is detected.
 */
export function auto(options?: { node?: NodePluginOptions }): Plugin[] {
  const instance = Symbol("instance");
  return [
    catchAll(),
    devServer(),
    // Enable node adapter only if no other deployment target has been found
    ...node(options?.node).map((p) => {
      // @ts-expect-error
      p[INSTANCE] = instance;
      // Disable node() plugin later when Vite's config() hook runs, because noDeploymentTargetFound() requires `config`
      return enablePluginIf((config) => noDeploymentTargetFound(p, config), p);
    }),
    ...netlifyGlue(),
  ];
}
