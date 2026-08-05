import { node } from "@universal-deploy/node/vite";
import config from "./vite.common.config.js";

config.plugins ??= [];
// Enables building for server runtimes (Node, Bun, Deno).
config.plugins.push(
  node({
    static: "dist/client",
  }),
);

export default config;
