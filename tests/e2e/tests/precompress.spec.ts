import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("a precompressed variant is served from disk", async ({ request }, testInfo) => {
  test.skip(!testInfo.config.metadata.precompress, "app does not enable precompression");
  test.skip(!process.env.RUN_CMD, "production build only");

  const root = path.join(process.cwd(), "dist/client");
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const variants = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".br"))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
  // Prefer a fingerprinted asset: its URL is stable and it is never rendered. Finding
  // none is a failure, not a skip — the build is supposed to have produced one.
  const variant = variants.find((name) => name.startsWith("assets")) ?? variants[0];
  if (!variant) throw new Error(`no .br variant under ${root}`);

  const identity = variant.slice(0, -".br".length);
  const size = (await fs.stat(path.join(root, variant))).size;

  const response = await request.get(`/${identity.split(path.sep).join("/")}`, {
    headers: { "accept-encoding": "br" },
  });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-encoding"]).toBe("br");
  // The discriminator: an on-the-fly encode is chunked and carries no length, so this is
  // what separates serving the file from re-encoding it.
  expect(headers["content-length"]).toBe(String(size));
});
