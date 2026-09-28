export const catchAllId = "ud:catch-all" as const;

/**
 * Global symbol key set on the 404 response returned by the catch-all when no route matches. The dev server uses it
 * to fall through to Vite's own middlewares (e.g. index.html) instead of sending the 404.
 */
export const unmatchedKey = "universal-deploy:unmatched" as const;
export const INSTANCE = Symbol("auto-instance");
