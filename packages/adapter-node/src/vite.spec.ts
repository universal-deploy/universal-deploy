import { resolve } from "node:path";
import type { Environment } from "vite";
import { describe, expect, it } from "vitest";
import { resolveStaticHint } from "./vite.js";

/**
 * Build the minimal `Environment`-shaped stub `resolveStaticHint` touches:
 *   - `config.root`             — Vite project root
 *   - `config.build.outDir`     — current (SSR) env's outDir
 *   - `getTopLevelConfig().environments[*].consumer | build.outDir` — sibling envs
 *
 * `findClientOutDir` walks the environments and picks the one with
 * `consumer === "client"`. We model that via two entries (server + optional client)
 * so the test can also exercise the "no client environment" code path.
 */
function makeEnv(opts: { root: string; serverOutDir: string; clientOutDir?: string }): Environment {
  const envs: Record<string, { consumer: string; build: { outDir: string } }> = {
    ssr: { consumer: "server", build: { outDir: opts.serverOutDir } },
  };
  if (opts.clientOutDir !== undefined) {
    envs.client = { consumer: "client", build: { outDir: opts.clientOutDir } };
  }
  return {
    config: {
      root: opts.root,
      build: { outDir: opts.serverOutDir },
    },
    getTopLevelConfig: () => ({ environments: envs }),
  } as unknown as Environment;
}

/** What `serve.ts` does at runtime: `resolve(getEntryDir(), <hint>)`. */
function runtimeResolve(serverEntryDir: string, hint: string | false): string | undefined {
  return hint === false ? undefined : resolve(serverEntryDir, hint);
}

describe("resolveStaticHint", () => {
  // ── `static: false` short-circuits ──
  describe("static: false", () => {
    it("returns false when both envs exist", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server", clientOutDir: "/p/dist/client" });
      expect(resolveStaticHint(env, false)).toBe(false);
    });

    it("returns false even without a client env (no auto-detect attempted)", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server" });
      expect(resolveStaticHint(env, false)).toBe(false);
    });
  });

  // ── auto-detect from the client env's outDir ──
  describe("auto-detect (static omitted)", () => {
    it("returns entry-relative path when client outDir is a sibling", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server", clientOutDir: "/p/dist/client" });
      expect(resolveStaticHint(env, undefined)).toBe("../client");
    });

    it("returns '.' when client outDir equals server outDir", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist", clientOutDir: "/p/dist" });
      expect(resolveStaticHint(env, undefined)).toBe(".");
    });

    it("traverses multiple levels when outDirs are deeply nested apart", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server/inner", clientOutDir: "/p/dist/client" });
      expect(resolveStaticHint(env, undefined)).toBe("../../client");
    });

    it("traverses outside the build tree when client is a sibling of root", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server", clientOutDir: "/q/static" });
      // `../../../q/static` is the entry-relative path.
      expect(resolveStaticHint(env, undefined)).toBe("../../../q/static");
    });

    it("returns false when no client environment is present", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server" });
      expect(resolveStaticHint(env, undefined)).toBe(false);
    });

    it("treats `static: true` the same as omitted", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server", clientOutDir: "/p/dist/client" });
      expect(resolveStaticHint(env, true)).toBe(resolveStaticHint(env, undefined));
    });
  });

  // ── user-provided string path ──
  describe("user-provided string", () => {
    it("resolves a relative path against the Vite root", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server" });
      // "dist/client" resolves to "/p/dist/client", relative to server outDir → "../client".
      expect(resolveStaticHint(env, "dist/client")).toBe("../client");
    });

    it("ignores the auto-detected client outDir when an explicit string is given", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server", clientOutDir: "/p/dist/client" });
      expect(resolveStaticHint(env, "other/dir")).toBe("../../other/dir");
    });

    it("passes an absolute path through unchanged (user owns the path)", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server" });
      expect(resolveStaticHint(env, "/var/www/static")).toBe("/var/www/static");
    });

    it("handles a `./prefixed` relative path the same as a bare relative path", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server" });
      expect(resolveStaticHint(env, "./dist/client")).toBe("../client");
    });

    it("handles a relative path that walks above the root", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server" });
      // "../shared/static" from /p → /shared/static → relative to /p/dist/server → "../../../shared/static"
      expect(resolveStaticHint(env, "../shared/static")).toBe("../../../shared/static");
    });
  });

  // ── output shape guarantees ──
  describe("output shape", () => {
    it("always uses forward slashes (portable across build/runtime OS)", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server", clientOutDir: "/p/dist/client" });
      const out = resolveStaticHint(env, undefined);
      if (typeof out === "string") expect(out).not.toContain("\\");
    });

    it("never returns an empty string (collapses same-dir case to '.')", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist", clientOutDir: "/p/dist" });
      expect(resolveStaticHint(env, undefined)).not.toBe("");
    });
  });

  // ── roundtrip: build hint then runtime-resolve, verify portability ──
  describe("roundtrip with runtime resolution", () => {
    it("standard layout: same dist on a different filesystem still resolves to the right client dir", () => {
      const env = makeEnv({
        root: "/build-host/app",
        serverOutDir: "/build-host/app/dist/server",
        clientOutDir: "/build-host/app/dist/client",
      });
      const hint = resolveStaticHint(env, undefined);
      // Move the dist to a totally different absolute path (simulating Docker bind-mount).
      const newServerEntryDir = "/runtime-host/repo/app/dist/server";
      expect(runtimeResolve(newServerEntryDir, hint)).toBe("/runtime-host/repo/app/dist/client");
    });

    it("user-provided relative string survives a filesystem move", () => {
      const env = makeEnv({ root: "/build-host/app", serverOutDir: "/build-host/app/dist/server" });
      const hint = resolveStaticHint(env, "dist/client");
      const newServerEntryDir = "/elsewhere/dist/server";
      expect(runtimeResolve(newServerEntryDir, hint)).toBe("/elsewhere/dist/client");
    });

    it("absolute user path resolves to itself from ANY entry dir", () => {
      const env = makeEnv({ root: "/build-host/app", serverOutDir: "/build-host/app/dist/server" });
      const hint = resolveStaticHint(env, "/var/www/static");
      expect(runtimeResolve("/build-host/app/dist/server", hint)).toBe("/var/www/static");
      expect(runtimeResolve("/totally/different/place", hint)).toBe("/var/www/static");
    });

    it("false short-circuits the entire static middleware (undefined at runtime)", () => {
      const env = makeEnv({ root: "/p", serverOutDir: "/p/dist/server" });
      const hint = resolveStaticHint(env, false);
      expect(runtimeResolve("/anywhere", hint)).toBeUndefined();
    });

    it("nested entry layout (e.g. /dist/nested/server) roundtrips correctly", () => {
      const env = makeEnv({
        root: "/build/app",
        serverOutDir: "/build/app/dist/nested/server",
        clientOutDir: "/build/app/dist/nested/client",
      });
      const hint = resolveStaticHint(env, undefined);
      expect(hint).toBe("../client");
      expect(runtimeResolve("/runtime/copy/dist/nested/server", hint)).toBe("/runtime/copy/dist/nested/client");
    });
  });
});
