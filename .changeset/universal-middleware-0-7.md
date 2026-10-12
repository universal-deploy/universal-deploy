---
"@universal-deploy/vite": patch
---

`devServer()` runs on `@universal-middleware/express` 0.6 (from 0.5), which matches Universal Middleware 0.7. It adapts requests and responses the same way; the 0.6 changes are to how `apply()` runs a list, which `devServer()` doesn't use.
