import { vercel } from "vite-plugin-vercel/vite";
import config from "./vite.common.config";

config.plugins ??= [];
// Enables building for Vercel (development and deploy builds).
// vite-plugin-vercel natively supports @universal-deploy/store
config.plugins.push(
  vercel({
    viteEnvNames: {
      client: "client",
      node: "ssr",
      edge: false,
    },
  }),
);

export default config;
