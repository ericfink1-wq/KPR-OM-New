import { useState, useMemo } from "react";
import type { Deal, ReviewQuestion, Tenant } from "../lib/idb";
import { buildReviewQuestions, tenantKey, robustParseJSON } from "../lib/utils";
import { apiAiMessages, apiAddExtractionLesson } from "../lib/api";

// A field/check-aware DRAFT rule, so teaching the analyst is one click. The operator
// can edit it before saving; it's stored as a high-priority extraction lesson that
// guides every future OM read (lib/extractionLessons → injected into the prompt).
function draftLesson(q: ReviewQuestion): string {
  const fk = q.target?.fieldKey || "";
  const id = q.id || "";
  if (fk === "totalSF" || id.startsWith("audit-sf-gla")) return "Total SF / building GLA: confirm it equals the sum of ALL suite SF (occupied + vacant) and ties to the rent-roll total — don't trust a cover-page GLA that conflicts with the roster.";
  if (id.startsWith("audit-noi-cap-price") || fk === "noi" || fk === "capRate" || fk === "askingPrice") return "NOI, cap rate and price must tie out (price = NOI ÷ cap). If the headline cap is on PRO-FORMA NOI, capture in-place NOI separately and never let the three contradict.";
  if (fk === "occupancy" || id.startsWith("audit-occupancy")) return "Occupancy must reconcile to the roster (occupied SF ÷ GLA) and be a percentage (e.g. 92.8, not 0.928).";
  if (fk === "weightedAvgRentPSF" || id.startsWith("audit-avg-rent")) return "Weighted-avg rent PSF should equal total in-place base rent ÷ occupied SF from the roster.";
  if (id.startsWith("audit-rent-tie") || fk === "annualRent" || fk === "rentPerSF") return "On rent rolls, each tenant's rent PSF × SF must reconcile to annual BASE rent. When they differ, re-check which column is base vs. gross/option rent.";
  if (id.startsWith("audit-cf-") || id.startsWith("audit-noi-vs-cf")) return "Cash-flow page: each year's NOI must equal effective gross revenue minus operating expenses; the headline NOI should match year-1.";
  if (fk === "capRate" && id.startsWith("audit-caprate")) return "Cap rate is a percentage (e.g. 6.50), not basis points or a fraction.";
  // Generic: anchor on the specific field/question the operator just corrected.
  return `When reading an OM, double-check "${q.field}" — ${q.question.replace(/\s+/g, " ").trim()}`.slice(0, 280);
}

// One structured edit to write back into the deal. Used by both the literal
// "type the value" path and the AI-interpreted "type an instruction" path.
type Edit = {
  kind: "deal" | "tenant";
  fieldKey: string;
  tenantName?: string | null;
  value: string | number | boolean | null;
  label: string;   // human-readable, for the confirm panel + resolved log
};

