import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPayload, planCalls, parseCallsNdjson, kitRosterHash, type KitState, type DatexCall } from "../datexPlanBuild";
import { mergeDatexDeal, rosterHash } from "../datexIngest";
import type { DatexPayload } from "../datexImport";

// The site's plan/build (POST /api/datex/plan + /build) is a port of the Python job kit. The
// scheduled task now uses the SITE's copy (Claude's safety check blocks running a downloaded
// script), so the two must agree byte for byte: every scenario below runs BOTH and compares.
const KIT = path.resolve(__dirname, "../../../../../tools/datex-job-kit");
const hasPython = spawnSync("python3", ["--version"]).status === 0;
const FIX = path.join(KIT, "fixtures");
const state0 = JSON.parse(readFileSync(path.join(FIX, "state.json"), "utf8")) as KitState;
const calls0 = parseCallsNdjson(readFileSync(path.join(FIX, "calls.jsonl"), "utf8"));
const AS_OF = "2026-10-18";

function py(job: Record<string, unknown>): unknown {
  const code = `import json,sys,job_kit as K
j=json.load(sys.stdin)
if j["fn"]=="build":
    p,r=K.build(j["state"],j["calls"],j["asOf"],j.get("fin"),j.get("force",False)); print(json.dumps({"payload":p,"report":r}))
else:
    print(json.dumps(K.plan(j["state"],j["calls"],j["asOf"],j["mode"],j["sales"])))`;
  return JSON.parse(execFileSync("python3", ["-c", code], { cwd: KIT, input: JSON.stringify(job), encoding: "utf8", env: { ...process.env, PYTHONPATH: KIT } }));
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const withoutGen = (x: { payload: { generatedBy: string } }) => ({ ...x, payload: { ...x.payload, generatedBy: "-" } });
const occOnly: DatexCall[] = calls0.filter(c => c.entity === "Occupancy");

describe.skipIf(!hasPython)("site plan/build = Python job kit", () => {
  const states: Array<[string, KitState]> = [["fixture", state0]];
  const fresh = clone(state0); for (const d of fresh.deals ?? []) { d.hasSnapshot = false; delete d.tenants; delete d.sales; delete d.interest; delete d.leasing; delete d.financials; }
  states.push(["no snapshots", fresh]);
  const done = clone(state0); for (const d of done.deals ?? []) { d.interest = { checkedThrough: "202609" }; d.financials = { period: "202609" }; d.sales = { checkedThrough: "202609", storedMonthlyRows: 4 }; d.leasing = { latestSubmitted: "2026-08-01" }; }
  states.push(["all current", done]);

  for (const [label, st] of states) {
    it(`build matches (${label})`, () => {
      for (const [fin, force] of [[null, false], ["202608", false], [null, true]] as const) {
        const ts = buildPayload(st, calls0, AS_OF, fin, force);
        const pyOut = py({ fn: "build", state: st, calls: calls0, asOf: AS_OF, fin, force }) as typeof ts;
        expect(withoutGen(ts)).toEqual(withoutGen(pyOut));
      }
    });
    it(`plan matches (${label})`, () => {
      for (const mode of ["weekly", "monthly", "all"] as const) for (const sales of ["auto", "none", "newest", "all"] as const) for (const calls of [[], occOnly, calls0]) {
        expect(planCalls(st, calls, AS_OF, mode, sales)).toEqual({ ...(py({ fn: "plan", state: st, calls, asOf: AS_OF, mode, sales }) as object),
          ...(calls.length ? {} : { notes: ["Make this call, add its rows to calls, then ask for the plan again."] }) });
      }
    });
  }

  it("a site-built payload passes the server merge; hashes agree", () => {
    const { payload } = buildPayload(state0, calls0, AS_OF);
    for (const d of (payload as unknown as DatexPayload).deals) {
      const r = mergeDatexDeal(null, [], d, AS_OF, { bldgIds: d.bldgIds });
      expect("problem" in r ? r.problem : null).toBeNull();
      if (Array.isArray(d.tenants)) expect(kitRosterHash(d.tenants as never)).toBe(rosterHash(d.tenants as never));
    }
  });
});

describe("NDJSON calls", () => {
  it("skips blank lines, defaults filters/rows/tool, names a bad line", () => {
    expect(parseCallsNdjson('{"entity":"Occupancy"}\n\n')).toEqual([{ entity: "Occupancy", filters: [], rows: [], tool: "read" }]);
    expect(() => parseCallsNdjson('{"entity":"A"}\n{oops')).toThrow(/line 2/);
  });
});
