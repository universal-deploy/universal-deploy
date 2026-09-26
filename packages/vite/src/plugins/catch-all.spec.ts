import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEntry, catchAllEntry } from "@universal-deploy/store";
import { createServer, type Plugin, type RunnableDevEnvironment, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catchAll } from "./catch-all.js";
import { devServer } from "./dev-server.js";

const helloId = "virtual:test:hello";

// Only registers a specific route, no `/**` catch-all entry
function hello(): Plugin {
  return {
    name: "test:hello",
    config() {
      addEntry({ id: helloId, route: "/api/hello" });
    },
    resolveId(id) {
      if (id === helloId) return id;
    },
    load(id) {
      if (id === helloId) return `export default { fetch: () => new Response("hello") }`;
    },
  };
}

describe("catchAll() without a /** entry", () => {
  let root: string;
  let server: ViteDevServer;
  let url: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "ud-catch-all-"));
    await writeFile(join(root, "index.html"), "<html><body>spa</body></html>");
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      appType: "spa",
      server: { port: 0 },
      plugins: [hello(), catchAll(), devServer()],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Server has no port");
    url = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  async function catchAllFetch(path: string): Promise<Response> {
    const ssr = server.environments.ssr as RunnableDevEnvironment;
    const mod = await ssr.runner.import<{ default: { fetch(request: Request): Promise<Response> } }>(catchAllEntry);
    return mod.default.fetch(new Request(new URL(path, url)));
  }

  it("forwards matched routes to their entry", async () => {
    const res = await catchAllFetch("/api/hello");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("returns a 404 Response for unmatched routes", async () => {
    const res = await catchAllFetch("/nope");
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });

  it("falls through to Vite's middlewares in dev for unmatched routes", async () => {
    const api = await fetch(new URL("/api/hello", url));
    expect(await api.text()).toBe("hello");

    const spa = await fetch(new URL("/nope", url));
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain("spa");
  });
});
