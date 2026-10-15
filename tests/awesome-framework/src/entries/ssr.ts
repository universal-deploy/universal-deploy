import indexHtml from "virtual:awesome-plugin:index-js";
import type { ServerOptions } from "@universal-deploy/store";
import { enhance, pipe } from "@universal-middleware/core";
import { createHandler } from "@universal-middleware/srvx";
import { loggerMiddleware } from "./logger.js";

export const ssrMiddleware = enhance(
  (_request: Request) => {
    return new Response(indexHtml, {
      status: 200,
      headers: {
        "Content-Type": "text/html",
      },
    });
  },
  // enhance() adds meta data (a Universal Middleware in itself is just a Request => Response function)
  {
    name: "awesome-framework:ssr",
    path: "/**",
    method: "GET",
  },
);

// WebSocket echo at /ws
const websocket: ServerOptions["websocket"] = {
  upgrade(request) {
    if (new URL(request.url).pathname !== "/ws") throw new Response("Not Found", { status: 404 });
  },
  message(peer, message) {
    peer.send(`echo: ${message.text()}`);
  },
};

const defaultExport = /* @__PURE__ */ (() => ({
  fetch: createHandler(() => pipe(loggerMiddleware, ssrMiddleware))(),
  websocket,
}))();

export default defaultExport;
