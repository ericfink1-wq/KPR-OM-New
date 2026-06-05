import { defineConfig } from "vitest/config";

// Unit tests for the server-side lease-risk extraction pass + normalizer +
// validators. Node env, pure functions with an injected (mocked) model — no
// network, no DB. Test files are excluded from the production tsc build.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
