import { hmr, node, resolver } from "@universal-deploy/vite";
import { awesomeFramework } from "awesome-framework/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // Emits dist/index.js
    node(),
    // Minimal SSR framework. Includes devServer and catchAll plugins from universal-deploy
    awesomeFramework({
      additionalEntries: [
        {
          id: "./src/api/test.ts",
          route: "/api/test",
        },
      ],
    }),
    resolver(),
    hmr(),
  ],
});
