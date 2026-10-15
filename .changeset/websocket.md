---
"@universal-deploy/store": patch
"@universal-deploy/vite": patch
"@universal-deploy/node": patch
---

A server entry can handle WebSocket connections: its default export can define [crossws](https://crossws.h3.dev/) hooks as `websocket`, next to `fetch()`. `devServer()` passes WebSocket connections to them in development (except Vite's HMR connections), and `@universal-deploy/node` in production, on Node.js, Bun and Deno. `crossws` is an optional peer dependency: install it to use `websocket`. On Bun, build the server with Bun (`bun --bun run build`): a server built with Node.js can't serve WebSockets on Bun, it logs a warning and serves HTTP requests only.
