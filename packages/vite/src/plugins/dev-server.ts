import { catchAllEntry } from "@universal-deploy/store";
import { createMiddleware } from "@universal-middleware/express";
import type { Environment, FetchableDevEnvironment, Plugin, RunnableDevEnvironment } from "vite";
import { assertFetchable } from "../utils.js";

// Vite's isRunnableDevEnvironment isn't reliable when multiple Vite versions are installed
export function isRunnableDevEnvironment(environment: Environment): environment is RunnableDevEnvironment {
  return "runner" in environment;
}

export function isFetchableDevEnvironment(environment: Environment): environment is FetchableDevEnvironment {
  return "dispatchFetch" in environment;
}

/**
 * Resolves catch-all entry and forwards incoming requests to its `fetch()` handler.
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

        async function devMiddleware(request: Request) {
          // biome-ignore lint/style/noNonNullAssertion: ok
          if (isRunnableDevEnvironment(ssr!)) {
            if (!resolvedId) {
              const resolved = await ssr.pluginContainer.resolveId(catchAllEntry);

              if (!resolved?.id) {
                throw new Error(`Could not resolve server entry ${catchAllEntry}`);
              }

              resolvedId = resolved.id;
            }
            const mod = await envImportFetchable(ssr, resolvedId);
            return mod.fetch(request);
            // biome-ignore lint/style/noNonNullAssertion: ok
          } else if (isFetchableDevEnvironment(ssr!)) {
            // TODO to be tested
            return ssr.dispatchFetch(request);
          }
        }

        server.middlewares.use(createMiddleware(() => devMiddleware)());
      };
    },
  };
}

async function envImportFetchable(env: RunnableDevEnvironment, resolvedId: string) {
  const mod = await env.runner.import<unknown>(resolvedId);
  return assertFetchable(mod, resolvedId);
}
