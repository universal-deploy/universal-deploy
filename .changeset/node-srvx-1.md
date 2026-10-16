---
"@universal-deploy/node": patch
---

`@universal-deploy/node` depends on `srvx` 1 (from 0.12), the version `@vitejs/plugin-rsc` uses, so an app using both installs one `srvx` and one copy of the packages that depend on it, such as `vike`.
