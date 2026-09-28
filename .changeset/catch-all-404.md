---
"@universal-deploy/vite": patch
---

fix(vite): `catchAll()` returns a `404 Not Found` response instead of `undefined` when no route matches (the dev server still falls through to Vite's middlewares)
