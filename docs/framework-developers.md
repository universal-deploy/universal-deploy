# Framework Developer Guide

`universal-deploy` provides a toolset for framework developers to make their Vite frameworks compatible with any deployment provider (Netlify, Vercel, Cloudflare, Node, Bun, Deno, etc.) without any extra configuration from their users.

The core idea is that a framework should explicitly declare its **server entries** and **routing metadata** in a global store. Deployment providers then consume this store to generate the necessary deployment artifacts.

## Getting Started

Framework developers primarily interact with `@universal-deploy/store`.

### 1. Register Server Entries

A server entry is any module that should handle server-side requests (SSR, API routes, middleware). You register entries using `addEntry`.

```ts
import { addEntry } from "@universal-deploy/store";

// A typical SSR entry
addEntry({
  id: "awesome-framework/server/render.ts",
  route: "/**", // Match all routes
});

// A specific API route
addEntry({
  id: "awesome-framework/server/api/user.ts",
  route: "/api/user",
  method: "GET",
});
```

#### Entry Configuration Options

| Option | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Module identifier (filesystem path or virtual module). |
| `route` | `string \| string[]` | Route pattern(s) (using [rou3](https://github.com/h3js/rou3) syntax). |
| `method` | `string \| string[]` | (Optional) HTTP method(s) (e.g., `"GET"`, `["POST", "PUT"]`). |
| `environment` | `string` | (Optional) The Vite environment for this entry (defaults to `"ssr"`). |

### 2. Integration via Vite Plugin

It's recommended to create a Vite plugin for your framework that registers these entries. Use the `config` hook with `order: "pre"` to ensure entries are registered early.

```ts
import { addEntry } from "@universal-deploy/store";
import { catchAll, devServer } from "@universal-deploy/store/vite";
import type { Plugin } from "vite";

export function myFrameworkPlugin(): Plugin[] {
  let entriesInjected = false;

  return [
    {
      name: "my-framework:universal-deploy",
      config: {
        order: "pre",
        handler() {
          if (entriesInjected) return;
          entriesInjected = true;

          // Register framework-specific entries
          addEntry({
            id: "my-framework/ssr",
            route: "/**",
          });
        },
      },
    },
    // Enables request routing during development
    devServer(),
    // Aggregates all global store entries behind a unique entry (required by devServer)
    catchAll(),
  ];
}
```

#### The `devServer` and `catchAll` Plugins

While many frameworks handle their own routing via a custom Vite plugin, `universal-deploy` provides two optional plugins to help with development and some deployment targets.

##### `devServer()`

The `devServer()` plugin adds a development middleware to Vite that intercepts requests during `vite dev`.

By default, most frameworks handle their own routing. However, using `devServer()` provides out-of-the-box routing for any entry registered in the global store. This is particularly useful for **local emulation**: it ensures your development environment behaves exactly like your production environment by supporting features specific to deployment providers that also use `universal-deploy`.

##### `catchAll()`

The `catchAll()` plugin is a utility that creates a virtual module named `virtual:ud:catch-all`. This module acts as a central aggregator for all registered entries in the global store.

It automatically generates a high-performance router using [rou3](https://github.com/h3js/rou3) based on the `route` and `method` metadata you provided during registration. The resulting module exports a `default.fetch(request)` handler that efficiently matches incoming requests and dispatches them to the correct entry point.

This plugin is required when using `devServer()`, but it's also invaluable for deployment providers that only support a single server entry point (such as Netlify Functions or AWS Lambda), as it handles all the routing logic for you out of the box.

### 3. Development Mode Support

By adding `devServer()` and `catchAll()` to your plugin list, `universal-deploy` will automatically handle routing during `vite dev`. Requests matching your registered routes will be forwarded to their respective entry points within the Vite environment.

## Advanced Usage

### Virtual Modules

If your framework generates server entry code on the fly, you can use virtual modules as `id`.

```ts
addEntry({
  id: "virtual:my-framework-entry",
  route: "/**",
});
```

Just ensure you have a Vite plugin that resolves and loads `virtual:my-framework-entry`.

## Why adopt this?

1.  **Zero-Config for Users**: Users don't need to configure adapters or deployment-specific settings. They just add a deployment plugin (like `@netlify/vite-plugin`) and it "just works" because your framework has already provided the necessary metadata.
2.  **Universal Compatibility**: By using a common store, your framework becomes compatible with every deployment provider that supports the `universal-deploy` standard.
3.  **Future-Proof**: This approach is based on ongoing [Vite RFCs](https://github.com/vitejs/vite/discussions/20907) for universal deployment.
