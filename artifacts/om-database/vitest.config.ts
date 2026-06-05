import { defineConfig } from "vitest/config";

// Unit tests for the deterministic lease-risk engine + validators. Node env —
// these are pure functions (no DOM). Test files live next to the lib code and are
// excluded from the production tsc build (tsconfig excludes **/*.test.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
