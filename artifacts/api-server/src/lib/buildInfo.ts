// Which commit this server was built from (injected by build.mjs; "dev" when run unbundled).
export const BUILD_COMMIT = process.env.BUILD_COMMIT || "dev";
export const BUILD_TIME = process.env.BUILD_TIME || null;
export function buildInfo(): { commit: string; builtAt: string | null } { return { commit: BUILD_COMMIT, builtAt: BUILD_TIME }; }
