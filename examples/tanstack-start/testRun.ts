export { testRun };

import { autoRetry, expect, fetchHtml, getServerUrl, page, run, test } from "@brillout/test-e2e";

function testRun(cmd: `pnpm run ${string}`, options?: Parameters<typeof run>[1]) {
  run(cmd, {
    // Preview => builds app which takes a long time
    additionalTimeout: 120 * 1000,
    serverIsReadyMessage: "http://localhost:3000/",
    tolerateError(args) {
      // srvx
      if (args.logText.includes("Shutting down server")) return true;
      if (args.logText.includes("Server closed")) return true;
      if (typeof options?.tolerateError === "function") {
        return options.tolerateError(args);
      }
      return;
    },
    ...options,
  });

  test("page content is rendered to HTML", async () => {
    const html = await fetchHtml("/");
    expect(html).toContain("The framework for next generation AI applications");
  });

  test("page is rendered to the DOM and interactive", async () => {
    await page.goto(`${getServerUrl()}/demo/start/server-funcs`);
    await page.waitForLoadState("networkidle");

    const input = page.locator("input[type=text]");
    await input.fill("Use photon");
    const btn = page.locator("button", { hasText: "Add todo" });
    await btn.click();
    // The todo is appended after a server function round-trip, so how long the list takes to
    // update is not something the test can know: retry the assertion instead of guessing.
    await autoRetry(
      async () => {
        expect(await page.textContent("#ul")).toContain(`Use photon`);
      },
      { timeout: 5 * 1000 },
    );
  });
}
