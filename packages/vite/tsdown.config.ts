import { defineConfig, type UserConfig as TsdownOptions } from "tsdown";

const commonOptions: TsdownOptions = {
  format: ["esm"],
  target: "es2022",
  dts: true,
  outDir: "dist",
  treeshake: true,
  nodeProtocol: true,
  fixedExtension: false,
};

export default defineConfig([
  {
    ...commonOptions,
    platform: "node",
    entry: {
      index: "./src/index.ts",
      target: "./src/plugins/target.ts",
    },
  },
]);
