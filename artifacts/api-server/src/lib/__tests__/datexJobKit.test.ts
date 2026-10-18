import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeDatexDeal, rosterHash } from "../datexIngest";
import type { DatexPayload } from "../datexImport";

// The Python job kit (tools/datex-job-kit) and this server must agree: a payload the kit
// builds from the fixture must pass the server's merge rules, and the kit's roster hash must
// equal the server's byte for byte (or every building looks "changed" on every run).
const KIT = path.resolve(__dirname, "../../../../../tools/datex-job-kit");
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const py = (code: string, input?: string) => execFileSync("python3", ["-c", code], { cwd: KIT, input, encoding: "utf8" });

describe.skipIf(!hasPython)("Datex job kit ↔ server", () => {
  it("the kit's own unit tests pass", () => {
    const r = spawnSync("python3", ["-m", "unittest", "discover", "-s", KIT], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
  it("a payload built from the fixture is accepted by the merge", () => {
    const out = mkdtempSync(path.join(tmpdir(), "kit-")), file = path.join(out, "payload.json");
    execFileSync("python3", ["job_kit.py", "build", "--state", "fixtures/state.json", "--calls", "fixtures/calls.jsonl", "--out", file, "--as-of", "2026-10-18"], { cwd: KIT });
    const payload = JSON.parse(readFileSync(file, "utf8")) as DatexPayload;
    expect(payload.deals.length).toBe(2);
    for (const d of payload.deals) {
      const r = mergeDatexDeal(null, [], d, payload.asOf, { bldgIds: d.bldgIds });
      expect("problem" in r ? r.problem : null).toBeNull();
      if ("problem" in r) continue;
      if (d.dealId === "d-cooks") {
        expect((r.block.financials as Record<string, unknown>).noiTtmActual).toBe(2_890_000);   // sign flipped once, server side
        expect((r.block.financials as Record<string, unknown>).basis).toBe("Cash");
        expect(((r.block.arAging as { byTenant: Array<{ occStatus?: string }> }).byTenant[0]).occStatus).toBe("I");
        // The hash the kit computes from Datex = the hash /datex/state will publish once stored.
        const stored = r.block.tenants as Array<Record<string, unknown>>;
        const kitHash = py("import json,sys,job_kit as K; print(K.roster_hash(json.load(sys.stdin)))", JSON.stringify(stored)).trim();
        expect(kitHash).toBe(rosterHash(stored));
      }
    }
  });
  it("hash vectors with awkward numbers agree", () => {
    const v = [{ tenantId: " t1 ", sf: 60000, annualRent: 540000.5, leaseExpiry: "2031-02-28" }, { tenantId: "t2", sf: 1200.004, annualRent: 10.955 }, { tenantId: "t3", sf: null, annualRent: -2.5 }];
    expect(py("import json,sys,job_kit as K; print(K.roster_hash(json.load(sys.stdin)))", JSON.stringify(v)).trim()).toBe(rosterHash(v));
  });
});
