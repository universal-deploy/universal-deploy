import { cloudflare } from "@cloudflare/vite-plugin";
import config from "./vite.common.config.js";

config.plugins ??= [];
// Enables building for Cloudflare Workers (development and deploy builds).
config.plugins.push(
  cloudflare({
    inspectorPort: false,
    viteEnvironment: {
      name: "ssr",
    },
  }),
);

export default config;
