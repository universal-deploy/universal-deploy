import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { goto } from "./utils.js";

test.describe.configure({ mode: "parallel" });

test("page content is rendered to HTML", async ({ page }) => {
  await goto(page, "/");
  const h1 = page.locator("h1");
  await expect(h1).toHaveText("Hello Vite!");
  await expect(h1).toHaveCSS("font-size", "51.2px");
  const button = page.locator("button");
  await expect(button).toHaveId("counter");
  await expect(button).toHaveCSS("font-size", "16px");
});

test("page is rendered to the DOM and interactive", async ({ page }) => {
  await goto(page, "/");
  await testCounter(page);
});

test("/api", async ({ request }) => {
  const response = await request.get("/api");
  expect(await response.text()).toBe("The API Route");
});

test("precompressed asset is served from disk", async ({ request }) => {
  test.skip(!process.env.UD_PRECOMPRESS, "app does not enable precompression");
  test.skip(!process.env.RUN_CMD, "production build only");

  // An asset with a variant beside it. Finding none is a failure, not a skip: the
  // build is supposed to have produced one.
  const root = path.join(process.cwd(), "dist/client");
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const variant = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".br"))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    // Prefer a fingerprinted asset — its URL is stable and it is never rendered.
    .sort((a, b) => Number(b.startsWith("assets")) - Number(a.startsWith("assets")))[0];
  expect(variant, `no .br variant under ${root}`).toBeTruthy();

  const identity = (variant as string).slice(0, -".br".length);
  const size = (await fs.stat(path.join(root, variant as string))).size;

  const url = `/${identity.split(path.sep).join("/")}`;
  const response = await request.get(url, { headers: { "accept-encoding": "br" } });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-encoding"]).toBe("br");
  // The discriminator: an on-the-fly encode is chunked and carries no length, so this
  // is what separates serving the file from re-encoding it.
  expect(headers["content-length"]).toBe(String(size));
});

async function testCounter(page: Page, currentValue = 0) {
  const btn = page.locator("button", { hasText: "Counter" });

  // Wait for button to have correct text (auto-retries)
  await expect(btn).toHaveText(`Counter ${currentValue}`, { timeout: 5000 });

  // Click and verify new value (auto-retries)
  await btn.click();
  await expect(btn).toHaveText(`Counter ${currentValue + 1}`, { timeout: 5000 });
}
