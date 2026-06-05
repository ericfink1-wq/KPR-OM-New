// Unit tests for the deterministic lease-risk engine + validators. Node env —
// pure functions (no DOM). Test files live next to the lib code and are excluded
// from the production tsc build (tsconfig excludes **/*.test.ts).
//
// NOTE: vitest is intentionally NOT a committed dependency (Replit's deploy
// package-firewall blocks its tarball, and the production build never runs
// tests). Run the suite on demand with `pnpm test` (→ pnpm dlx vitest). This
// config is a plain object so it loads without `vitest` resolvable in the project.
export default {
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
};
