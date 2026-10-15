import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fetchable } from "@universal-deploy/store";
import { type FetchHandler, type ServerMiddleware, serve as serveSrvx } from "srvx";
import { type ResolvedStaticOptions, resolveStaticOptions } from "./static-options.js";

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

  const plugins = [...(userServerEntry.plugins ?? [])];
  const { websocket } = userServerEntry;
  if (websocket) {
    // `crossws` is an optional peer dependency, externalized by the node plugin: it's only loaded when
    // the server entry defines `websocket`, and its export conditions pick the Node/Bun/Deno implementation.
    const { plugin } = await import("crossws/server");
    const runtime = "Bun" in globalThis ? "bun" : "Deno" in globalThis ? "deno" : "node";
    plugins.push((server) => {
      // The srvx adapter is picked at build time: e.g. `bun run build` runs Vite with Node.js, and crossws can't use
      // srvx's Node.js adapter on Bun.
      if (server.runtime !== runtime) {
        console.warn(
          `[@universal-deploy/node] WebSockets are disabled: the server was built with ${server.runtime} but runs on ${runtime}. Build it with ${runtime}${runtime === "bun" ? " (`bun --bun run build`)" : ""} to enable them.`,
        );
        return;
      }
      plugin(websocket)(server);
    });
  }

  const server = serveSrvx({
    ...userServerEntry,
    plugins,
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
