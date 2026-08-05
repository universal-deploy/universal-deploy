Wraps `@universal-deploy/store` entries with [srvx](https://srvx.h3.dev/) + [sirv](https://universal-middleware.dev/middlewares/sirv)

## `precompress`

Off by default. Emits `.br`/`.gz` beside eligible static assets at build time and serves those
files instead of compressing on every request.

```ts
node({ precompress: true })
// or, with the defaults spelled out:
node({
  precompress: {
    encodings: ["br", "gzip"], // the first one the client accepts wins
    threshold: 1024, // minimum size of the original file, in bytes
  },
})
```

Applies to `.css`, `.htm`, `.html`, `.js`, `.json`, `.mjs`, `.svg`, `.txt`, `.wasm` and `.xml`,
and only when the encoded form is smaller. On-the-fly compression stays on for everything else.

- **Variants stay in sync with their sources.** Each build reconciles the `.br`/`.gz` beside
  every file it visits: rewritten when the source changed, removed when the file no longer
  qualifies. That is what keeps a rebuild into an existing directory from serving a previous
  build's variant. If one cannot be removed, the build stops rather than leave it.
- **`publicDir` files are yours.** Never compressed or cleaned up. A `.br` you ship in `public/`
  is still served; keeping it in step with its source is up to you.
- **Runtime `static` wins.** Variant lookup is enabled only for the directory this build
  precompressed; a different resolved directory falls back to on-the-fly compression.
- **Not covered:** pages produced by a separate pre-render run (`$ vike prerender`), which
  starts no Vite build; and assets built without `precompress` behind a server built with it —
  build both together. Leftovers from a disabled option or a dropped encoding are never probed,
  so they are inert.
