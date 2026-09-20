import base from "@universal-deploy/e2e/config";

// This app enables precompression, so the shared suite runs its precompression case here.
const config: typeof base = { ...base, metadata: { ...base.metadata, precompress: true } };

export default config;
