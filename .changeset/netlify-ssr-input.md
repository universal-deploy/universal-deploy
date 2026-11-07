---
"@universal-deploy/netlify": patch
---

The Netlify adapter no longer overrides the input of server environments other than `ssr`, and it sets the `ssr` input from a `config` hook so other plugins can observe it during `configEnvironment`.
