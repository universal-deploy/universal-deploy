import netlify from "@netlify/vite-plugin";
import netlifyCompat from "@universal-deploy/netlify/vite";
import { awesomeFramework } from "awesome-framework/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // Official Netlify Vite plugin
    netlify({
      build: {
        enabled: true,
      },
    }),
    // Small plugin that sets rolldownOptions.input to virtual:ud:catch-all
    netlifyCompat(),
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
});
