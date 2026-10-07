---
"@universal-deploy/vite": minor
"@universal-deploy/store": minor
---

Route patterns follow rou3 v0.12+ (1.x), which aligns them with URLPattern. The catch-all router matches requests on their percent-encoded pathname, so a route with non-ASCII characters such as `/café` now matches, and `*` matches the rest of the path, `/` included (`/files/*` matches `/files/a/b`). See the [rou3 v0.12 migration guide](https://github.com/h3js/rou3/releases/tag/v0.12.0) for the other pattern changes. `@universal-deploy/store` no longer depends on `rou3`, and `@universal-deploy/vite` uses `@universal-middleware/express` 0.5.
