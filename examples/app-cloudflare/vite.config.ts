import { cloudflare } from "@cloudflare/vite-plugin";
import { awesomeFramework } from "awesome-framework/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      inspectorPort: false,
      viteEnvironment: {
        name: "ssr",
      },
    }),
    // Minimal SSR framework. Includes devServer and catchAll plugins from universal-deploy
    awesomeFramework({
      additionalEntries: [
        {
          id: "./src/api/test.ts",
          route: "/api/test",
        },
      ],
    }),
  ],
  ssr: {
    optimizeDeps: {
      exclude: ["@universal-middleware/core", "@universal-middleware/srvx"],
    },
  },
});