// Whitelist of fields the AI path is allowed to write, with how to coerce them.
// Keeps free-text interpretation from ever touching structured fields
// (rentSchedule, cashFlowProjection, scores, etc.).
const DEAL_FIELDS: Record<string, "number" | "text" | "boolean"> = {
  propertyName: "text", address: "text", city: "text", state: "text", zip: "text",
  market: "text", submarket: "text", assetType: "text", centerType: "text", omDate: "text",
  askingPrice: "number", capRate: "number", noi: "number", pricePerSF: "number",
  totalSF: "number", occupancy: "number", grossPotentialRent: "number",
  effectiveGrossIncome: "number", operatingExpenses: "number", nnnRecoveries: "number",
  weightedAvgRentPSF: "number", walt: "number", yearBuilt: "number", renovationYear: "number",
  lotSizeAcres: "number", parkingRatio: "number", numberOfBuildings: "number",
  loanBalance: "number", loanRate: "number", loanMaturity: "text", loanType: "text",
  trafficCountVPD: "number", population3mi: "number", medianHHIncome3mi: "number",
  avgHHIncome3mi: "number", broker: "text", seller: "text", notes: "text", shadowAnchors: "text",
  // Financing / acquisition fields (loan-document flags target these).
  debtLender: "text", debtType: "text", debtLoanAmount: "number", debtRate: "number",
  debtRateType: "text", debtIndex: "text", debtSpread: "number", debtOriginationDate: "text",
  debtMaturityDate: "text", debtTermYears: "number", debtAmortYears: "number", debtIOPeriod: "number",
  debtLTV: "number", debtDSCR: "number", debtRecourse: "text",
  txnPurchasePrice: "number", txnSeller: "text", txnCloseDate: "text", acqEntity: "text", acqClosingCosts: "number",
};
const TENANT_FIELDS: Record<string, "number" | "text" | "boolean"> = {
  name: "text", parentCompany: "text", suite: "text", sf: "number", rentPerSF: "number",
  annualRent: "number", leaseStart: "text", leaseExpiry: "text", remainingTermYears: "number",
  reimbursementMethod: "text", leaseType: "text", rentBumps: "text", rentSchedule: "text", renewalOptions: "text",
  salesPSF: "number", occupancyCost: "number", expenseReimbursements: "number",
  percentageRent: "number", otherRent: "number", creditRating: "text",
  isAnchor: "boolean", isNAP: "boolean", isDark: "boolean", assumptionNote: "text", salesNotes: "text",
};

const coerceVal = (raw: unknown, type: "number" | "text" | "boolean"): string | number | boolean | null => {
  if (type === "boolean") return raw === true || raw === "true" || raw === "yes" || raw === 1;
  if (type === "text") { const s = raw == null ? "" : String(raw).trim(); return s === "" ? null : s; }
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[$,%\s]/g, ""));
  return isNaN(n) ? null : n;
};

// Decide whether the user typed a plain value (drop it straight in) or a
// natural-language instruction (hand it to the AI). Bias toward AI when unsure —
// the AI path always asks for confirmation before writing, so a false "looks
// like an instruction" only costs a confirm click, whereas mis-storing a
// sentence as a literal value corrupts the field.
const looksLikeInstruction = (draft: string, valueType: "number" | "text") => {
  const v = draft.trim();
  if (v === "") return false;
  if (valueType === "number") {
    // A clean number (after stripping $ , % and spaces) is a literal; anything else is an instruction.
    return isNaN(Number(v.replace(/[$,%\s]/g, "")));
  }
  // Text field: a short value (a rating, a name, a date) is literal; a sentence is an instruction.
  return v.split(/\s+/).length >= 4;
};

// Which NUMERIC tenant field a correction is about: prefer the question's own
// target field; otherwise infer it from the question wording (SF, PSF, rent,
// sales). Returns null when it isn't a numeric tenant field — then we don't try
// the deterministic multi-tenant parse below.
const inferTenantNumberField = (q: ReviewQuestion): string | null => {
  const tk = q.target?.fieldKey;
  if (q.target?.kind === "tenant" && tk && TENANT_FIELDS[tk] === "number") return tk;
  const hay = `${q.field || ""} ${q.question || ""}`.toLowerCase();
  if (/\bsf\b|square f|\bgla\b|\bsize\b/.test(hay)) return "sf";
  if (/psf|per square|\$\s*\/\s*sf|rent\s*\/\s*sf/.test(hay)) return "rentPerSF";
  if (/annual (base )?rent|\bbase rent\b/.test(hay)) return "annualRent";
  if (/\bsales\b/.test(hay)) return "salesPSF";
  return null;
};

