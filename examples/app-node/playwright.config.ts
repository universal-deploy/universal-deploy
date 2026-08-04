// This app opts into precompression, so the shared suite runs its precompression case here.
process.env.UD_PRECOMPRESS = "1";

export { default } from "@universal-deploy/e2e/config";
