import { catchAllEntry } from "@universal-deploy/store";
import { type Plugin, resolveConfig } from "vite";
import { describe, expect, it } from "vitest";
import { netlify } from "./plugin.js";

async function resolve(environments: Record<string, { consumer: "client" | "server" }>) {
  return resolveConfig(
    {
      plugins: netlify(),
      environments,
    },
    "build",
  );
}

describe("netlify()", () => {
  it("sets the ssr build input to the universal-deploy catch-all", async () => {
    const config = await resolve({ ssr: { consumer: "server" } });
    expect(config.environments.ssr?.build.rolldownOptions?.input).toEqual({ index: catchAllEntry });
  });

  it("doesn't override the input of other server environments", async () => {
    const config = await resolve({ ssr: { consumer: "server" }, worker: { consumer: "server" } });
    expect(config.environments.worker?.build.rolldownOptions?.input).toBeUndefined();
  });

  it("sets the ssr input before other plugins' configEnvironment hooks run", async () => {
    let seenInput: unknown;
    const observer: Plugin = {
      name: "test:observer",
      configEnvironment(name, config) {
        if (name === "ssr") seenInput = config.build?.rolldownOptions?.input;
      },
    };
    await resolveConfig(
      {
        plugins: [observer, ...netlify()],
        environments: { ssr: { consumer: "server" } },
      },
      "build",
    );
    expect(seenInput).toEqual({ index: catchAllEntry });
  });
});
