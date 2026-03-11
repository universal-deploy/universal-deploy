import { defineConfig, type UserConfig as TsdownOptions } from "tsdown";

const commonOptions: TsdownOptions = {
  format: ["esm"],
  target: "es2022",
  dts: true,
  outDir: "dist",
  treeshake: true,
  nodeProtocol: true,
  fixedExtension: false,
  deps: {
    neverBundle: ["virtual:awesome-plugin:index-js"],
  },
};

export default defineConfig([
  {
    ...commonOptions,
    platform: "node",
    entry: {
      vite: "./src/vite/index.ts",
      "entries/api": "./src/entries/api.ts",
      "entries/ssr": "./src/entries/ssr.ts",
    },
  },
]);
