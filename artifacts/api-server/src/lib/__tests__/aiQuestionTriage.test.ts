import { describe, it, expect } from "vitest";
import { triageAiQuestions, waltFromRoster, summarizeTriage, TRIAGE_MARK } from "../aiQuestionTriage";

// The backlog reached 1,469 open questions on 231 of 301 deals, only ~60 of them real
// arithmetic contradictions. Triage exists to surface those. But a triage that clears a
// GENUINE question is strictly worse than no triage at all — it destroys the signal it
// was built to reveal — so most of these tests pin what it must refuse to touch.

const q = (over: Record<string, unknown> = {}) => ({
  id: "ai-1", severity: "high", field: "WALT", question: "The merged deals had different WALT values — keep the one shown or use the other?", ...over,
});

/** Five tenants, all with expiries, 10 years out from a 2026-01-01 roll. */
const roster = (years = 10) => {
  const exp = `${2026 + years}-01-01`;
  return [1, 2, 3, 4, 5].map(i => ({ name: `Tenant ${i}`, sf: 1000, leaseExpiry: exp }));
};

describe("WALT questions — the biggest group, and the roster settles them", () => {
  it("resolves when the stored WALT agrees with the roster recompute", () => {
    const out = triageAiQuestions({
      walt: 10, tenantsAsOf: "2026-01-01", tenants: roster(10), reviewQuestions: [q()],
    });
    expect(out.resolved).toBe(1);
    expect(out.questions[0].resolvedBy).toBe(TRIAGE_MARK);
    expect(String(out.questions[0].resolution)).toMatch(/Recomputed from the rent roll as 10 years/);
  });

  it("LEAVES it open when the stored WALT disagrees — that is a real finding", () => {
    const out = triageAiQuestions({
      walt: 4, tenantsAsOf: "2026-01-01", tenants: roster(10), reviewQuestions: [q()],
    });
    expect(out.resolved).toBe(0);
    expect(out.questions[0].resolvedAt).toBeUndefined();
  });

  it("LEAVES it open when too few tenants carry an expiry to recompute honestly", () => {
    // A WALT built from half the roster is a different number, not a verification.
    const thin = [...roster(10).slice(0, 2), { name: "No date A", sf: 1000 }, { name: "No date B", sf: 1000 }, { name: "No date C", sf: 1000 }];
    const out = triageAiQuestions({ walt: 10, tenantsAsOf: "2026-01-01", tenants: thin, reviewQuestions: [q()] });
    expect(out.resolved).toBe(0);
  });

  it("LEAVES it open when there is no roster at all", () => {
    expect(triageAiQuestions({ walt: 10, reviewQuestions: [q()] }).resolved).toBe(0);
    expect(triageAiQuestions({ walt: 10, tenants: [], reviewQuestions: [q()] }).resolved).toBe(0);
  });

  it("allows only a small tolerance, not any plausible-looking number", () => {
    const near = triageAiQuestions({ walt: 10.2, tenantsAsOf: "2026-01-01", tenants: roster(10), reviewQuestions: [q()] });
    expect(near.resolved).toBe(1);                 // rounding-level difference
    const far = triageAiQuestions({ walt: 11.5, tenantsAsOf: "2026-01-01", tenants: roster(10), reviewQuestions: [q()] });
    expect(far.resolved).toBe(0);                  // a real disagreement
  });
});

describe("other answerable classes", () => {
  it("resolves an as-of question once the date is actually recorded", () => {
    const out = triageAiQuestions({
      tenantsAsOf: "2026-05-26", tenants: roster(),
      reviewQuestions: [q({ field: "asOf date", question: "What is the 'as of' date for this rent roll?" })],
    });
    expect(out.resolved).toBe(1);
    expect(String(out.questions[0].resolution)).toContain("2026-05-26");
  });

  it("leaves the as-of question open when the field is still empty or junk", () => {
    for (const v of [null, "", "unknown", "various"]) {
      const out = triageAiQuestions({
        tenantsAsOf: v, tenants: roster(),
        reviewQuestions: [q({ field: "asOf date", question: "What is the 'as of' date for this rent roll?" })],
      });
      expect(out.resolved, `as-of ${String(v)} must not resolve`).toBe(0);
    }
  });

  it("resolves an SF reconciliation only when the roster actually ties to GLA", () => {
    const ties = triageAiQuestions({
      totalSF: 5000, tenants: roster(),
      reviewQuestions: [q({ field: "Total SF / Occupied SF Reconciliation", question: "Does the occupied SF reconcile with the tenant SF figures?" })],
    });
    expect(ties.resolved).toBe(1);

    const short = triageAiQuestions({
      totalSF: 20000, tenants: roster(),   // roster is 5,000 SF — a 75% gap
      reviewQuestions: [q({ field: "Total SF / Occupied SF Reconciliation", question: "Does the occupied SF reconcile with the tenant SF figures?" })],
    });
    expect(short.resolved).toBe(0);
  });
});

