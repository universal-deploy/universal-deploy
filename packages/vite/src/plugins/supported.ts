import type { Plugin, UserConfig } from "vite";
import { INSTANCE } from "../const.js";
import { asyncFlatten } from "../utils.js";

export type SupportedTarget =
  | "vite-plugin-vercel"
  | "@cloudflare/vite-plugin"
  | "@netlify/vite-plugin"
  | "@universal-deploy/node";

/**
 * Resolves an array of supported target plugins.
 *
 * @param callback
 */
export function resolveTargets(callback: (targets: SupportedTarget[]) => void | Promise<void>): Plugin {
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

async function findSupportedDeploymentTargets(thisNodePlugin: Plugin, c: UserConfig): Promise<SupportedTarget[]> {
  const plugins = (await asyncFlatten((c.plugins ?? []) as Plugin[])).filter((p): p is Plugin => Boolean(p));
  const found: SupportedTarget[] = [];

  // vite-plugin-vercel
  if (plugins.some((p) => p.name.match(/^vite-plugin-vercel/))) {
    found.push("vite-plugin-vercel");
  }
  // @cloudflare/vite-plugin
  if (plugins.some((p) => p.name.match(/^vite-plugin-cloudflare/))) {
    found.push("@cloudflare/vite-plugin");
  }
  // @netlify/vite-plugin
  if (plugins.some((p) => p.name.match(/^vite-plugin-netlify/))) {
    found.push("@netlify/vite-plugin");
  }

  // Check for other instances of ud:node:emit that are NOT this one
  const otherNodePlugin = plugins.some(
    (p) =>
      p.name.startsWith("ud:node:emit") &&
      // @ts-expect-error
      p[INSTANCE] !== thisNodePlugin?.[INSTANCE],
  );

  if (otherNodePlugin) {
    found.push("@universal-deploy/node");
  }

  return found;
}
