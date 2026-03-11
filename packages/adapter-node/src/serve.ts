import userServerEntry from "virtual:ud:catch-all";
import type { Fetchable } from "@universal-deploy/store";
import { type FetchHandler, type ServerMiddleware, serve as serveSrvx } from "srvx";

function assertFetchable(mod: unknown, id: string): Fetchable {
  if (!mod || typeof mod !== "object") throw new Error(`Missing default export from ${id}`);
  if ("default" in mod && mod.default) mod = mod.default;
  if (!mod || typeof mod !== "object" || !("fetch" in mod) || typeof mod.fetch !== "function")
    throw new Error(`Default export from ${id} must include a { fetch() } function`);
  return mod as Fetchable;
}

async function startServer() {
  assertFetchable(userServerEntry, "virtual:ud:catch-all");
  let { static: staticDir, prod } = userServerEntry as unknown as FetchHandler & {
    static?: boolean | string;
    prod?: boolean;
  };

  // @ts-expect-error replaced by node plugin
  if (__UD_STATIC__) staticDir = __UD_STATIC__;

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = prod ? "production" : "development";
  }

  if (staticDir === undefined || staticDir === true) {
    staticDir = "public";
  }

  const server = serveSrvx({
    ...userServerEntry,
    gracefulShutdown: Boolean(prod),
    middleware: [
      staticDir
        ? (await import("srvx/static")).serveStatic({
            dir: staticDir,
          })
        : undefined,
    ].filter(Boolean) as ServerMiddleware[],
  });

  await server.ready();
}

await startServer();
