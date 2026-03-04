/** biome-ignore-all lint/suspicious/noExplicitAny: globalThis cast */
import type { EntryMeta, EntryTransformer, Store } from "./types.js";

export type * from "./types.js";
export const catchAllEntry = "virtual:ud:catch-all" as const;

const storeSymbol = Symbol.for("ud:store");
const transformerSymbol = Symbol.for("ud:transformer");
// init store
(globalThis as any)[storeSymbol] ??= { entries: [] } satisfies Store;

function getStore(): Store {
  return (globalThis as any)[storeSymbol];
}

function getTransformer(): EntryTransformer | undefined {
  return (getStore() as any)[transformerSymbol];
}

/**
 * Add a Fetchable server entry to the store
 */
export function addEntry(entry: EntryMeta) {
  // We silently ignore exact duplicates, as vite config file can be imported multiple times
  const serializedEntry = serializeEntry(entry);
  const store = getStore();
  if (store.entries.some((e) => serializeEntry(e) === serializedEntry)) {
    return;
  }
  store.entries.push(entry);
}

/**
 * Retrieve all server entries
 */
export function getAllEntries(): readonly EntryMeta[] {
  const transformer = getTransformer();
  const entries = [...getStore().entries];
  return Object.freeze(transformer ? entries.map(transformer) : entries);
}

/**
 * @experimental
 */
export function setEntryTransformer(transformer: EntryTransformer) {
  (getStore() as any)[transformerSymbol] = transformer;
}

function serializeEntry(entry: EntryMeta) {
  return JSON.stringify({
    ...entry,
    route: Array.isArray(entry.route) ? entry.route : [entry.route],
    method: Array.isArray(entry.method) ? entry.method : entry.method ? [entry.method] : undefined,
  });
}
