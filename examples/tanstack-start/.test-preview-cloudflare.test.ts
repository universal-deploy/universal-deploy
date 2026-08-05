import { testRun } from "./testRun.js";

testRun("pnpm run preview:cloudflare --strictPort --port 3000", {
  tolerateError({ logText, logSource }) {
    if (logSource === "stderr" && logText.includes("punycode")) return true;
  },
});
