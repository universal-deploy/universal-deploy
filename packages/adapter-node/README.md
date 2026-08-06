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
or above `threshold`, when the encoded form is no larger. Everything else is compressed per
request, as before.

Each build rewrites the variants it owns and deletes the ones a file no longer earns, so
rebuilding into an existing directory cannot serve a stale variant it created; a variant it
cannot delete fails the build. Files in `publicDir` are copied as-is: the build creates no
`.br`/`.gz` for them and deletes none. A variant you ship beside one is still served — keeping it
in step with its source is yours.

Not covered: a runtime `static` pointing anywhere other than the directory this build
precompressed, and a client built separately without `precompress` — both fall back to
per-request compression; and pages written by a pre-render step that runs no Vite build.
Variants left behind by a removed encoding are never looked up.
