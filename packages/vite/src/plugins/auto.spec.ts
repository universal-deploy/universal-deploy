import { node } from "@universal-deploy/node/vite";
import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";
import { auto } from "./auto.js";

// Mock/Stub plugins for other adapters to simulate their presence
const mockVercelPlugin = () => ({ name: "vite-plugin-vercel" });
const mockCloudflarePlugin = () => ({ name: "vite-plugin-cloudflare" });
const mockNetlifyPlugin = () => ({ name: "vite-plugin-netlify" });

describe("auto() plugin", () => {
  it("enables node adapter when no other target is present", async () => {
    const plugins = auto();
    const config = await resolveConfig(
      {
        plugins: [plugins],
      },
      "build",
    );

    const nodePlugin = config.plugins.find((p) => p.name.startsWith("ud:node:emit"));
    expect(nodePlugin).toBeDefined();
    expect(nodePlugin?.name).not.toContain(":disabled");
  });

  it("disables node adapter when vite-plugin-vercel is present", async () => {
    const plugins = auto();
    const config = await resolveConfig(
      {
        plugins: [mockVercelPlugin(), plugins],
      },
      "build",
    );

    const nodePlugin = config.plugins.find((p) => p.name.startsWith("ud:node:emit"));
    expect(nodePlugin?.name).toBe("ud:node:emit:disabled");
  });

  it("disables node adapter when vite-plugin-cloudflare is present", async () => {
    const plugins = auto();
    const config = await resolveConfig(
      {
        plugins: [mockCloudflarePlugin(), plugins],
      },
      "build",
    );

    const nodePlugin = config.plugins.find((p) => p.name.startsWith("ud:node:emit"));
    expect(nodePlugin?.name).toBe("ud:node:emit:disabled");
  });

  it("disables node adapter when netlify plugin is present", async () => {
    const plugins = auto();
    const config = await resolveConfig(
      {
        plugins: [mockNetlifyPlugin(), plugins],
      },
      "build",
    );

    const nodePlugin = config.plugins.find((p) => p.name.startsWith("ud:node:emit"));
    expect(nodePlugin?.name).toBe("ud:node:emit:disabled");
  });

  it("disables node adapter when auto() is already present", async () => {
    const plugins = auto();
    const config = await resolveConfig(
      {
        plugins: [auto(), plugins],
      },
      "build",
    );

    // One of them should be disabled.
    const nodePlugins = config.plugins.filter((p) => p.name.startsWith("ud:node:emit"));
    expect(nodePlugins.some((p) => p.name === "ud:node:emit:disabled")).toBe(true);
  });

  it("disables node adapter when node() is already present", async () => {
    const plugins = auto();
    const config = await resolveConfig(
      {
        plugins: [node(), plugins],
      },
      "build",
    );

    // auto() should see node() and disable its own node plugins.
    const nodePlugins = config.plugins.filter((p) => p.name.startsWith("ud:node:emit"));
    expect(nodePlugins.some((p) => p.name === "ud:node:emit:disabled")).toBe(true);
    expect(nodePlugins.some((p) => p.name === "ud:node:emit")).toBe(true);
  });
});
