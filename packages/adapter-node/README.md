Wraps `@universal-deploy/store` entries with [srvx](https://srvx.h3.dev/) + [sirv](https://universal-middleware.dev/middlewares/sirv)

## `precompress`

Off by default. When enabled, `vite build` writes `.br`/`.gz` variants beside the eligible
static assets, and the generated server serves those files instead of compressing on every
request.

```ts
import { node } from "@universal-deploy/node/vite";

export default {
  plugins: [node({ precompress: true })],
};
```

```ts
node({
  precompress: {
    // Emitted in server-preference order: the first one the client accepts wins.
    encodings: ["br", "gzip"], // default
    // Minimum size of the original file, in bytes. No upper bound — precompression is
    // the only way to compress a file past srvx's 10 MiB on-the-fly ceiling.
    threshold: 1024, // default
  },
});
```

Variants are emitted for the extensions srvx negotiates an encoding for — `.css`, `.htm`,
`.html`, `.js`, `.json`, `.mjs`, `.svg`, `.txt`, `.wasm`, `.xml` — and only when the encoded
form is actually smaller. Files below `threshold`, already-compressed formats, and anything
srvx would not negotiate are skipped, because a variant it never looks for is dead bytes on
disk.

On-the-fly compression stays enabled either way. It still covers files below the threshold,
extensions outside that set, and anything this build did not produce.

### It deletes variants it did not write

For each file it visits, the precompressor owns the variants for **the encodings this build
emits**. If a file stops qualifying — its content changed, it dropped below the threshold, or
it stopped compressing well — the matching `.br`/`.gz` beside it is **deleted**. Without that,
a rebuild into a non-empty output directory (`emptyOutDir: false`) would leave the previous
build's variant next to the new file, and it would be served as that file's body.

If a variant cannot be removed, the build fails rather than continuing: a leftover that could
not be deleted is exactly the case that serves wrong bytes.

Files copied from `publicDir` are left alone entirely — neither compressed nor cleaned up.
They are re-copied from source on every build, so this build's output can never go stale
beside them. A `.br` you ship yourself in `public/` is still served by srvx once `precompress`
is on; keeping it in step with its source file is yours to manage.

### Leftovers when it is off, or when an encoding is dropped

Both are inert, and neither needs cleaning up. srvx only looks for a variant when the server
was built with `precompress` on, and only for the encodings that build emitted. A `.gz` left
behind after dropping `"gzip"` is never probed; re-enable it and the next build reconciles it.

### Overriding the static directory at runtime

A server entry's own `static` value wins over the build-time one. Variant lookup is enabled
**only for the directory this build precompressed**: point `static` at a *different* resolved
directory and the server falls back to on-the-fly compression rather than trusting variants
nothing reconciled. The same resolved directory keeps it. Two spellings of one directory —
Windows case differences, a symlink, a junction — compare unequal and conservatively lose the
optimization; they never risk serving the wrong bytes.

Deploying a server built with `precompress: true` in front of assets built without it has the
same effect and is not something the server can detect. Build both halves together.

### Not covered

Pages rendered by a framework's pre-render step, which writes into the output directory after
the build hooks have run, get no variants.
