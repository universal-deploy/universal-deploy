import { expect, type Page, test } from "@playwright/test";
import { goto } from "./utils.js";

// Opens a WebSocket from the browser and resolves with its first message, with `"error"`, or with `"timeout"` (e.g. an
// upgrade request that nothing handles)
function connect(page: Page, pathname: string) {
  return page.evaluate(
    (pathname) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${pathname}`);
        ws.onopen = () => ws.send("hello");
        ws.onmessage = (event) => {
          resolve(String(event.data));
          ws.close();
        };
        ws.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 5000);
      }),
    pathname,
  );
}

test("WebSocket connections are handled by the `websocket` hooks", async ({ page }, testInfo) => {
  test.skip(!testInfo.config.metadata.websocket, "app does not serve WebSockets");
  await goto(page, "/");
  expect(await connect(page, "/ws")).toBe("echo: hello");
});

test("the `upgrade()` hook can reject a WebSocket connection", async ({ page }, testInfo) => {
  test.skip(!testInfo.config.metadata.websocket, "app does not serve WebSockets");
  await goto(page, "/");
  expect(await connect(page, "/not-ws")).toBe("error");
});
