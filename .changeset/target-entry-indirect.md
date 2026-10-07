---
"@universal-deploy/vite": patch
---

`universalDeploy({ entry })` now only warns if `virtual:ud:catch-all` isn't part of the server build at all. The entry no longer has to import it directly, so there's no false positive when it's imported by another module, e.g. by a framework on the entry's behalf.
