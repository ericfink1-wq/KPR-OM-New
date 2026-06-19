import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Build stamp injected at BUILD time so the running app can show exactly which commit
// is live (kills "is the fix deployed or am I looking at stale code?" guesswork). Like
// the PORT note below, this MUST NOT throw — a failed build means Replit keeps serving
// stale code. Short git SHA when .git is present (Replit clones it); else a timestamp.
function buildId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      cwd: import.meta.dirname,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    if (sha) return sha;
  } catch { /* no git at build time — fall back to the timestamp below */ }
  return "nogit";
}
const BUILD_ID = buildId();
const BUILD_TIME = new Date().toISOString();

// PORT / BASE_PATH are RUNTIME values (dev/preview server). They are frequently
// absent during a production BUILD — and throwing here made `vite build` (and thus
// the whole deployment) FAIL, so Replit kept serving stale code and none of the
// shipped fixes went live. A build must not depend on runtime env vars: default
// them at build time; the real values are still used at runtime when present.
const rawPort = process.env.PORT || "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      "@react-pdf/renderer": path.resolve(import.meta.dirname, "node_modules/@react-pdf/renderer/lib/react-pdf.browser.js"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // The PDF engine (@react-pdf, ~1.5 MB) is code-split into its own chunk that
    // loads only when you click a PDF export — it never affects first paint. Raise
    // the per-chunk warning above it so the build doesn't flag an intentional split.
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Local-only: when VITE_DEV_PROXY is set (e.g. http://localhost:3001) the dev
    // server proxies /api to a separately-run API server so the frontend can talk
    // to it on a single origin. No effect in production / when the var is unset.
    ...(process.env.VITE_DEV_PROXY
      ? { proxy: { "/api": { target: process.env.VITE_DEV_PROXY, changeOrigin: true } } }
      : {}),
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
