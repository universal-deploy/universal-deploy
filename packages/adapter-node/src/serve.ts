import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  let { static: staticHint } = userServerEntry as unknown as FetchHandler & {
    static?: boolean | string;
  };

  // @ts-expect-error replaced by node plugin
  if (staticHint === undefined) staticHint = __UD_STATIC__;

  if (!process.env.NODE_ENV) {
    // @ts-expect-error replaced by node plugin
    process.env.NODE_ENV = __UD_PROD__ ? "production" : "development";
  }

  // Resolve a string hint against this module's runtime location — keeps the
  // built artifact portable across filesystems (Docker, deploy targets, …).
  const staticDir =
    typeof staticHint === "string" ? resolve(dirname(fileURLToPath(import.meta.url)), staticHint) : undefined;

  const server = serveSrvx({
    ...userServerEntry,
    gracefulShutdown: userServerEntry.gracefulShutdown ?? false,
    middleware: [
      ...(userServerEntry.middleware ?? []),
      staticDir
        ? (await import("srvx/static")).serveStatic({
            dir: staticDir,
          })
        : undefined,
    ].filter(Boolean) as ServerMiddleware[],
    manual: true,
  });

  userServerEntry.onCreate?.(server);

  server.serve();
  await server.ready();

  userServerEntry.onReady?.(server);
}

await startServer();
