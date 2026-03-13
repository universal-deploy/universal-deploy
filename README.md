# universal-deploy

*Deploy Vite apps anywhere.*

## Goal

The goal of the Universal Deploy project is to enable any Vite app (vanilla Vite, Astro, Vike, TanStack, ...) to be deployed anywhere (Netlify, Cloudflare, Vercel, self-hosted, ...), in a zero-config fashion.

**Zero-config**

The user just adds a deployment Vite plugin (`@netlify/vite-plugin`/`@cloudflare/vite-plugin`/`vite-plugin-vercel`/`@edgeone/vite`/...) to `vite.config.js` — that's it. Deployment Vite plugins deeply integrate in a zero-config and seamless fashion.

## Approach

Our approach follows [Netlify's RFC](https://github.com/vitejs/vite/discussions/20907): the `@universal-deploy/*` packages provide a flexible toolset of low-level utilities and conventions, enabling integrations that are both flexible and seamless between Vite apps and deployment providers.

> [!NOTE]
> The `@universal-deploy/*` packages are only used internally by frameworks and deployment providers — users don't see the existence of `@universal-deploy/*`.

This repository is a POC that solves the issue point 1 and 3 of [Netlify's RFC](https://github.com/vitejs/vite/discussions/20907), i.e. "Server entry point location" and "Routing metadata".
Mostly, how can a deployment target (Netlify, Cloudflare, Node, etc.) find and use the different server entries defined by a framework (or user)?

This POC demonstrates that we can solve this issue with a minimal API.

## Features

- **Global Store**: Register server entries ([`@universal-deploy/store`](./packages/store))
- **Universal Routing**: Via the [`URLPattern` standard](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern)
- **Minimal conventions**: Can easily be adopted by any Vite-based framework

## Core Concepts

### Store

[`@universal-deploy/store`](./packages/store) provides a global registry for server entries with routing:

```js
import { addEntry } from "@universal-deploy/store";

addEntry({
  id: "./src/server/api.ts",
  route: "/api/*",
  method: "GET",
});
```

See the [store documentation](./packages/store/README.md) for full API details.

### Vite Plugins

The following Vite plugins help frameworks and deployment providers work with the global entries store.

- **[`universalDeploy()`](./packages/vite)**: Automatically defaults to the Node.js adapter if no other supported deployment target is found. Includes `devServer` and `catchAll`.

For advanced usage and low-level plugins like `devServer`, `catchAll`, and `compat`, see the [Plugins documentation](./docs/plugins.md).

### Adapters

Temporary packages that demonstrate how deployment plugins can integrate `@universal-deploy/store`.
Packages like `@universal-deploy/netlify` will no longer be required once directly supported by Vite deployment plugins (e.g. `@netlify/vite-plugin`).

- **[`@universal-deploy/netlify`](./packages/adapter-netlify)**
- **[`@universal-deploy/node`](./packages/adapter-node)** (Node.js, Bun, Deno)

Already compatible:

- **`@cloudflare/vite-plugin`**
- **[`vite-plugin-vercel@beta`](https://github.com/magne4000/vite-plugin-vercel/pull/207)**

## Usage
### Framework authors

[Call `addEntry`](https://github.com/photon-js/universal-deploy/blob/f1395bc6c0b4854ece54b8ef6bf42b18ed3ffbf6/tests/awesome-framework/src/vite/universalDeployPlugin.ts#L19) at any point, preferably before `configResolved` hooks.

See the [Framework Developer Guide](./docs/framework-developers.md) for more details.

### Deployment plugin authors

For deployment providers requiring a unique server entry, the easiest way is to [set `rolldownOptions.input` to `catchAllEntry`](https://github.com/photon-js/universal-deploy/blob/50cd8eec4086ca45698d70f79195114628a74658/packages/adapter-netlify/src/plugin.ts#L22). This virtual entry will be resolved by the [`catchAll`](./packages/store/src/vite/catch-all.ts) plugin.

For deployment providers with support for multiple server entries, [use `getAllEntries`](https://github.com/photon-js/universal-deploy/blob/966993932f2dc98bfc0a6f75ae7a6e9d55ab3f2d/packages/store/src/index.ts#L36) in a `post` `configEnvironment` hook and set `rolldownOptions.input`.

> [!NOTE]
> [`this.emitFile`](https://rollupjs.org/plugin-development/#this-emitfile) can also be used at later stages to achieve the same result.

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
