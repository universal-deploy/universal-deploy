# Plugins

While `universalDeploy()` is the recommended plugin for most frameworks, `universal-deploy` provides several low-level plugins for advanced use cases.

## `devServer()`

The `devServer()` plugin adds a development middleware to Vite that intercepts requests during `vite dev`.

By default, most frameworks handle their own routing. However, using `devServer()` provides out-of-the-box routing for any entry registered in the global store. This is particularly useful for **local emulation**: it ensures your development environment behaves exactly like your production environment by supporting features specific to deployment providers that also use `universal-deploy`.

## `catchAll()`

The `catchAll()` plugin is a utility that creates a virtual module named `virtual:ud:catch-all`. This module acts as a central aggregator for all registered entries in the global store.

It automatically generates a high-performance router using [rou3](https://github.com/h3js/rou3) based on the `route` and `method` metadata you provided during registration. The resulting module exports a `default.fetch(request)` handler that efficiently matches incoming requests and dispatches them to the correct entry point.

This plugin is required when using `devServer()`, but it's also invaluable for deployment providers that only support a single server entry point (such as Netlify Functions or AWS Lambda), as it handles all the routing logic for you out of the box.

## `compat()`

The `compat` plugin (available at `@universal-deploy/vite`) automatically registers SSR rollup entries in the store. This is primarily used for Vite-based frameworks that have not yet natively adopted the `universal-deploy` standard.
