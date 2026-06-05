// Unit tests for the server-side lease-risk extraction pass + normalizer +
// validators. Node env, pure functions with an injected (mocked) model — no
// network, no DB. Test files are excluded from the production tsc build.
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
