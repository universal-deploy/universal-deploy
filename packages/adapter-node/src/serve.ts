import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  if (!process.env.NODE_ENV) {
    // @ts-expect-error replaced by node plugin
    process.env.NODE_ENV = __UD_PROD__ ? "production" : "development";
  }

  // Dependencies choose their development or production build while the user entry evaluates.
  const { default: userServerEntry } = await import("virtual:ud:catch-all");
  assertFetchable(userServerEntry, "virtual:ud:catch-all");
  let { static: staticHint } = userServerEntry as unknown as FetchHandler & {
    static?: boolean | string;
  };

  // @ts-expect-error replaced by node plugin
  if (staticHint === undefined) staticHint = __UD_STATIC__;

  // Resolve a string hint against this module's runtime location — keeps the
  // built artifact portable across filesystems (Docker, deploy targets, …).
  const staticDir =
    typeof staticHint === "string" ? resolve(dirname(fileURLToPath(import.meta.url)), staticHint) : undefined;

  // srvx 0.12 renamed `serveStatic` to `staticMiddleware` (same `{ dir }` signature).
  // Support both so the built server works against srvx 0.11 and 0.12+ alike. Only one
  // name exists in the installed srvx's types, hence the cast to a both-optional shape.
  const staticMod = (await import("srvx/static")) as unknown as {
    staticMiddleware?: (options: { dir: string }) => ServerMiddleware;
    serveStatic?: (options: { dir: string }) => ServerMiddleware;
  };
  const createStatic = staticMod.staticMiddleware ?? staticMod.serveStatic;

  const server = serveSrvx({
    ...userServerEntry,
    gracefulShutdown: userServerEntry.gracefulShutdown ?? false,
    middleware: [
      ...(userServerEntry.middleware ?? []),
      staticDir && createStatic ? createStatic({ dir: staticDir }) : undefined,
    ].filter(Boolean) as ServerMiddleware[],
    manual: true,
  });

  userServerEntry.onCreate?.(server);

  server.serve();
  await server.ready();

  userServerEntry.onReady?.(server);
}

await startServer();
