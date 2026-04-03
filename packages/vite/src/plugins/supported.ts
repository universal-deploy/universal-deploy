import type { Plugin, UserConfig } from "vite";
import { asyncFlatten } from "../utils.js";

export interface SupportedTargets {
  vercel: boolean;
  cloudflare: boolean;
  netlify: boolean;
  node: boolean;
}

/**
 * Resolves an object of supported targets.
 *
 * Each value indicates whether the target is present in the Vite plugins.
 *
 * @param callback
 */
export function resolveTargets(callback: (targets: SupportedTargets) => void | Promise<void>): Plugin {
  const plugin: Plugin = {
    name: "universal-deploy:resolve-targets-callback",
    config: {
      order: "pre",
      async handler(userConfig) {
        const targets = await findSupportedDeploymentTargets(plugin, userConfig);
        callback(targets);
      },
    },
  };

  return plugin;
}

export async function noDeploymentTargetFound(thisNodePlugin: Plugin, c: UserConfig) {
  const targets = await findSupportedDeploymentTargets(thisNodePlugin, c);
  return Object.values(targets).every((target) => !target);
}

async function findSupportedDeploymentTargets(thisNodePlugin: Plugin, c: UserConfig): Promise<SupportedTargets> {
  const plugins = (await asyncFlatten((c.plugins ?? []) as Plugin[])).filter((p): p is Plugin => Boolean(p));

  // vite-plugin-vercel
  const vitePluginVercel = plugins.some((p) => p.name.match(/^vite-plugin-vercel/));
  // @cloudflare/vite-plugin
  const cloudflareVitePlugin = plugins.some((p) => p.name.match(/^vite-plugin-cloudflare/));
  // @netlify/vite-plugin (via @universal-deploy/netlify)
  const netlifyVitePlugin = plugins.some((p) => p.name.match(/^ud:netlify/));

  // Check for other instances of ud:node:emit that are NOT this one
  const otherNodePlugin = plugins.some(
    (p) =>
      p.name.startsWith("ud:node:emit") &&
      // @ts-expect-error
      p[INSTANCE] !== thisNodePlugin?.[INSTANCE],
  );

  return {
    vercel: vitePluginVercel,
    cloudflare: cloudflareVitePlugin,
    netlify: netlifyVitePlugin,
    node: otherNodePlugin,
  };
}
