import { awesomeFramework } from "awesome-framework/vite";
import { defineConfig } from "vite";
import { vercel } from "vite-plugin-vercel/vite";

export default defineConfig({
  plugins: [
    // vite-plugin-vercel@11 uses Universal Deploy (i.e. it uses the global store @universal-deploy/store)
    vercel(),
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
