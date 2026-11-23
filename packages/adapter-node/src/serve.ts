import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fetchable } from "@universal-deploy/store";
import { type FetchHandler, type Server, type ServerMiddleware, serve as serveSrvx } from "srvx";
import { type ResolvedStaticOptions, resolveStaticOptions } from "./static-options.js";

let server: Server | undefined;

async function startServer() {
  // Must run before the user entry is evaluated: dependencies such as React pick their
  // development or production build at module evaluation, hence the dynamic import below.
  if (!process.env.NODE_ENV) {
    // @ts-expect-error replaced by node plugin
    process.env.NODE_ENV = __UD_PROD__ ? "production" : "development";
  }

  const { default: userServerEntry } = await import("virtual:ud:catch-all");
  assertFetchable(userServerEntry, "virtual:ud:catch-all");
  const { static: runtimeStatic } = userServerEntry as unknown as FetchHandler & {
    static?: boolean | string;
  };

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

  server = serveSrvx({
    ...userServerEntry,
    gracefulShutdown: userServerEntry.gracefulShutdown ?? false,
    middleware: [
      ...(userServerEntry.middleware ?? []),
      ...(staticOptions && createStatic ? [createStatic(staticOptions)] : []),
    ],
    manual: true,
  });

  await userServerEntry.onCreate?.(server);

  await server.serve();
  await server.ready();

  await userServerEntry.onReady?.(server);
}

function assertFetchable(mod: unknown, id: string): Fetchable {
  if (!mod || typeof mod !== "object") throw new Error(`Missing default export from ${id}`);
  if ("default" in mod && mod.default) mod = mod.default;
  if (!mod || typeof mod !== "object" || !("fetch" in mod) || typeof mod.fetch !== "function")
    throw new Error(`Default export from ${id} must include a { fetch() } function`);
  return mod as Fetchable;
}

try {
  await startServer();
} catch (error) {
  // Rethrown so Node's report and the app's listeners (error trackers, Vike's logger) still get the error.
  // A listener that swallows it (Vike's does) would otherwise let a failed start exit 0, or stay alive while work is pending.
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 5000).unref();
  server?.close(true).catch(() => {});
  throw error;
}
