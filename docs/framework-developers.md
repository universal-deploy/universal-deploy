# Framework Developer Guide

`universal-deploy` provides a toolset for framework developers to make their Vite frameworks compatible with any deployment provider (Netlify, Vercel, Cloudflare, Node, Bun, Deno, etc.) without any extra configuration from their users.

The core idea is that a framework should explicitly declare its **server entries** and **routing metadata** in a global store. Deployment providers then consume this store to generate the necessary deployment artifacts.

## Getting Started

Framework developers primarily interact with `@universal-deploy/store`.

### 1. Register Server Entries

A server entry is any module that should handle server-side requests (SSR, API routes, middleware). You register entries using `addEntry`.

It's recommended that server entries follow the `Fetchable` interface, which is becoming a de-facto standard for server-side handlers.

```ts
// Fetchable interface
export interface Fetchable {
  fetch: (request: Request) => Response | Promise<Response>;
}
```

Example of a server entry implementation:

```ts
// awesome-framework/server/render.ts
export default {
  fetch(request: Request) {
    return new Response("Hello from Universal Deploy!");
  },
};
```

You register these entries in the global store:

```ts
import { addEntry } from "@universal-deploy/store";

// A typical SSR entry
addEntry({
  id: "awesome-framework/server/render.ts",
  route: "/**", // Match all routes
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
import { auto } from "@universal-deploy/auto/vite";
import { addEntry } from "@universal-deploy/store";
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
    // Automatically enables Node.js adapter if no other target (Netlify, Vercel, etc.) is detected
    // It also includes devServer() and catchAll() plugins.
    auto({
      node: {
        // node adapter options
      }
    }),
  ];
}
```

#### The `auto()` plugin

The `@universal-deploy/auto` package provides a plugin that automatically defaults your framework to a Node.js-compatible server build when no other deployment target is present in the Vite configuration.

This is highly recommended for framework developers as it provides a "zero-config" default:
- If a user adds a deployment plugin (like `vite-plugin-vercel`), the `auto()` plugin will detect it and disable its own Node.js adapter injection.
- If the user doesn't add any deployment plugin, `auto()` will enable `@universal-deploy/node` automatically, ensuring the project is buildable and runnable in Node.js/Bun/Deno out-of-the-box.

The `auto()` plugin includes `devServer()` and `catchAll()`, so you don't need to add them separately.

#### Advanced Plugins

The `auto()` plugin includes `devServer()` and `catchAll()` by default, which is sufficient for most use cases. If you need to use these plugins individually or require more granular control, see the [Plugins documentation](./plugins.md).

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