describe("what triage must never touch", () => {
  it("never touches deterministic audit questions — those self-heal already", () => {
    const out = triageAiQuestions({
      walt: 10, tenantsAsOf: "2026-01-01", tenants: roster(10),
      reviewQuestions: [{ id: "audit-walt-recompute", source: "check", field: "WALT", question: "WALT disagrees" }],
    });
    expect(out.resolved).toBe(0);
  });

  it("never touches lease-risk validators", () => {
    for (const id of ["check-cotenancy-structure", "check-cotenancy-unquoted", "calc-something", "src-something"]) {
      const out = triageAiQuestions({
        walt: 10, tenantsAsOf: "2026-01-01", tenants: roster(10),
        reviewQuestions: [{ id, field: "WALT", question: "WALT?" }],
      });
      expect(out.resolved, `${id} must be left alone`).toBe(0);
    }
  });

  it("leaves every question it has no way to answer", () => {
    const untouchable = [
      q({ field: "Recourse", question: "Is this loan non-recourse with carve-outs?" }),
      q({ field: "In-Place NOI", question: "Is the in-place NOI exactly $2.8 million?" }),
      q({ field: "GameStop — Lease Expiry", question: "Is the expiry 1/31/2026 or 1/31/2027?" }),
      q({ field: "Prepayment terms", question: "Can you provide Section 2.4?" }),
    ].map((x, i) => ({ ...x, id: `ai-${i}` }));
    const out = triageAiQuestions({ walt: 10, tenantsAsOf: "2026-01-01", tenants: roster(10), reviewQuestions: untouchable });
    expect(out.resolved).toBe(0);
    expect(out.questions).toHaveLength(4);
  });

  it("NEVER deletes — a cleared question stays on the record with its reasoning", () => {
    const out = triageAiQuestions({ walt: 10, tenantsAsOf: "2026-01-01", tenants: roster(10), reviewQuestions: [q()] });
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0].question).toBe(q().question);   // original text preserved
    expect(out.questions[0].resolution).toBeTruthy();
  });

  it("does not re-stamp something already resolved", () => {
    const out = triageAiQuestions({
      walt: 10, tenantsAsOf: "2026-01-01", tenants: roster(10),
      reviewQuestions: [{ ...q(), resolvedAt: "2026-01-01T00:00:00Z", resolvedBy: "eric" }],
    });
    expect(out.resolved).toBe(0);
    expect(out.questions[0].resolvedBy).toBe("eric");
  });

  it("never mutates the deal it was handed", () => {
    const qs = [q()];
    const data = { walt: 10, tenantsAsOf: "2026-01-01", tenants: roster(10), reviewQuestions: qs };
    triageAiQuestions(data);
    expect(qs[0].resolvedAt).toBeUndefined();
  });
});

describe("the WALT recompute itself", () => {
  it("excludes vacant suites and NAP parcels from the weighting", () => {
    const r = waltFromRoster([
      ...roster(10),
      { name: "Vacant", sf: 100000, leaseExpiry: "2027-01-01" },
      { name: "Pad Owner", sf: 100000, leaseExpiry: "2027-01-01", isNAP: true },
    ], "2026-01-01");
    expect(r!.walt).toBe(10);   // the two huge rows must not drag it
    expect(r!.total).toBe(5);
  });

  it("reports coverage so a thin roster can be refused", () => {
    const r = waltFromRoster([...roster(10), { name: "No date", sf: 1000 }], "2026-01-01");
    expect(r!.covered).toBe(5);
    expect(r!.total).toBe(6);
  });

  it("floors an expired lease at zero rather than going negative", () => {
    const r = waltFromRoster([{ name: "Expired", sf: 1000, leaseExpiry: "2020-01-01" }], "2026-01-01");
    expect(r!.walt).toBe(0);
  });
});

describe("portfolio roll-up", () => {
  it("counts deals touched and totals by reason, ignoring no-op deals", () => {
    const s = summarizeTriage([
      { questions: [], resolved: 2, byReason: { "walt-matches-roster": 2 } },
      { questions: [], resolved: 0, byReason: {} },
      { questions: [], resolved: 1, byReason: { "asof-now-recorded": 1 } },
    ]);
    expect(s).toEqual({ dealsTouched: 2, resolved: 3, byReason: { "walt-matches-roster": 2, "asof-now-recorded": 1 } });
  });
});
