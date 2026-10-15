Wraps `@universal-deploy/store` entries with [srvx](https://srvx.h3.dev/).

## `precompress`

Off by default. Emits `.br`/`.gz` beside eligible static assets at build time and serves those
files instead of compressing on every request.

```ts
import { node } from "@universal-deploy/node/vite";

node({ precompress: true })
// or, with the defaults spelled out:
node({
  precompress: {
    encodings: ["br", "gzip"], // the first one the client accepts wins
    threshold: 1024, // minimum size of the original file, in bytes
  },
})
```

Eligible: `.css`, `.htm`, `.html`, `.js`, `.json`, `.mjs`, `.svg`, `.txt`, `.wasm` and `.xml`, at
or above `threshold`, when the encoded form is no larger. Everything else is left to srvx's own
static handling, as before.

Variants track their sources: a file that earns one has it, a file that no longer does has it
removed, and a removal that fails stops the build. Files in `publicDir` are copied as-is: the build creates no
`.br`/`.gz` for them and deletes none. A variant you ship beside one is still served — keeping it
in step with its source is yours.

Not covered: a runtime `static` pointing anywhere other than the directory this build
precompressed, and a client built separately without `precompress` — both fall back to srvx's
own static handling; and pages written by a pre-render step that runs no Vite build.
Variants left behind by a removed encoding are never looked up.

## WebSockets

The default export of an entry registered with `route: "/**"` can define [crossws](https://crossws.h3.dev/) hooks as
`websocket`, next to `fetch()`. Install `crossws` to use them: it's an optional peer dependency.

```ts
import type { ServerOptions } from "@universal-deploy/store";

export default {
  fetch(request: Request) {
    return new Response("Hello");
  },
  websocket: {
    upgrade(request) {
      // Every WebSocket connection is passed to these hooks: reject the ones you don't handle
      if (new URL(request.url).pathname !== "/ws") throw new Response("Not Found", { status: 404 });
    },
    message(peer, message) {
      peer.send(`echo: ${message.text()}`);
    },
  },
} satisfies ServerOptions;
```

In development, `devServer()` passes WebSocket connections to the same hooks, except Vite's HMR connections.

On Bun and Deno, build the server with the runtime that runs it. `bun run build` runs Vite with Node.js, and a server
built with Node.js can't serve WebSockets on Bun: it logs a warning and serves HTTP requests only. Use
`bun --bun run build` instead. `deno run build` runs Vite with Deno.
