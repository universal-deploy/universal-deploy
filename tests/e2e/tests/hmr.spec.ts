/** biome-ignore-all lint/suspicious/noExplicitAny: tests */
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { goto } from "./utils.js";

const TEST_HMR = Boolean(process.env.HMR ?? !process.env.CI);

test.describe("Server-side HMR", () => {
  test.skip(!TEST_HMR, "disabled HMR tests");
  const apiFilePath = path.join(process.cwd(), "src/api/test.ts");
  const viteConfigPath = path.join(process.cwd(), "vite.config.ts");

  let originalApiContent: string;
  let originalViteConfig: string;

  test.beforeAll(async () => {
    // Backup original files
    originalApiContent = await fs.readFile(apiFilePath, "utf-8");
    originalViteConfig = await fs.readFile(viteConfigPath, "utf-8");
  });

  test.afterAll(async () => {
    // Restore original files
    await fs.writeFile(apiFilePath, originalApiContent, "utf-8");
    await fs.writeFile(viteConfigPath, originalViteConfig, "utf-8");
  });

  test("should hot reload API endpoint changes", async ({ page, request }) => {
    // Make initial API call and verify response
    const initialResponse = await goto(page, "/api/test");
    const initialData = await initialResponse?.text();

    expect(initialData).toBe("test");

    // Modify the API file
    const modifiedApiContent = originalApiContent.replace('"test"', '"test-HMR"');
    await fs.writeFile(apiFilePath, modifiedApiContent, "utf-8");

    // HMR applies the change asynchronously. Poll the endpoint itself rather than reloading
    // the page: the route returns text, so an attempt is one GET instead of a full page load.
    // Back off as well, so waiting the whole timeout out costs a handful of requests.
    await expect
      .poll(async () => (await request.get("/api/test")).text(), {
        timeout: 10 * 1000,
        intervals: [250, 500, 1000, 1000, 2000],
      })
      .toBe("test-HMR");
  });

  test("should hot reload vite.config.ts changes", async ({ page }) => {
    await goto(page, "/");

    const addedCode = '\nconsole.log("test");';
    const reloadPromise = page.waitForEvent("load");
    await fs.appendFile(viteConfigPath, addedCode, "utf-8");

    await expect(reloadPromise).resolves.toBeDefined();
  });
});
