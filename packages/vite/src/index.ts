export { node } from "@universal-deploy/node/vite";
export type { Fetchable, ServerOptions } from "@universal-deploy/store";
export * from "./const.js";
export { auto } from "./plugins/auto.js";
export { catchAll } from "./plugins/catch-all.js";
export { devServer } from "./plugins/dev-server.js";
export { hmr } from "./plugins/hmr.js";
export { isServerEntry, resolver } from "./plugins/resolver.js";
export { compat } from "./plugins/rollup-entries-compat.js";
export { resolveTargets, type SupportedTargets } from "./plugins/supported.js";

import { auto as universalDeploy } from "./plugins/auto.js";

export default universalDeploy;
