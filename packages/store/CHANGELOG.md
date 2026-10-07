# @universal-deploy/store

## 0.3.0

### Minor Changes

- f5c5505: Route patterns follow rou3 v0.12+ (1.x), which aligns them with URLPattern. The catch-all router matches requests on their percent-encoded pathname, so a route with non-ASCII characters such as `/café` now matches, and `*` matches the rest of the path, `/` included (`/files/*` matches `/files/a/b`). See the [rou3 v0.12 migration guide](https://github.com/h3js/rou3/releases/tag/v0.12.0) for the other pattern changes. `@universal-deploy/store` no longer depends on `rou3`, and `@universal-deploy/vite` uses `@universal-middleware/express` 0.5.

## 0.2.2

### Patch Changes

- 97e4393: fix: upgrade dependencies

## 0.2.1

### Patch Changes

- b96ff1f: feat: onReady and onCreate hooks

## 0.2.0

### Minor Changes

- a59afa8: feat: @universal-deploy/vite package

### Patch Changes

- 8fc901f: feat: onReady and onCreate hooks

## 0.1.4

### Patch Changes

- 00aa5fc: fix: upgrade dependencies

## 0.1.1

### Patch Changes

- 5e427e3: fix: smarter entry deduplication

## 0.1.0

### Minor Changes

- 901b774: Add helpers to interact with the global store

## 0.0.7

### Patch Changes

- f48788e: feat: hmr plugin
