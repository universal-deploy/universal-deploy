import type { ServerOptions } from "@universal-deploy/store";
import type { ConfigEnv, ConfigPluginContext, Plugin, UserConfig } from "vite";
import { catchAllId } from "./const.js";

export const pluginsUsage = {
  [catchAllId]: "@universal-deploy/vite",
  "ud:resolver": "@universal-deploy/vite",
} as const;

export function dependsOn(pluginName: keyof typeof pluginsUsage) {
  return {
    configResolved(config) {
      if (!config.plugins.some(({ name }) => name === pluginName)) {
        this.error(`"${pluginName}" Vite plugin is missing. Install it from "${pluginsUsage[pluginName]}".`);
      }
    },
  } satisfies Partial<Plugin>;
}

export function assertFetchable(mod: unknown, id: string): ServerOptions {
  if (!mod || typeof mod !== "object") throw new Error(`Missing default export from ${id}`);
  if ("default" in mod && mod.default) mod = mod.default;
  if (!mod || typeof mod !== "object" || !("fetch" in mod) || typeof mod.fetch !== "function")
    throw new Error(`Default export from ${id} must include a { fetch() } function`);
  return mod as ServerOptions;
}

export async function asyncFlatten<T>(arr: T[]): Promise<T[]> {
  const flattened: T[] = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      flattened.push(...(await asyncFlatten(item)));
    } else if (item instanceof Promise) {
      flattened.push(...(await asyncFlatten([await item])));
    } else if (item) {
      flattened.push(item);
    }
  }
  return flattened;
}

/**
 * Enables a plugin based on a specified condition callback which will be executed in the `config` hook.
 */
export function enablePluginIf(condition: EnableCondition, originalPlugin: Plugin): Plugin {
  const originalConfig = originalPlugin.config;

  originalPlugin.config = {
    order: originalConfig && "order" in originalConfig ? originalConfig.order : "pre",
    async handler(c, e) {
      const enabled = await condition.call(this, c, e);
      if (!enabled) {
        const keysToDelete = Object.keys(originalPlugin).filter((k) => k !== "name");
        originalPlugin.name += ":disabled";
        for (const key of keysToDelete) {
          // @ts-expect-error
          delete originalPlugin[key];
        }
      } else if (originalConfig) {
        if (typeof originalConfig === "function") {
          return originalConfig.call(this, c, e);
        }
        return originalConfig.handler.call(this, c, e);
      }
    },
  };

  return originalPlugin;
}
type EnableCondition = (this: ConfigPluginContext, config: UserConfig, env: ConfigEnv) => boolean | Promise<boolean>;
