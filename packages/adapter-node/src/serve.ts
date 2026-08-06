import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import userServerEntry from "virtual:ud:catch-all";
import type { Fetchable } from "@universal-deploy/store";
import { type FetchHandler, type ServerMiddleware, serve as serveSrvx } from "srvx";
import { type ResolvedStaticOptions, resolveStaticOptions } from "./static-options.js";

async function startServer() {
  assertFetchable(userServerEntry, "virtual:ud:catch-all");
  const { static: runtimeStatic } = userServerEntry as unknown as FetchHandler & {
    static?: boolean | string;
  };

  if (!process.env.NODE_ENV) {
    // @ts-expect-error replaced by node plugin
    process.env.NODE_ENV = __UD_PROD__ ? "production" : "development";
  }

  // Resolved against this module's runtime location — keeps the built artifact
  // portable across filesystems (Docker, deploy targets, …).
  const staticOptions = resolveStaticOptions({
    entryDir: dirname(fileURLToPath(import.meta.url)),
    // @ts-expect-error replaced by node plugin
    bakedStatic: __UD_STATIC__,
    runtimeStatic,
    // @ts-expect-error replaced by node plugin
    encodings: __UD_ENCODINGS__,
  });

  // srvx 0.12 renamed `serveStatic` to `staticMiddleware` (same options shape).
  // Support both so the built server works against srvx 0.11 and 0.12+ alike. Only one
  // name exists in the installed srvx's types, hence the cast to a both-optional shape.
  const staticMod = (await import("srvx/static")) as unknown as {
    staticMiddleware?: (options: ResolvedStaticOptions) => ServerMiddleware;
    serveStatic?: (options: ResolvedStaticOptions) => ServerMiddleware;
  };
  const createStatic = staticMod.staticMiddleware ?? staticMod.serveStatic;

  const server = serveSrvx({
    ...userServerEntry,
    gracefulShutdown: userServerEntry.gracefulShutdown ?? false,
    middleware: [
      ...(userServerEntry.middleware ?? []),
      ...(staticOptions && createStatic ? [createStatic(staticOptions)] : []),
    ],
    manual: true,
  });

  userServerEntry.onCreate?.(server);

  server.serve();
  await server.ready();

  userServerEntry.onReady?.(server);
}

function assertFetchable(mod: unknown, id: string): Fetchable {
  if (!mod || typeof mod !== "object") throw new Error(`Missing default export from ${id}`);
  if ("default" in mod && mod.default) mod = mod.default;
  if (!mod || typeof mod !== "object" || !("fetch" in mod) || typeof mod.fetch !== "function")
    throw new Error(`Default export from ${id} must include a { fetch() } function`);
  return mod as Fetchable;
}

await startServer();
