import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBuilder, createLogger, type Logger, type PluginOption } from "vite";
import { describe, expect, it } from "vitest";
import { auto } from "./auto.js";
import { catchAll } from "./catch-all.js";
import target from "./target.js";

// Builds the ssr environment with `entry.js` as target entry, and returns the warnings
async function build(
  files: Record<string, string>,
  plugins: (entry: string) => PluginOption[] = (entry) => [catchAll(), target(entry)],
): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "ud-target-"));
  try {
    for (const [name, code] of Object.entries(files)) {
      await writeFile(join(root, name), code);
    }
    const warnings: string[] = [];
    const customLogger: Logger = {
      ...createLogger("silent"),
      warn: (msg) => warnings.push(msg),
      warnOnce: (msg) => warnings.push(msg),
    };
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "warn",
      customLogger,
      plugins: plugins(join(root, "entry.js")),
    });
    const ssr = builder.environments.ssr;
    if (!ssr) throw new Error("Missing ssr environment");
    await builder.build(ssr);
    return warnings.filter((w) => w.includes("ud:target:emit"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("target()", () => {
  it("doesn't warn if the entry imports virtual:ud:catch-all", async () => {
    const warnings = await build({
      "entry.js": `import handler from "virtual:ud:catch-all"; export default handler;`,
    });
    expect(warnings).toEqual([]);
  });

  it("doesn't warn if the entry imports virtual:ud:catch-all indirectly", async () => {
    const warnings = await build({
      "entry.js": `import { fetch } from "./server.js"; export default { fetch };`,
      "server.js": `export const fetch = async (request) => (await import("virtual:ud:catch-all")).default.fetch(request);`,
    });
    expect(warnings).toEqual([]);
  });

  it("warns if virtual:ud:catch-all isn't imported", async () => {
    const warnings = await build({
      "entry.js": `export default { fetch: () => new Response("hello") };`,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`doesn't import "virtual:ud:catch-all" (directly or indirectly)`);
  });

  it("doesn't warn if the entry handles requests itself (catchAll: false)", async () => {
    const warnings = await build({ "entry.js": `export default { fetch: () => new Response("hello") };` }, (entry) => [
      catchAll(),
      target(entry, { catchAll: false }),
    ]);
    expect(warnings).toEqual([]);
  });

  it("doesn't warn with universalDeploy({ entry: { id, catchAll: false } })", async () => {
    const warnings = await build({ "entry.js": `export default { fetch: () => new Response("hello") };` }, (entry) =>
      auto({ entry: { id: entry, catchAll: false } }),
    );
    expect(warnings).toEqual([]);
  });
});
