// "Add Intel" — turn a free-text note Eric types on the deal page ("Whole Foods is
// doing $40M in sales here", "Best Buy is extending early for 5 years", "tenant says
// they're roughly doing $3M") into structured, reviewable changes:
//   • concrete sales  → a manual tenantSalesHistory record (flows to the sales chart,
//                        roster, analytics and brand benchmarks, same as an upload)
//   • anecdotal sales → the same, but flagged `anecdotal` so it is always badged
//   • lease changes   → updates the matched tenant, marked "reported (not yet executed)"
//   • everything else → a dated dealIntel note that feeds the AI grade/narrative + chat
//
// Two-stage by design (Eric's choice): parseDealIntel() proposes; the user confirms /
// edits in the Add-Intel box; buildIntelPatch() applies only the confirmed items. No
// figure is ever silently mutated.

import type { Deal, TenantSalesYear, DealIntelEntry } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, tenantKey, stripSuiteCode, recomputeRosterMetrics } from "./utils";

export interface IntelSalesItem {
  id: string;
  tenantName: string;            // tenant as named in the note
  rosterMatch: string | null;    // exact roster display name it matched, or null
  year: number;
  annualSales: number | null;
  salesPSF: number | null;
  sf: number | null;
  anecdotal: boolean;            // soft, tenant-reported figure
  note: string | null;
  include: boolean;
}

export interface IntelLeaseItem {
  id: string;
  tenantName: string;
  rosterMatch: string | null;
  change: string;                // human description, e.g. "Extend term 5 years (early)"
  field: "leaseExpiry" | "remainingTermYears" | "renewalOptions" | "rentPerSF" | "annualRent" | "other";
  newValue: string | number | null;  // concrete value when computable (ISO date / number / text)
  reported: boolean;             // true = expected but not yet executed
  note: string | null;
  include: boolean;
}

export interface IntelNoteItem {
  id: string;
  text: string;
  category: "sales" | "lease" | "market" | "tenant" | "general";
  include: boolean;
}

export interface IntelProposal {
  sales: IntelSalesItem[];
  leases: IntelLeaseItem[];
  notes: IntelNoteItem[];
  rawText: string;
  summary: string;
}

const nv = (v: unknown): number | null => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
const rid = (p: string, i: number) => `${p}-${i}-${Math.random().toString(36).slice(2, 7)}`;

// Match a name from the note to a roster tenant (exact normalized, else unique containment).
function matchRoster(deal: Deal, rawName: string): string | null {
  const list = deal.tenants || [];
  const k = tenantKey(stripSuiteCode(rawName));
  const exact = list.find(t => tenantKey(t.canonicalName || t.name) === k);
  if (exact) return exact.canonicalName || exact.name || null;
  const ksp = k.replace(/ /g, "");
  if (ksp.length >= 4) {
    const hits = list.filter(t => {
      const rk = tenantKey(t.canonicalName || t.name).replace(/ /g, "");
      return rk.length >= 4 && (rk.includes(ksp) || ksp.includes(rk));
    });
    if (hits.length === 1) return hits[0].canonicalName || hits[0].name || null;
  }
  return null;
}

