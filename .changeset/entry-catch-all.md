---
"@universal-deploy/vite": patch
---

`universalDeploy({ entry: { id, catchAll: false } })` is for a custom server entry that handles requests itself instead of forwarding them to `virtual:ud:catch-all`, e.g. a user's server that the framework also runs in development. Then `devServer()` isn't added, and the entry doesn't have to import `virtual:ud:catch-all`.
