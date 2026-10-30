import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ALL_MODELS, LEGACY_MODEL_UPGRADES, MODEL_SONNET } from "../models";

// lib/models.ts is THE ONE PLACE the site names Claude models, so a retired or upgraded model
// is a one-line change. These tests keep it that way.
const REPO = path.resolve(__dirname, "../../../../..");
const WEB_MODELS = path.join(REPO, "artifacts/om-database/src/lib/models.ts");
const API_MODELS = path.join(REPO, "artifacts/api-server/src/lib/models.ts");
const MODEL_RE = /["'`]claude-(opus|sonnet|haiku|fable|mythos)-[a-z0-9.-]+["'`]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__" && e.name !== "dist") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("central model list", () => {
  it("server and web copies of models.ts are identical", () => {
    expect(fs.readFileSync(WEB_MODELS, "utf8")).toBe(fs.readFileSync(API_MODELS, "utf8"));
  });

  it("no model name is hard-coded outside models.ts", () => {
    const offenders: string[] = [];
    for (const root of ["artifacts/om-database/src", "artifacts/api-server/src"]) {
      for (const f of walk(path.join(REPO, root))) {
        if (f === WEB_MODELS || f === API_MODELS) continue;
        const lines = fs.readFileSync(f, "utf8").split("\n");
        lines.forEach((l, i) => { if (MODEL_RE.test(l)) offenders.push(`${path.relative(REPO, f)}:${i + 1}`); });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reply text is read by block type, never as the first block (Sonnet 5.5 can lead with a thinking block)", () => {
    const offenders: string[] = [];
    for (const root of ["artifacts/om-database/src", "artifacts/api-server/src"]) {
      for (const f of walk(path.join(REPO, root))) {
        fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (/content\??\.?\[0\]\??\.text/.test(l)) offenders.push(`${path.relative(REPO, f)}:${i + 1}`); });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("legacy names upgrade to a model that is still in use", () => {
    for (const to of Object.values(LEGACY_MODEL_UPGRADES)) expect(ALL_MODELS).toContain(to);
    expect(ALL_MODELS).toContain(MODEL_SONNET);
  });
});
