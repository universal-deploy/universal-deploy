import { netlify } from "@universal-deploy/netlify/vite";
import config from "./vite.common.config.js";

config.plugins ??= [];
// Enables building for Netlify (development and deploy builds).
config.plugins.push(
  // re-exports @netlify/vite-plugin, and sets rolldownOptions.input to virtual:ud:catch-all
  netlify(),
);

export default config;
