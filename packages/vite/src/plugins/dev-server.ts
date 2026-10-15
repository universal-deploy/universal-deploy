import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { catchAllEntry, type ServerOptions } from "@universal-deploy/store";
import { createMiddleware } from "@universal-middleware/express";
import type { Environment, FetchableDevEnvironment, Plugin, RunnableDevEnvironment, ViteDevServer } from "vite";
import { unmatchedKey } from "../const.js";
import { assertFetchable } from "../utils.js";

// Vite's isRunnableDevEnvironment isn't reliable when multiple Vite versions are installed
export function isRunnableDevEnvironment(environment: Environment): environment is RunnableDevEnvironment {
  return "runner" in environment;
}

export function isFetchableDevEnvironment(environment: Environment): environment is FetchableDevEnvironment {
  return "dispatchFetch" in environment;
}

/**
 * Resolves catch-all entry and forwards incoming requests to its `fetch()` handler, and WebSocket connections to its
 * `websocket` hooks.
 *
 * @param environment which server-side environment to use. Defaults to `ssr`
 */
export function devServer({ environment }: { environment?: string } = {}): Plugin {
  return {
    name: "universal-deploy:dev-server",
    apply(_config, { command, mode }) {
      return command === "serve" && mode !== "test";
    },
    configureServer(server) {
      return () => {
        const ssr = server.environments[environment ?? "ssr"];
        if (!ssr) {
          return this.error(`Cannot find environment "${environment}"`);
        }
        if (ssr.config.consumer !== "server") {
          return this.error(`Cannot use environment "${environment}" (requires a server environment)`);
        }
        let resolvedId: string | undefined;

        async function importServerEntry(env: RunnableDevEnvironment) {
          if (!resolvedId) {
            const resolved = await env.pluginContainer.resolveId(catchAllEntry);

            if (!resolved?.id) {
              throw new Error(`Could not resolve server entry ${catchAllEntry}`);
            }

            resolvedId = resolved.id;
          }
          return envImportFetchable(env, resolvedId);
        }

        async function devMiddleware(request: Request) {
          // biome-ignore lint/style/noNonNullAssertion: ok
          if (isRunnableDevEnvironment(ssr!)) {
            const mod = await importServerEntry(ssr);
            const response = await mod.fetch(request);
            // No route matched: fall through to Vite's middlewares (index.html, static files, ...)
            if (Symbol.for(unmatchedKey) in response) return;
            return response;
            // biome-ignore lint/style/noNonNullAssertion: ok
          } else if (isFetchableDevEnvironment(ssr!)) {
            // TODO to be tested
            return ssr.dispatchFetch(request);
          }
        }

        server.middlewares.use(createMiddleware(() => devMiddleware)());

        if (isRunnableDevEnvironment(ssr)) {
          // The server entry is imported upon each connection, so that modifying it applies to new connections
          const getWebSocketHooks = async () => (await importServerEntry(ssr)).websocket;
          // No HTTP server in middleware mode: the server that uses Vite's middlewares handles WebSockets itself
          server.httpServer?.on("upgrade", createWebSocketUpgradeHandler(server, getWebSocketHooks));
        }
      };
    },
  };
}

async function envImportFetchable(env: RunnableDevEnvironment, resolvedId: string) {
  const mod = await env.runner.import<unknown>(resolvedId);
  return assertFetchable(mod, resolvedId);
}

type CrosswsNodeAdapter = ReturnType<typeof import("crossws/adapters/node").default>;

function createWebSocketUpgradeHandler(
  server: ViteDevServer,
  getWebSocketHooks: () => Promise<ServerOptions["websocket"]>,
) {
  let ws: CrosswsNodeAdapter | undefined;
  return async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Vite's HMR WebSocket
    const protocol = req.headers["sec-websocket-protocol"];
    if (protocol === "vite-hmr" || protocol === "vite-ping") return;
    try {
      // The server entry doesn't define `websocket`: leave the request to other `upgrade` listeners
      if (!(await getWebSocketHooks())) return;
      if (!ws) {
        // `crossws` is an optional peer dependency, only loaded when the server entry defines `websocket`
        const { default: crossws } = await import("crossws/adapters/node");
        ws = crossws({ resolve: async () => (await getWebSocketHooks()) ?? {} });
      }
      await ws.handleUpgrade(req, socket, head);
    } catch (error) {
      server.config.logger.error(`[universal-deploy] WebSocket upgrade failed: ${error}`, {
        error: error instanceof Error ? error : undefined,
      });
      socket.destroy();
    }
  };
}
