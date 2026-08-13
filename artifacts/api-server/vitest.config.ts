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
    // A few test files transitively import the db module, whose top-level guard THROWS
    // if DATABASE_URL is unset — which failed the whole api-server suite in CI (no DB
    // there) and on any local run without a database, spamming CI-failure emails. The
    // tests are pure functions that never actually query, and the pg Pool connects
    // lazily, so a syntactically-valid dummy URL just satisfies the import-time guard.
    env: {
      DATABASE_URL: process.env.DATABASE_URL || "postgres://ci:ci@localhost:5432/ci",
    },
  },
};
