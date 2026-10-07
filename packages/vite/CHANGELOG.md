# @universal-deploy/vite

## 0.2.1

### Patch Changes

- 78d95e4: `universalDeploy({ entry })` now only warns if `virtual:ud:catch-all` isn't part of the server build at all. The entry no longer has to import it directly, so there's no false positive when it's imported by another module, e.g. by a framework on the entry's behalf.

## 0.2.0

### Minor Changes

- f5c5505: Route patterns follow rou3 v0.12+ (1.x), which aligns them with URLPattern. The catch-all router matches requests on their percent-encoded pathname, so a route with non-ASCII characters such as `/café` now matches, and `*` matches the rest of the path, `/` included (`/files/*` matches `/files/a/b`). See the [rou3 v0.12 migration guide](https://github.com/h3js/rou3/releases/tag/v0.12.0) for the other pattern changes. `@universal-deploy/store` no longer depends on `rou3`, and `@universal-deploy/vite` uses `@universal-middleware/express` 0.5.

### Patch Changes

- Updated dependencies [f9de08a]
- Updated dependencies [f5c5505]
  - @universal-deploy/node@0.1.13
  - @universal-deploy/store@0.3.0
  - @universal-deploy/netlify@0.2.4

## 0.1.14

### Patch Changes

- de755cf: fix(vite): `catchAll()` returns a `404 Not Found` response instead of `undefined` when no route matches (the dev server still falls through to Vite's middlewares)

## 0.1.13

### Patch Changes

- 014752d: feat(node): export `precompress()` to emit `.br`/`.gz` variants without the node adapter
- 3d5d3de: feat(node): export `precompressFiles()` to emit `.br`/`.gz` variants for files written after the build
- Updated dependencies [014752d]
- Updated dependencies [3d5d3de]
  - @universal-deploy/node@0.1.12

## 0.1.12

### Patch Changes

- bcd3e65: feat(node): opt-in build-time precompression of static assets (`node({ precompress: true })`)
- Updated dependencies [bcd3e65]
  - @universal-deploy/node@0.1.11

## 0.1.11

### Patch Changes

- 97e4393: fix: upgrade dependencies
- Updated dependencies [0eb9334]
- Updated dependencies [ff1f103]
- Updated dependencies [97e4393]
  - @universal-deploy/node@0.1.10
  - @universal-deploy/netlify@0.2.3
  - @universal-deploy/store@0.2.2

## 0.1.10

### Patch Changes

- 421d9ad: feat: add `entry` option for custom server entry

## 0.1.9

### Patch Changes

- ddc38a3: fix: enhance catchAll plugin with eager module handling for fallback routes

## 0.1.8

### Patch Changes

- d07d821: fix: re-export fallback entry

## 0.1.7

### Patch Changes

- 82db7bd: feat: auto install glue plugins

## 0.1.6

### Patch Changes

- a2864e0: fix: `catchAll` plugin now relies on dynamic imports

## 0.1.5

### Patch Changes

- fcb526f: fix: previous release

## 0.1.4

### Patch Changes

- 64ed76d: feat: resolveTargets now receives an array

## 0.1.3

### Patch Changes

- a10501c: feat: `resolveTargets` plugin

## 0.1.2

### Patch Changes

- 379e277: feat: better cloudflare support

## 0.1.1

### Patch Changes

- b96ff1f: feat: onReady and onCreate hooks
- Updated dependencies [b96ff1f]
  - @universal-deploy/node@0.1.4
  - @universal-deploy/store@0.2.1

## 0.1.0

### Minor Changes

- a59afa8: feat: @universal-deploy/vite package

### Patch Changes

- 8fc901f: feat: onReady and onCreate hooks
- Updated dependencies [8fc901f]
- Updated dependencies [a59afa8]
  - @universal-deploy/node@0.1.3
  - @universal-deploy/store@0.2.0
