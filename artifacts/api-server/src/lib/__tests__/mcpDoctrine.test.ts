import { describe, it, expect } from "vitest";
import { KPR_CORE, KPR_PLAYBOOK, DOCTRINE_TOPICS, TOPIC_NAMES, doctrineForTopic } from "../mcpKnowledge";
import { RESPONSE_BUDGET_BYTES, emittedSize } from "../mcpTools";

// Eric's ask (9/11/26): an "always-on real estate brain" spanning the whole deal
// lifecycle, not just leases. The doctrine therefore covers PSAs, debt, waterfalls,
// underwriting, tax and investor materials — which is far more than fits in one
// response, hence core + topics. These tests pin the two things that would quietly
// break that: a topic that busts the client's budget, and a topic the index promises
// but cannot deliver.

describe("doctrine topics cover the deal lifecycle Eric actually works on", () => {
  it("carries a topic for each phase, not just leases", () => {
    for (const t of ["rent_and_tenants", "leases", "underwriting", "debt",
                     "waterfall_and_returns", "psa_and_legal", "taxes_and_closing",
                     "investor_materials", "comps", "data_integrity"]) {
      expect(TOPIC_NAMES, `missing topic: ${t}`).toContain(t);
      expect(DOCTRINE_TOPICS[t].length, `${t} is too thin to be useful`).toBeGreaterThan(800);
    }
  });

  it("every topic the index advertises actually resolves", () => {
    // The index is what the model reads to decide what to fetch. A topic named there
    // but missing here would read as "no doctrine exists on this".
    const advertised = [...KPR_CORE.matchAll(/^- `([a-z_]+)`/gm)].map(m => m[1]);
    expect(advertised.length).toBeGreaterThanOrEqual(10);
    for (const t of advertised) expect(doctrineForTopic(t), `index advertises ${t}`).toBeTruthy();
  });

  it("gives every advertised topic a TRIPWIRE, so the core alone still warns", () => {
    const lines = KPR_CORE.split("\n");
    const topicLines = lines.filter(l => /^- `[a-z_]+`/.test(l));
    for (const l of topicLines) {
      const idx = lines.indexOf(l);
      const following = lines.slice(idx, idx + 4).join(" ");
      expect(following, `no tripwire for ${l}`).toMatch(/TRIPWIRE:/);
    }
  });
});

describe("response budget — a rejected response delivers nothing", () => {
  it("core alone fits comfortably", () => {
    expect(emittedSize({ markdown: KPR_CORE })).toBeLessThan(RESPONSE_BUDGET_BYTES * 0.75);
  });

  it("core + any single topic fits, with headroom for the live House View", () => {
    for (const t of TOPIC_NAMES) {
      const size = emittedSize({ markdown: doctrineForTopic(t)!.markdown });
      expect(size, `${t} leaves no room for live lessons`).toBeLessThan(RESPONSE_BUDGET_BYTES * 0.6);
    }
  });

  it("the largest topic is not pathologically bigger than the rest", () => {
    const sizes = TOPIC_NAMES.map(t => DOCTRINE_TOPICS[t].length);
    expect(Math.max(...sizes)).toBeLessThan(Math.min(...sizes) * 8);
  });
});

describe("topic resolution", () => {
  it("omitting the topic returns the core WITH the index", () => {
    const d = doctrineForTopic(undefined)!;
    expect(d.topic).toBe("core");
    expect(d.markdown).toContain("Doctrine topics");
  });

  it("a topic returns the framing PLUS that topic, and drops the index", () => {
    const d = doctrineForTopic("psa_and_legal")!;
    expect(d.topic).toBe("psa_and_legal");
    expect(d.markdown).toContain("Purchase and sale agreements");
    expect(d.markdown).toContain("Which source of truth wins");  // framing still present
    expect(d.markdown).not.toContain("TRIPWIRE:");               // index dropped
  });

  it("is case- and whitespace-insensitive", () => {
    expect(doctrineForTopic("  PSA_AND_LEGAL ")!.topic).toBe("psa_and_legal");
  });

  it("returns null for an unknown topic instead of silently serving the core", () => {
    // Silence here would read as "KPR has no doctrine on this" — the opposite of true.
    expect(doctrineForTopic("environmental")).toBeNull();
    expect(doctrineForTopic("leasing")).toBeNull();
  });

  it("\"all\" really is everything", () => {
    const all = doctrineForTopic("all")!.markdown;
    expect(all).toBe(KPR_PLAYBOOK);
    for (const t of TOPIC_NAMES) expect(all).toContain(DOCTRINE_TOPICS[t].split("\n")[0]);
  });
});

describe("the hard-won rules survived the restructure", () => {
  const has = (s: string) => KPR_PLAYBOOK.toLowerCase().includes(s.toLowerCase());
  it("keeps the rules that were learned by getting them wrong", () => {
    expect(has("mark-to-market")).toBe(true);          // above-market rent is downside
    expect(has("per screen")).toBe(true);              // cinemas
    expect(has("X of N") || has("x of n")).toBe(true); // co-tenancy structure
    expect(has("Datex")).toBe(true);                   // source precedence
    expect(has("treasury income")).toBe(true);         // NOI inflation on owner statements
    expect(has("business days") || has("business or calendar")).toBe(true);
  });

  it("says plainly which topic is scaffolding rather than taught by Eric", () => {
    // Honest provenance matters more here than polish: he should know which parts to correct.
    expect(DOCTRINE_TOPICS.psa_and_legal).toMatch(/PROVENANCE/);
  });
});

// Eric, 9/11/26: "datex and KPR site dont have direct insight on things like PSAs, legal
// docs, at least directly, but there are always lingering tenant and property level items
// that make their way into these docs, and where applicable, always lean on that
// knowledge." This is the reflex that separates a review from generic commentary, so it
// belongs in the CORE — it applies to any document, not only a PSA — and it has to name
// concrete lookups rather than just instructing the model to "use the data".
describe("grounding documents in the real property", () => {
  it("lives in the core, so it reaches every conversation", () => {
    expect(KPR_CORE).toMatch(/Ground every document in the actual property/);
  });

  it("survives into any topic fetch, since topics ship with the core framing", () => {
    for (const t of ["psa_and_legal", "debt", "leases"]) {
      expect(doctrineForTopic(t)!.markdown, `${t} lost the grounding rule`)
        .toMatch(/Ground every document in the actual property/);
    }
  });

  it("gives concrete lookups, not just an instruction to use the data", () => {
    const core = KPR_CORE.toLowerCase();
    for (const cue of ["estoppel", "casualty", "delinquent rent", "rofr", "co-tenancy"]) {
      expect(core, `no worked example mentioning ${cue}`).toContain(cue);
    }
  });

  it("keeps the disagreement rule: a mismatch is a finding, not something to reconcile away", () => {
    expect(KPR_CORE).toMatch(/FINDING, not something to reconcile silently/);
  });

  it("the PSA topic points back at the reflex rather than restating it loosely", () => {
    expect(DOCTRINE_TOPICS.psa_and_legal).toMatch(/Read every clause against the real roster/);
    // The cross-reference wraps across lines in the source, so tolerate the break.
    expect(DOCTRINE_TOPICS.psa_and_legal).toMatch(/Ground every document in the actual\s+property/);
  });
});
