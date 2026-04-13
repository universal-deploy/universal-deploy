import { netlify } from "@universal-deploy/netlify/vite";
import type { Plugin } from "vite";
import { asyncFlatten, enablePluginIf } from "../utils.js";

/**
 * Enable `@universal-deploy/netlify` only if `@netlify/vite-plugin` was found
 */
export function netlifyGlue(): Plugin[] {
  return netlify().map((p) => enablePluginIf(isNetlifyPluginInUse, p));
}

const isNetlifyPluginInUse: Parameters<typeof enablePluginIf>[0] = async (userConfig) => {
  const flatPlugins = (await asyncFlatten(userConfig.plugins ?? [])).filter((p): p is Plugin => Boolean(p));
  const foundNetlifyPlugin = flatPlugins.find((p) => p.name.match(/^vite-plugin-netlify/));

  return !!foundNetlifyPlugin;
};
