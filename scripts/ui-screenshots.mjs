#!/usr/bin/env node
// Visual smoke-test: screenshot the running app's key screens so Claude can SEE the UI
// (desktop + mobile) and catch layout/overflow bugs before they ship — instead of Eric
// sending screenshots by hand. Ready to run the moment the environment's network policy
// allows the Playwright browser download.
//
//   1. Run the app locally (see scripts/local-dev.md) so it serves on $APP_URL.
//   2. npx playwright install chromium     # needs network access (allowlist)
//   3. node scripts/ui-screenshots.mjs     # writes PNGs to ./ui-shots/
//
// Env:
//   APP_URL   base url of the running app (default http://localhost:5173)
//   SHOT_DIR  output dir (default ./ui-shots)
//   ROUTES    comma-separated routes to capture (default below)

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const SHOT_DIR = process.env.SHOT_DIR || "ui-shots";
const ROUTES = (process.env.ROUTES || "/").split(",").map((r) => r.trim()).filter(Boolean);

// Desktop + a phone viewport, because every UI change must work on both.
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const slug = (s) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  let shot = 0;
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      const url = APP_URL.replace(/\/$/, "") + route;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(800); // let lazy panels settle
        const file = join(SHOT_DIR, `${slug(route)}-${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`✓ ${url}  →  ${file}`);
        shot++;
      } catch (err) {
        console.error(`✗ ${url} — ${err instanceof Error ? err.message : err}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\nDone — ${shot} screenshot(s) in ./${SHOT_DIR}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
