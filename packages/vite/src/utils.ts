import type { ServerOptions } from "@universal-deploy/store";
import type { Plugin } from "vite";
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
