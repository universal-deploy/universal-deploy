# universal-deploy

*Deploy Vite apps anywhere.*

## Overview

The Universal Deploy project enables any Vite app (vanilla Vite, Astro, Vike, TanStack Start, ...) to be deployed anywhere (Netlify, Cloudflare, Vercel, self-hosted, ...), in a zero-config fashion.

Our approach follows [Netlify's RFC](https://github.com/vitejs/vite/discussions/20907): the `@universal-deploy/*` packages provide a flexible toolset of low-level utilities and conventions, enabling integrations that are both flexible and seamless between Vite apps and deployment providers.

> [!NOTE]
> The `@universal-deploy/*` packages are only used internally by frameworks and deployment providers — users don't see the existence of Universal Deploy.

This repository is a POC that solves the issue 1 and 3 of [Netlify's RFC](https://github.com/vitejs/vite/discussions/20907) — "Server entry point location" and "Routing metadata". It demonstrates how a deployment target (Netlify, Cloudflare, Node, etc.) can find and use the different server entries defined by a framework with minimal API.

### Features

- For **users**: zero-config deployment — apps **work out-of-the-box with the preferred deployment provider**. No third-party package installation required other than the official Vite plugin of the deployment provider.
- For **framework maintainers**: standardized way to register server entries and routing metadata, making the framework **compatible with deployment providers with a single integration**.
- For **deployment providers**: automatic discovery and handling of server entries. **No more custom logic for every framework**; just read from the global store.

> [!NOTE]
> - **Universal Routing**: Uses a common routing format (`rou3`) that is understood by all participants.
> - **Minimal Conventions**: Low-level utilities that are easy to adopt and don't get in the way of framework-specific logic.


## For Framework Developers

Frameworks can register their server entries and routing information into a global store. This allows deployment providers to automatically discover and handle them.

### How it works

Use [`@universal-deploy/store`](./packages/store) to register server entries with routing information:

```js
import { addEntry } from "@universal-deploy/store";

addEntry({
  id: "./src/server/api.ts",
  route: "/api/*",
  method: "GET",
});
```

> [!NOTE]
> `addEntry` isn't a definitive API; a common convention between all actors has yet to be established.

### Integration

[Call `addEntry`](https://github.com/photon-js/universal-deploy/blob/f1395bc6c0b4854ece54b8ef6bf42b18ed3ffbf6/tests/awesome-framework/src/vite/universalDeployPlugin.ts#L19) at any point, preferably before `configResolved` hooks.

For extensive documentation on how to integrate your framework, see the [Framework Developer Guide](./docs/framework-developers.md).

## For Deployment Providers

Deployment providers read from the global store or use the provided catchall entry to handle routing and server entry discovery.

### Implementation

- **For unique server entry**: Set `rolldownOptions.input` to `catchAllEntry`. This virtual entry will be resolved by the [`catchAll`](./packages/store/src/vite/catch-all.ts) plugin.
- **For multiple server entries**: [Use `getAllEntries`](https://github.com/photon-js/universal-deploy/blob/966993932f2dc98bfc0a6f75ae7a6e9d55ab3f2d/packages/store/src/index.ts#L36) in a `post` `configEnvironment` hook and set `rolldownOptions.input`.
- **Vite Plugin**: The [`universalDeploy()`](./packages/vite) plugin automatically defaults to the Node.js adapter if no other supported deployment target is found.

### Examples

For implementation examples, see:
- [`adapter-node`](./packages/adapter-node) (Node.js, Bun, Deno)
- [`adapter-netlify`](./packages/adapter-netlify)
- [`vite-plugin-vercel@11`](https://github.com/magne4000/vite-plugin-vercel)

> [!NOTE]
> `@cloudflare/vite-plugin` works OOTB with Universal Deploy.

See the [Plugins documentation](./docs/plugins.md) for more details.

## Examples

- [`examples/tanstack-start`](./examples/tanstack-start): TanStack Start app deployed to Netlify, Cloudflare, Vercel, or Node.js/Bun/Deno.
- Minimal examples:
  - [`examples/app-node`](./examples/app-node)
  - [`examples/app-vercel`](./examples/app-vercel)
  - [`examples/app-netlify`](./examples/app-netlify)
  - [`examples/app-cloudflare`](./examples/app-cloudflare)

## See also

- [Netlify's RFC](https://github.com/vitejs/vite/discussions/20907)
  - [RFC: Mechanism to allow deployment providers to route requests to built environments](https://github.com/vitejs/ecosystem/issues/4)
  - [Align on Vite's intended scope to allow for framework-agnostic provider plugins](https://github.com/vitejs/ecosystem/issues/3)
  - [RFC: Expose a server route manifest](https://github.com/vitejs/vite/discussions/21212)
- Vike's journey (that led us to Universal Deploy)
  - Introducing Universal Deploy — 🚧
  - [Introducing Photon](https://vike.dev/blog/photon) *October 28, 2025*
  - [Introducing `vike-server`](https://vike.dev/blog/vike-server) *March 26, 2025*

## License

MIT