// Non-blocking post-import data-integrity review. Opened from the "N to confirm"
// badge on the deal page. Each question is either an AI low-confidence capture or
// a deterministic arithmetic/missing-field check. Confirming or dismissing stamps
// resolvedAt so it never re-asks; the deal's reviewQuestions are updated via onUpdate.
export default function ImportReview({ deal, onClose, onUpdate }: {
  deal: Deal;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
}) {
  // Compute the live merged list (AI + checks), preserving prior resolutions.
  const all = useMemo(() => buildReviewQuestions(deal), [deal]);
  const [showResolved, setShowResolved] = useState(false);
  const open = all.filter(q => !q.resolvedAt);
  const resolved = all.filter(q => q.resolvedAt);

  // Persist a resolution. We store the FULL merged list back onto the deal so the
  // deterministic checks (which aren't otherwise persisted) keep their resolved
  // state too.
  const resolve = (q: ReviewQuestion, resolution: "confirmed" | "dismissed") => {
    const next = all.map(x => x.id === q.id
      ? { ...x, resolvedAt: new Date().toISOString(), resolution }
      : x);
    onUpdate(deal.id, { reviewQuestions: next });
    // Confirming = "the model read this right"; dismissing a false alarm is also a
    // teachable signal. Surface the teach box (skippable) so every action can teach.
    if (!taught[q.id]) { setShowResolved(true); openTeach(q); }
  };

  const reopen = (q: ReviewQuestion) => {
    const next = all.map(x => x.id === q.id ? { ...x, resolvedAt: null, resolution: null } : x);
    onUpdate(deal.id, { reviewQuestions: next });
  };

  // Which question is currently being edited inline, and the draft value.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // AI-interpretation state for the current edit.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  // A pending AI proposal awaiting the user's confirmation before it's written.
  const [proposal, setProposal] = useState<{ questionId: string; summary: string; edits: Edit[] } | null>(null);

  // "Teach the analyst" — turn this confirm/fix into a rule that guides future OM
  // extractions. Pre-filled with a smart draft; saved as a high-priority lesson.
  const [teachFor, setTeachFor] = useState<string | null>(null);
  const [teachText, setTeachText] = useState("");
  const [teachBusy, setTeachBusy] = useState(false);
  const [taught, setTaught] = useState<Record<string, boolean>>({});
  const openTeach = (q: ReviewQuestion) => { setTeachFor(q.id); setTeachText(draftLesson(q)); };
  const saveTeach = async () => {
    const text = teachText.trim();
    if (!text || !teachFor) return;
    setTeachBusy(true);
    const r = await apiAddExtractionLesson("om", text).catch(() => ({ ok: false }));
    setTeachBusy(false);
    if (r.ok) { const id = teachFor; setTaught(t => ({ ...t, [id]: true })); setTeachFor(null); setTeachText(""); }
  };
  const teachTrigger = (q: ReviewQuestion) => taught[q.id]
    ? <span style={{ fontSize: 11, color: "#3f7a1f", fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>📚 ✓ Taught</span>
    : <button onClick={() => (teachFor === q.id ? setTeachFor(null) : openTeach(q))} style={{ background: "none", border: "none", color: "#9a6a1e", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'Inter',sans-serif", padding: 0 }}>📚 {teachFor === q.id ? "Cancel" : "Teach a rule"}</button>;
  const teachBox = (q: ReviewQuestion) => (teachFor === q.id && !taught[q.id]) ? (
    <div style={{ marginTop: 8, background: "#fbf7ee", border: "1px solid #e7d9bd", borderRadius: 8, padding: "9px 11px" }}>
      <div style={{ fontSize: 10.5, color: "#9a6a1e", fontWeight: 700, marginBottom: 5 }}>📚 Teach the analyst — this rule guides EVERY future OM read</div>
      <textarea value={teachText} onChange={e => setTeachText(e.target.value)} rows={3}
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0d7c6", borderRadius: 6, padding: "7px 9px", fontSize: 12, fontFamily: "'Inter',sans-serif", color: "#383a37", resize: "vertical", background: "#fff", lineHeight: 1.4 }} />
      <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={saveTeach} disabled={teachBusy || !teachText.trim()} style={{ background: "#3f7a1f", border: "none", color: "#fff", padding: "5px 12px", borderRadius: 6, cursor: (teachBusy || !teachText.trim()) ? "default" : "pointer", fontSize: 11.5, fontWeight: 600, opacity: (teachBusy || !teachText.trim()) ? 0.6 : 1, fontFamily: "'Inter',sans-serif" }}>{teachBusy ? "Saving…" : "Save rule"}</button>
        <button onClick={() => setTeachFor(null)} style={{ background: "none", border: "none", color: "#a89f8f", cursor: "pointer", fontSize: 11.5, fontFamily: "'Inter',sans-serif" }}>Skip</button>
        <span style={{ fontSize: 10, color: "#bcae97" }}>Edit first — applied to all future extractions at top priority.</span>
      </div>
    </div>
  ) : null;

  const startFix = (q: ReviewQuestion) => {
    setEditingId(q.id);
    setDraft(q.suggestedValue ?? "");
    setAiErr(null);
    setProposal(null);
  };
  const cancelFix = () => { setEditingId(null); setAiErr(null); setProposal(null); };

  // Turn a list of structured edits into a deal patch, applying tenant edits by
  // name and recomputing occupancy/WALT when SF or term changed (honoring locks).
  const buildPatch = (edits: Edit[]): Partial<Deal> => {
    const patch: Partial<Deal> = {};
    let tenants = (deal.tenants || []) as Tenant[];
    let tenantsTouched = false, sfOrTermTouched = false;
    for (const e of edits) {
      if (e.kind === "deal") {
        (patch as Record<string, unknown>)[e.fieldKey] = e.value;
      } else {
        const wantKey = tenantKey(e.tenantName || "");
        const idx = tenants.findIndex(tn => tenantKey(tn.canonicalName || tn.name) === wantKey || tn.name === e.tenantName);
        if (idx < 0) continue;
        tenants = tenants.map((tn, i) => i === idx ? { ...tn, [e.fieldKey]: e.value } : tn);
        tenantsTouched = true;
        if (e.fieldKey === "sf" || e.fieldKey === "remainingTermYears") sfOrTermTouched = true;
      }
    }
    if (tenantsTouched) {
      patch.tenants = tenants;
      const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
      if (sfOrTermTouched && !deal.verified?.occupancy && deal.totalSF) {
        const occSF = tenants.reduce((s, tn) => s + (nv(tn.sf) ?? 0), 0);
        const occ = Math.round(occSF / Number(deal.totalSF) * 1000) / 10;
        if (occ > 0 && occ <= 100) patch.occupancy = occ;
      }
      if (sfOrTermTouched && !deal.verified?.walt) {
        const sfT = tenants.reduce((s, tn) => s + (nv(tn.sf) ?? 0), 0);
        const wT = tenants.reduce((s, tn) => s + (nv(tn.sf) ?? 0) * (nv(tn.remainingTermYears) ?? 0), 0);
        if (sfT > 0) patch.walt = Math.round(wT / sfT * 10) / 10;
      }
    }
    return patch;
  };

  // Write the edits to the deal and mark the question "fixed".
  const commitEdits = (q: ReviewQuestion, edits: Edit[], summary: string) => {
    const patch = buildPatch(edits);
    patch.reviewQuestions = all.map(x => x.id === q.id
      ? { ...x, suggestedValue: summary, resolvedAt: new Date().toISOString(), resolution: "fixed" as const }
      : x);
    onUpdate(deal.id, patch);
    cancelFix();
    // A FIX is the strongest teaching signal — the model got it wrong and we know the
    // right answer. Pop the teach box (pre-filled) so the rule guides future OMs.
    if (!taught[q.id]) { setShowResolved(true); openTeach(q); }
  };

  // Ask the AI to turn a plain-English correction into structured edit(s).
  const interpret = async (instruction: string, q: ReviewQuestion): Promise<Edit[]> => {
    const tenantList = (deal.tenants || []).map(t => t.canonicalName || t.name).filter(Boolean).slice(0, 120);
    const prompt = `You convert a user's plain-English correction about a commercial real-estate deal into structured field edits.
Return ONLY JSON (no markdown, no prose): {"edits":[{"kind":"deal"|"tenant","tenantName":string_or_null,"fieldKey":"string","value": <number|string|boolean|null>}]}

You may ONLY use these field keys.
DEAL fields (kind:"deal", tenantName null): ${Object.keys(DEAL_FIELDS).join(", ")}
TENANT fields (kind:"tenant", set tenantName to the matching tenant from the list): ${Object.keys(TENANT_FIELDS).join(", ")}

Value rules:
- Money/counts → plain number (e.g. "1.2 million" → 1200000, "$95k" → 95000). Percentages (capRate, occupancy, loanRate, occupancyCost) → the number only (e.g. "7.5%" → 7.5).
- Dates → "YYYY-MM-DD".
- Booleans (isAnchor, isNAP, isDark) → true/false. "went dark"/"closed but still paying" → isDark true.
- Text → the corrected string.
- To clear a field, use null.
- Only output edits you are confident about. If the instruction doesn't clearly map to an allowed field, return {"edits":[]}.

DEAL: ${deal.propertyName || "(unnamed)"} — ${[deal.city, deal.state].filter(Boolean).join(", ")}
TENANTS: ${tenantList.join(" | ") || "(none)"}
This correction concerns: ${q.question}${q.suggestedValue ? ` (currently captured as: ${q.suggestedValue})` : ""}
USER CORRECTION: ${instruction}`;

    // The AI proxy can briefly fail when the model is overloaded — retry once before giving up.
    let res: { content: { type: string; text?: string }[] } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await apiAiMessages({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        });
        break;
      } catch (err) {
        if (attempt === 1) throw new Error("The AI service was busy. Tap Save to try again — or just type the value directly.");
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    const raw = res?.content.find(c => c.type === "text")?.text ?? "";
    let parsed: { edits?: unknown[] };
    try { parsed = robustParseJSON(raw) as typeof parsed; } catch { throw new Error("Couldn't read the AI response — try rephrasing."); }
    const rawEdits = Array.isArray(parsed.edits) ? parsed.edits as Array<Record<string, unknown>> : [];

    const fmt = (v: string | number | boolean | null, type: string) =>
      type === "boolean" ? (v ? "Yes" : "No") : v == null ? "—" : typeof v === "number" ? v.toLocaleString() : String(v);
    const out: Edit[] = [];
    for (const e of rawEdits) {
      const kind = e.kind === "tenant" ? "tenant" : "deal";
      const fieldKey = String(e.fieldKey || "");
      const catalog = kind === "deal" ? DEAL_FIELDS : TENANT_FIELDS;
      const type = catalog[fieldKey];
      if (!type) continue; // not an allowed field — drop it
      const value = coerceVal(e.value, type);
      if (kind === "tenant") {
        const wantKey = tenantKey(String(e.tenantName || ""));
        const match = (deal.tenants || []).find(tn => tenantKey(tn.canonicalName || tn.name) === wantKey || tn.name === e.tenantName);
        if (!match) continue; // can't resolve which tenant — drop it
        out.push({ kind, fieldKey, tenantName: match.canonicalName || match.name, value, label: `${match.canonicalName || match.name} · ${fieldKey} → ${fmt(value, type)}` });
      } else {
        out.push({ kind, fieldKey, value, label: `${fieldKey} → ${fmt(value, type)}` });
      }
    }
    return out;
  };

  // Deterministic, AI-FREE parse of the most common correction Eric types: one or
  // more "<Tenant> <number>" pairs in a single answer (e.g. "McDonalds 3962,
  // Raising Canes 5800" when the site plan mislabeled two suites with the same SF).
  // It matches each named tenant against the roster (loose spelling — apostrophes,
  // spacing, plurals), reads the number that follows the name, and writes the
  // numeric field the question is about (its target field, or one inferred from the
  // wording: SF / PSF / rent / sales). Returns [] when it can't confidently parse,
  // so we fall through to the AI. This makes the common multi-tenant case instant
  // and reliable — no model call, and a working fallback when the AI is busy.
  const localInterpret = (instruction: string, q: ReviewQuestion): Edit[] => {
    const tenants = (deal.tenants || []) as Tenant[];
    if (!tenants.length) return [];
    const field = inferTenantNumberField(q);
    if (!field) return [];
    const hay = instruction.toLowerCase();
    // Find where each roster tenant is mentioned (full normalized name, its
    // space-collapsed form, or a distinctive ≥4-char token for one-word brands).
    const seen = new Set<string>();
    const found: { tenant: Tenant; pos: number }[] = [];
    for (const tn of tenants) {
      const name = (tn.canonicalName || tn.name || "").trim();
      if (!name) continue;
      const key = tenantKey(name);
      if (!key || seen.has(key)) continue;
      let pos = -1;
      const consider = (v: string) => { if (v && hay.includes(v)) { const p = hay.indexOf(v); if (pos < 0 || p < pos) pos = p; } };
      consider(name.toLowerCase()); consider(key); consider(key.replace(/ /g, ""));
      if (pos < 0) for (const tok of key.split(" ")) if (tok.length >= 4) consider(tok);
      if (pos >= 0) { found.push({ tenant: tn, pos }); seen.add(key); }
    }
    if (!found.length) return [];
    found.sort((a, b) => a.pos - b.pos);
    // Each tenant claims the first number appearing from its name up to the next
    // tenant's name (commas inside numbers like "5,800" stay intact).
    const numRe = /\$?\s*\d[\d,]*(?:\.\d+)?/;
    const out: Edit[] = [];
    for (let i = 0; i < found.length; i++) {
      const slice = instruction.slice(found[i].pos, i + 1 < found.length ? found[i + 1].pos : instruction.length);
      const m = slice.match(numRe);
      if (!m) continue;
      const value = Number(m[0].replace(/[$,\s]/g, ""));
      if (isNaN(value)) continue;
      const nm = found[i].tenant.canonicalName || found[i].tenant.name;
      out.push({ kind: "tenant", fieldKey: field, tenantName: nm, value, label: `${nm} · ${field} → ${value.toLocaleString()}` });
    }
    return out;
  };

  // Save handler for the inline editor: literal value → write directly; an
  // instruction → interpret via AI and show a confirmation proposal.
  const onSave = async (q: ReviewQuestion) => {
    if (!draft.trim()) { setAiErr("Type the correction first."); return; }
    const t = q.target;
    // A question tied to one editable field: a plain value writes directly; a
    // sentence goes to the AI. A question with no single field (e.g. a totals
    // reconciliation) can only be fixed by describing the change → always AI.
    const vt: "number" | "text" = t?.valueType === "text" ? "text" : "number";
    if (t && !looksLikeInstruction(draft, vt)) {
      const value = coerceVal(draft, vt);
      commitEdits(q, [{ kind: t.kind, fieldKey: t.fieldKey, tenantName: t.tenantName, value, label: `${t.fieldKey} → ${value ?? "—"}` }], value == null ? "(cleared)" : String(value));
      return;
    }
    // Deterministic parse first — "<Tenant> <number>" pairs need no AI and handle
    // multi-tenant answers instantly. Only call the model when that can't read it.
    const local = localInterpret(draft, q);
    if (local.length) { setProposal({ questionId: q.id, summary: local.map(e => e.label).join("; "), edits: local }); return; }
    setAiBusy(true); setAiErr(null);
    try {
      const edits = await interpret(draft, q);
      if (edits.length === 0) setAiErr("I couldn't tell which field to change. Try rephrasing, or just type the value itself.");
      else setProposal({ questionId: q.id, summary: edits.map(e => e.label).join("; "), edits });
    } catch (e) {
      // AI was busy/unreachable — try the deterministic parser as a last resort so a
      // multi-tenant correction still goes through without the model.
      const fallback = localInterpret(draft, q);
      if (fallback.length) setProposal({ questionId: q.id, summary: fallback.map(e => e.label).join("; "), edits: fallback });
      else setAiErr(e instanceof Error ? e.message : "The AI couldn't interpret that.");
    } finally {
      setAiBusy(false);
    }
  };

  const sevColor = (s: string) => s === "high" ? "#dc2626" : s === "medium" ? "#d9890c" : "#a89f8f";
  const sevBg = (s: string) => s === "high" ? "#fef2f2" : s === "medium" ? "#fffaf2" : "#faf7f0";

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(38,40,31,0.45)", backdropFilter: "blur(3px)", zIndex: 9500, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 620, boxShadow: "0 20px 60px rgba(38,40,31,0.3)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f1eadc", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 600, color: "#26281f" }}>Confirm import details</div>
            <div style={{ fontSize: 12.5, color: "#8b8578", marginTop: 4, lineHeight: 1.5 }}>
              {open.length > 0
                ? `${open.length} item${open.length === 1 ? "" : "s"} I wasn't fully sure I captured correctly from this document. Confirm it, or hit "Fix it" — type the value, or just describe the change in plain English and I'll set it for you.`
                : "Everything checks out — no open data-integrity questions for this deal."}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "#a89f8f", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Open questions */}
        <div style={{ maxHeight: "56vh", overflowY: "auto", padding: open.length ? "12px 22px 6px" : "0" }}>
          {open.map(q => (
            <div key={q.id} style={{ background: sevBg(q.severity), border: `1px solid ${sevColor(q.severity)}33`, borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: sevColor(q.severity), background: "#fff", border: `1px solid ${sevColor(q.severity)}44`, borderRadius: 4, padding: "1px 6px" }}>{q.severity}</span>
                {q.field && <span style={{ fontSize: 10.5, color: "#a89f8f", fontFamily: "monospace" }}>{q.field}</span>}
                <span style={{ fontSize: 8.5, color: "#bcae97", marginLeft: "auto" }}>{q.source === "ai" ? "AI flag" : "auto-check"}</span>
              </div>
              <div style={{ fontSize: 13.5, color: "#383a37", fontWeight: 500, lineHeight: 1.5 }}>{q.question}</div>
              {q.detail && <div style={{ fontSize: 12, color: "#8b8578", marginTop: 4, lineHeight: 1.5 }}>{q.detail}</div>}
              {q.suggestedValue && editingId !== q.id && (
                <div style={{ fontSize: 12, color: "#5c5047", marginTop: 6 }}>
                  Captured as: <span style={{ fontWeight: 600, background: "#fff", border: "1px solid #e7e0d2", borderRadius: 4, padding: "1px 6px" }}>{q.suggestedValue}</span>
                </div>
              )}

              {editingId === q.id ? (
                proposal && proposal.questionId === q.id ? (
                  /* AI proposal — confirm before writing */
                  <div style={{ marginTop: 10, background: "#f4f8ef", border: "1px solid #cfe3b8", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 11.5, color: "#3f7a1f", fontWeight: 700, marginBottom: 6 }}>I'll make {proposal.edits.length === 1 ? "this change" : "these changes"}:</div>
                    {proposal.edits.map((e, i) => (
                      <div key={i} style={{ fontSize: 12.5, color: "#2f3a24", padding: "3px 0", display: "flex", gap: 6 }}>
                        <span style={{ color: "#6f9c47" }}>•</span><span>{e.label}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button onClick={() => commitEdits(q, proposal.edits, proposal.summary)} style={{ background: "#3f7a1f", border: "none", color: "#fff", padding: "7px 16px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>Apply</button>
                      <button onClick={() => setProposal(null)} style={{ background: "#fff", border: "1px solid #c8b89a", color: "#7d766a", padding: "7px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "'Inter',sans-serif" }}>Edit my wording</button>
                      <button onClick={cancelFix} style={{ background: "transparent", border: "1px solid #d9d2c4", color: "#7d766a", padding: "7px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "'Inter',sans-serif" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  /* Inline correction editor — type a value OR an instruction */
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                      {q.target
                        ? `Corrected value${q.target.kind === "tenant" && q.target.tenantName ? ` for ${q.target.tenantName}` : ""}, or describe the change:`
                        : "Describe the correction in plain English and I'll set it:"}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        autoFocus
                        value={draft}
                        disabled={aiBusy}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !aiBusy) onSave(q); if (e.key === "Escape") cancelFix(); }}
                        placeholder={!q.target ? "e.g. “Suite 14 is 5,000 SF, not 3,000”" : q.target.valueType === "text" ? "Value, or e.g. “mark this tenant dark”" : "Number, or e.g. “NOI is about 1.2M”"}
                        style={{ flex: 1, border: "1px solid #c8b89a", borderRadius: 7, padding: "7px 10px", fontSize: 13, color: "#383a37", fontFamily: "'Inter',sans-serif", outline: "none", background: aiBusy ? "#f6f3ec" : "#fff" }}
                      />
                      <button onClick={() => onSave(q)} disabled={aiBusy} style={{ background: aiBusy ? "#9bbf7e" : "#3f7a1f", border: "none", color: "#fff", padding: "7px 14px", borderRadius: 7, cursor: aiBusy ? "default" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>{aiBusy ? "Reading…" : "Save"}</button>
                      <button onClick={cancelFix} disabled={aiBusy} style={{ background: "transparent", border: "1px solid #d9d2c4", color: "#7d766a", padding: "7px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "'Inter',sans-serif" }}>Cancel</button>
                    </div>
                    {aiErr && <div style={{ fontSize: 11, color: "#c0392b", marginTop: 5 }}>{aiErr}</div>}
                    {!aiErr && (
                      <div style={{ fontSize: 10.5, color: "#bcae97", marginTop: 5 }}>
                        {q.target?.kind === "tenant" && (q.target.fieldKey === "sf" || q.target.fieldKey === "remainingTermYears")
                          ? "Occupancy / WALT will recompute automatically. "
                          : ""}
                        {q.target
                          ? "Plain values save instantly; a sentence is interpreted and shown for your OK first."
                          : "I'll interpret your wording and show the exact change for your OK before saving."}
                      </div>
                    )}
                  </div>
                )
              ) : (
                <>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={() => resolve(q, "confirmed")} style={{ background: "#26281f", border: "none", color: "#e8e0cf", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>✓ Looks right</button>
                  <button onClick={() => startFix(q)} style={{ background: "#fff", border: "1px solid #8cbf63", color: "#3f7a1f", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>✎ Fix it</button>
                  <button onClick={() => resolve(q, "dismissed")} style={{ background: "#fff", border: "1px solid #d9d2c4", color: "#7d766a", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "'Inter',sans-serif" }}>Dismiss</button>
                  <span style={{ marginLeft: "auto" }}>{teachTrigger(q)}</span>
                </div>
                {teachBox(q)}
                </>
              )}
            </div>
          ))}

          {open.length === 0 && (
            <div style={{ padding: "26px 22px", textAlign: "center", color: "#9a917f", fontSize: 13 }}>
              ✓ No open questions.
            </div>
          )}
        </div>

        {/* Resolved (collapsed) */}
        {resolved.length > 0 && (
          <div style={{ borderTop: "1px solid #f1eadc", padding: "10px 22px 16px" }}>
            <button onClick={() => setShowResolved(s => !s)} style={{ background: "transparent", border: "none", color: "#a89f8f", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'Inter',sans-serif", padding: 0 }}>
              {showResolved ? "▾" : "▸"} {resolved.length} resolved
            </button>
            {showResolved && resolved.map(q => (
              <div key={q.id} style={{ borderTop: "1px solid #f6f1e7" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", fontSize: 12 }}>
                  <span style={{ color: q.resolution === "confirmed" ? "#0f9d63" : q.resolution === "fixed" ? "#3f7a1f" : "#a89f8f", flexShrink: 0 }}>{q.resolution === "confirmed" ? "✓" : q.resolution === "fixed" ? "✎" : "—"}</span>
                  <span style={{ color: "#8b8578", flex: 1, textDecoration: "line-through", textDecorationColor: "#d9d2c4" }}>{q.question}{q.resolution === "fixed" && q.suggestedValue ? ` → ${q.suggestedValue}` : ""}</span>
                  {teachTrigger(q)}
                  <button onClick={() => reopen(q)} style={{ background: "transparent", border: "none", color: "#bcae97", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>reopen</button>
                </div>
                {teachBox(q)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