export async function parseDealIntel(deal: Deal, text: string): Promise<IntelProposal> {
  const roster = (deal.tenants || [])
    .map(t => ({ name: t.canonicalName || t.name || "", sf: nv(t.sf), exp: t.leaseExpiry || null }))
    .filter(t => t.name);
  const rosterBlock = roster.length
    ? roster.map(t => `- ${t.name}${t.sf ? ` (${t.sf.toLocaleString()} SF)` : ""}${t.exp ? `, expires ${t.exp}` : ""}`).join("\n")
    : "(no roster on file)";
  const thisYear = new Date().getFullYear();

  const prompt = `You are a CRE analyst's intake engine. The user typed a free-text note about a retail center. Convert it into STRUCTURED, reviewable changes. Return ONLY JSON — no markdown, no prose — with this exact shape:
{
  "summary": "one short sentence describing what you parsed",
  "sales": [
    {"tenantName":"string (as written)","year":<integer>,"annualSales":number_or_null,"salesPSF":number_or_null,"sf":number_or_null,"anecdotal":boolean,"note":"string_or_null"}
  ],
  "leases": [
    {"tenantName":"string","change":"short human description","field":"leaseExpiry|remainingTermYears|renewalOptions|rentPerSF|annualRent|other","newValue":"ISO date / number / short text, or null","reported":boolean,"note":"string_or_null"}
  ],
  "notes": [
    {"text":"the relevant portion of the note, lightly cleaned","category":"sales|lease|market|tenant|general"}
  ]
}

RULES:
- SALES: any statement of a tenant's sales (total $ or $/SF). annualSales = TOTAL annual dollars ("$40M" → 40000000). salesPSF = per-SF. If only a total is given, leave salesPSF null (we derive it). year = the year the sales belong to; if unstated, use ${thisYear - 1} (most recent complete year).
  • anecdotal=true when the figure is SOFT / tenant-reported / approximate — cues: "roughly", "around", "about", "approximately", "~", "they say", "told us", "we heard", "estimate", "ballpark". anecdotal=false for a firm/specific reported figure.
- LEASES: any change to a tenant's lease — extension, early renewal, new expiry, exercised option, rent change, going dark, termination. reported=true unless the note says it is signed/executed/closed. For an extension by N years, if you know the tenant's current expiry from the roster below, set field="leaseExpiry" and newValue = the new ISO date (current expiry + N years); otherwise field="remainingTermYears" and put the delta in change/note. Keep "change" short and clear.
- NOTES: ALSO emit a notes[] entry for every distinct fact (including the sales/lease ones) so the qualitative context is preserved and feeds the analysis. Categorize each.
- Match tenants to the roster yourself by name; use the tenant name as written — we re-match to the roster on our side.
- Do NOT invent figures. Only capture what the note states. Empty arrays are fine.

ROSTER (for context — current tenants, SF, expiries):
${rosterBlock}

${await lessonGuidanceClient("all")}
USER NOTE:
${text.slice(0, 8000)}`;

  const callOnce = async (): Promise<string> => {
    const res = await apiAiMessages({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content.find((c: { type: string }) => c.type === "text")?.text ?? "";
  };
  type Parsed = { summary?: string; sales?: unknown[]; leases?: unknown[]; notes?: unknown[] };
  let parsed: Parsed | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const raw = await callOnce();
    try { parsed = robustParseJSON(raw) as Parsed; } catch { parsed = null; }
  }
  if (!parsed) throw new Error("Couldn't read that — try rephrasing, or be a bit more specific.");

  const salesArr = Array.isArray(parsed.sales) ? parsed.sales : [];
  const leaseArr = Array.isArray(parsed.leases) ? parsed.leases : [];
  const noteArr = Array.isArray(parsed.notes) ? parsed.notes : [];

  const sales: IntelSalesItem[] = salesArr.map((s, i) => {
    const r = s as Record<string, unknown>;
    const tenantName = String(r.tenantName ?? "").trim();
    return {
      id: rid("isale", i),
      tenantName,
      rosterMatch: matchRoster(deal, tenantName),
      year: nv(r.year) ?? thisYear - 1,
      annualSales: nv(r.annualSales),
      salesPSF: nv(r.salesPSF),
      sf: nv(r.sf),
      anecdotal: r.anecdotal === true,
      note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : null,
      include: true,
    };
  }).filter(s => s.tenantName && (s.annualSales != null || s.salesPSF != null));

  const leases: IntelLeaseItem[] = leaseArr.map((l, i) => {
    const r = l as Record<string, unknown>;
    const tenantName = String(r.tenantName ?? "").trim();
    const field = (["leaseExpiry", "remainingTermYears", "renewalOptions", "rentPerSF", "annualRent", "other"]
      .includes(String(r.field)) ? r.field : "other") as IntelLeaseItem["field"];
    return {
      id: rid("ilease", i),
      tenantName,
      rosterMatch: matchRoster(deal, tenantName),
      change: String(r.change ?? "").trim() || "Lease change",
      field,
      newValue: (r.newValue ?? null) as string | number | null,
      reported: r.reported !== false,
      note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : null,
      include: true,
    };
  }).filter(l => l.tenantName);

  const notes: IntelNoteItem[] = noteArr.map((n, i) => {
    const r = n as Record<string, unknown>;
    const cat = ["sales", "lease", "market", "tenant", "general"].includes(String(r.category))
      ? (r.category as IntelNoteItem["category"]) : "general";
    return { id: rid("inote", i), text: String(r.text ?? "").trim(), category: cat, include: true };
  }).filter(n => n.text);

  const summary = typeof parsed.summary === "string" ? parsed.summary : "Parsed your note.";
  return { sales, leases, notes, rawText: text, summary };
}

// Apply only the user-CONFIRMED items (include === true) to the deal. Returns a patch
// (Partial<Deal>) ready to hand to onUpdate — never mutates upload/OM sales snapshots.
export function buildIntelPatch(deal: Deal, proposal: IntelProposal): Partial<Deal> {
  const patch: Partial<Deal> = {};
  const nowIso = new Date().toISOString();
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
  const appliedBits: string[] = [];

  // ── Sales → manual snapshots, merged by year (never clobbering om/upload) ──────
  const okSales = proposal.sales.filter(s => s.include);
  if (okSales.length) {
    const roster = new Map((deal.tenants || []).map(t => [tenantKey(t.canonicalName || t.name), t] as const));
    const history = [...(deal.tenantSalesHistory || [])];
    const byYear = new Map<number, IntelSalesItem[]>();
    for (const s of okSales) { const a = byYear.get(s.year) || []; a.push(s); byYear.set(s.year, a); }

    for (const [year, items] of byYear) {
      // Start from any existing MANUAL/anecdotal snapshot for this year so prior typed
      // entries are preserved; drop only the tenants we're (re)entering now.
      const prior = history.find(h => h.year === year && (h.source === "manual" || h.source === "anecdotal"));
      const keep = (prior?.tenants || []).filter(rt =>
        !items.some(s => tenantKey(s.rosterMatch || s.tenantName) === tenantKey(rt.name)));
      const fresh = items.map(s => {
        const rt = roster.get(tenantKey(s.rosterMatch || s.tenantName));
        const name = s.rosterMatch || (rt ? (rt.canonicalName || rt.name || s.tenantName) : s.tenantName);
        let sf = s.sf ?? nv(rt?.sf);
        let gross = s.annualSales;
        let psf = s.salesPSF;
        if (sf == null && psf != null && psf > 0 && gross != null) sf = Math.round(gross / psf);
        if (psf == null && gross != null && sf != null && sf > 0) psf = Math.round((gross / sf) * 100) / 100;
        if (gross == null && psf != null && sf != null && sf > 0) gross = Math.round(psf * sf);
        const provenance = `${s.anecdotal ? "Tenant-reported (anecdotal)" : "Manually entered"}, ${dateLabel}`;
        return {
          name, salesPSF: psf, annualSales: gross, sf,
          occupancyCost: null, anecdotal: s.anecdotal || null,
          provenance, salesNote: s.note,
        };
      });
      const merged = [...keep, ...fresh];
      const anyAnecdotal = merged.some(t => t.anecdotal);
      const snap: TenantSalesYear = {
        year, uploadedAt: nowIso,
        source: anyAnecdotal && merged.every(t => t.anecdotal) ? "anecdotal" : "manual",
        tenants: merged as TenantSalesYear["tenants"],
      };
      const idx = history.findIndex(h => h === prior);
      if (idx >= 0) history[idx] = snap; else history.push(snap);
    }
    patch.tenantSalesHistory = history;
    appliedBits.push(...okSales.map(s => {
      const amt = s.annualSales != null ? `$${(s.annualSales / 1_000_000).toFixed(1)}M`
        : s.salesPSF != null ? `$${Math.round(s.salesPSF)}/SF` : "sales";
      return `${s.rosterMatch || s.tenantName} ${s.year} ${amt}${s.anecdotal ? " (anecdotal)" : ""}`;
    }));
  }

  // ── Lease changes → update the matched tenant; mark reported (not executed) ────
  const okLeases = proposal.leases.filter(l => l.include && l.rosterMatch);
  if (okLeases.length) {
    const tenants = (deal.tenants || []).map(t => ({ ...t }));
    for (const l of okLeases) {
      const t = tenants.find(x => tenantKey(x.canonicalName || x.name) === tenantKey(l.rosterMatch!));
      if (!t) continue;
      const tag = l.reported ? " (reported — not yet executed)" : "";
      if (l.field === "leaseExpiry" && typeof l.newValue === "string" && /^\d{4}-\d{2}-\d{2}/.test(l.newValue)) {
        t.leaseExpiry = l.newValue;
      } else if (l.field === "remainingTermYears" && nv(l.newValue) != null) {
        t.remainingTermYears = nv(l.newValue);
      } else if (l.field === "rentPerSF" && nv(l.newValue) != null) {
        t.rentPerSF = nv(l.newValue) as number;
      } else if (l.field === "annualRent" && nv(l.newValue) != null) {
        t.annualRent = nv(l.newValue) as number;
      }
      const stamp = `${l.change}${tag}, entered ${dateLabel}`;
      t.assumptionNote = t.assumptionNote ? `${t.assumptionNote}; ${stamp}` : stamp;
      appliedBits.push(`${l.rosterMatch} — ${l.change}${l.reported ? " (reported)" : ""}`);
    }
    patch.tenants = tenants;
    const rm = recomputeRosterMetrics(tenants as Array<Record<string, unknown>>, deal.tenantsAsOf, deal);
    Object.assign(patch, rm);
  }

  // ── dealIntel log (every confirmed note + raw text) ───────────────────────────
  const okNotes = proposal.notes.filter(n => n.include);
  const entry: DealIntelEntry = {
    id: rid("intel", 0),
    enteredAt: nowIso,
    text: proposal.rawText.trim(),
    applied: appliedBits.length ? appliedBits.join("; ") : null,
    category: okNotes[0]?.category ?? "general",
  };
  patch.dealIntel = [...(deal.dealIntel || []), entry];

  // Reported lease changes and new qualitative context should refresh the grade.
  if (okLeases.length || okNotes.length) patch.analysisStale = true;
  return patch;
}
