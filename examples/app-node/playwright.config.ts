import base from "@universal-deploy/e2e/config";

// This app enables precompression and serves WebSockets (node()), so the shared suite runs these cases here. Except
// WebSockets on Bun: CI builds this app with `bun run build`, which runs Vite with Node.js, and a server built with
// Node.js can't serve WebSockets on Bun.
const websocket = !process.env.RUN_CMD?.startsWith("bun ");
const config: typeof base = { ...base, metadata: { ...base.metadata, precompress: true, websocket } };

export default config;
