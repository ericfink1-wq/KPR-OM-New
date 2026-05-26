import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Deal } from "./idb";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getRecency(deal: Deal): { label: string; color: string; bg: string } | null {
  const date = deal.omDate || deal.uploadedAt;
  if (!date) return null;
  const months = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months < 2) return { label: "FRESH", color: "#0f9d63", bg: "#0f9d6318" };
  if (months < 5) return { label: "RECENT", color: "#6dba43", bg: "#6dba4318" };
  if (months < 10) return { label: "AGING", color: "#d9890c", bg: "#d9890c18" };
  return { label: "STALE", color: "#a69e91", bg: "#a69e9118" };
}

export function classifyLocation(deal: Deal) {
  const pop = deal.population3mi;
  const inc = deal.avgHHIncome3mi ?? deal.medianHHIncome3mi;
  const market = (deal.market || "").toLowerCase();
  const urbanKeys = ["new york","los angeles","chicago","houston","phoenix","philadelphia",
    "san antonio","san diego","dallas","san jose","austin","jacksonville","fort worth",
    "columbus","charlotte","indianapolis","san francisco","seattle","denver","washington"];
  const suburbanKeys = ["suburb","township","village","heights","grove","hills","lake","park","springs","station"];
  let urbanicity: string | null = null;
  if (urbanKeys.some(k => market.includes(k))) urbanicity = "Urban";
  else if (suburbanKeys.some(k => market.includes(k))) urbanicity = "Suburban";
  else if (market) urbanicity = "Suburban";
  let density: { tier: string; color: string } | null = null;
  if (pop != null) {
    if (pop >= 150000) density = { tier: "Dense Urban", color: "#0d9488" };
    else if (pop >= 80000) density = { tier: "Urban", color: "#0f9d63" };
    else if (pop >= 40000) density = { tier: "Suburban", color: "#6dba43" };
    else if (pop >= 15000) density = { tier: "Exurban", color: "#d9890c" };
    else density = { tier: "Rural", color: "#a69e91" };
  }
  let income: { tier: string; color: string } | null = null;
  if (inc != null) {
    if (inc >= 150000) income = { tier: "Affluent", color: "#0f9d63" };
    else if (inc >= 100000) income = { tier: "Upper-Middle", color: "#6dba43" };
    else if (inc >= 70000) income = { tier: "Middle", color: "#d9890c" };
    else if (inc >= 50000) income = { tier: "Lower-Middle", color: "#b45309" };
    else income = { tier: "Low Income", color: "#dc2626" };
  }
  return { urbanicity, density, income, pop, inc };
}

export function findSimilar(deal: Deal, all: Deal[]): Deal[] {
  return all.filter(d => {
    if (d.id === deal.id || d.trashedAt) return false;
    const sameType = d.assetType === deal.assetType;
    const sameMarket = d.market && deal.market && d.market.toLowerCase() === deal.market.toLowerCase();
    const sameSF = deal.totalSF && d.totalSF &&
      Math.abs(Number(d.totalSF) - Number(deal.totalSF)) / Number(deal.totalSF) < 0.25;
    return (sameType && sameMarket) || (sameType && sameSF) || (sameMarket && sameSF);
  }).slice(0, 4);
}

export function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
}

// Tally fields the user has manually corrected across all deals and return
// in-context guidance to inject into the extraction prompt for new runs.
// This is NOT model training — it's a "corrections memory" in the prompt.
export function buildCorrectionsNote(deals: Deal[]): string {
  const skip = new Set(["extraction","record","propertyGroup","status","marketSale","marketDemographics","imageMeta","userNotes"]);
  const counts: Record<string, number> = {};
  for (const d of deals || []) {
    for (const h of (((d as unknown) as Record<string, unknown>).editHistory as Array<{ by?: string; changes?: Array<{ field?: string; to?: unknown }> }> || [])) {
      if (/^(AI|Auto|PDF)/i.test(h.by || "")) continue;
      for (const c of h.changes || []) {
        const f = c.field;
        if (!f || skip.has(f)) continue;
        if (c.to === "verified" || c.to === "unverified") continue;
        counts[f] = (counts[f] || 0) + 1;
      }
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([f]) => humanizeKey(f));
  if (!top.length) return "";
  return `\n\nANALYST CORRECTION HISTORY — across prior deals the user has manually corrected these fields, so the source figures or a first read were often off. Extract these with extra care: prefer the ACTUAL/in-place figures stated in the OM (not asking, pro-forma, or marketing numbers) and double-check them: ${top.join(", ")}.`;
}

export function assessExtraction(deal: Deal): { quality: "good" | "partial" | "thin"; missing: string[] } {
  const core: [keyof Deal, string][] = [
    ["propertyName","Property Name"],["totalSF","Total SF"],
    ["noi","NOI"],["occupancy","Occupancy"],["walt","WALT"],
  ];
  const missing = core.filter(([k]) => deal[k] == null || deal[k] === "").map(([,l]) => l);
  const hasTenants = (deal.tenants || []).length > 0;
  const quality = missing.length === 0 && hasTenants ? "good" : missing.length <= 2 ? "partial" : "thin";
  return { quality, missing };
}

export interface ReconcileCheck { label: string; detail: string; severity: "error" | "warn"; }
export function reconcileDeal(deal: Deal) {
  const checks: ReconcileCheck[] = [];
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const noi = n(deal.noi), cap = n(deal.capRate), price = n(deal.askingPrice);
  const sf = n(deal.totalSF), ppsf = n(deal.pricePerSF);
  const gpr = n(deal.grossPotentialRent), egi = n(deal.effectiveGrossIncome), opex = n(deal.operatingExpenses);
  if (noi && cap && price) {
    const implied = noi / (cap / 100);
    const diff = Math.abs(implied - price) / price;
    if (diff > 0.12) checks.push({ severity:"error", label:"Cap rate / price mismatch", detail:`NOI ÷ cap rate implies $${Math.round(implied).toLocaleString()}, but asking price is $${Math.round(price).toLocaleString()} (${(diff*100).toFixed(0)}% gap).` });
  }
  if (price && sf && ppsf) {
    const implied = price / sf;
    const diff = Math.abs(implied - ppsf) / ppsf;
    if (diff > 0.1) checks.push({ severity:"warn", label:"Price/SF mismatch", detail:`$${Math.round(price).toLocaleString()} ÷ ${sf.toLocaleString()} SF = $${implied.toFixed(0)}/SF, but extracted price/SF is $${ppsf}.` });
  }
  if (gpr && egi && noi) {
    if (noi > egi) checks.push({ severity:"error", label:"NOI exceeds EGI", detail:`NOI ($${noi.toLocaleString()}) should not exceed Effective Gross Income ($${egi.toLocaleString()}).` });
    if (egi && opex && noi) {
      const impliedNOI = egi - opex;
      const diff = Math.abs(impliedNOI - noi) / noi;
      if (diff > 0.08) checks.push({ severity:"warn", label:"Income statement doesn't balance", detail:`EGI ($${egi.toLocaleString()}) − OpEx ($${opex.toLocaleString()}) = $${impliedNOI.toLocaleString()}, but NOI is $${noi.toLocaleString()} (${(diff*100).toFixed(0)}% gap).` });
    }
  }
  const hadData = !!(noi || price || sf || gpr);
  return { checks, errors: checks.filter(c => c.severity==="error").length, warns: checks.filter(c => c.severity==="warn").length, hadData };
}

export function buildSystemPrompt(deals: Deal[]): string {
  const active = deals.filter(d => !d.trashedAt);
  const statuses = ["Prospect","Under Contract","Owned","Sold","Passed"];
  const bySt = Object.fromEntries(statuses.map(s => [s, active.filter(d => d.status === s).length]));
  const portfolio = active.map(d => {
    const isPassed = d.status === "Passed";
    const tenantList = (d.tenants || []);
    // Active deals: full roster. Passed deals: anchor-only compact summary to save tokens.
    const tenants = isPassed
      ? tenantList
          .filter(t => t.isAnchor || (t.sf && Number(t.sf) >= 5000))
          .map(t => ({ name: t.name, sf: t.sf, anchor: t.isAnchor || undefined, expiry: t.leaseExpiry }))
      : tenantList.map(t => ({
          name: t.name,
          sf: t.sf,
          rentPSF: t.rentPerSF,
          annualRent: t.annualRent,
          expiry: t.leaseExpiry,
          salesPSF: t.salesPSF ?? undefined,
          anchor: t.isAnchor || undefined,
          reimb: t.reimbursementMethod ?? undefined,
        }));
    return {
      id: d.id, name: d.propertyName||d.fileName, market: d.market,
      assetType: d.assetType, status: d.status, totalSF: d.totalSF,
      noi: d.noi, capRate: d.capRate, askingPrice: d.askingPrice,
      occupancy: d.occupancy, walt: d.walt,
      tenants: tenants.length ? tenants : undefined,
    };
  });
  return `You are an expert commercial real estate analyst specializing in retail shopping centers (KPR Centers portfolio).

Portfolio summary: ${active.length} deals — ${statuses.map(s => `${bySt[s]} ${s}`).join(", ")}.

Full portfolio data:
${JSON.stringify(portfolio, null, 2)}

Guidelines:
- Be specific, reference actual deal names and numbers from the portfolio above.
- Format currency as $X,XXX,XXX and percentages with one decimal.
- Keep responses focused and actionable.
- Today's date: ${new Date().toLocaleDateString()}.`;
}

export function cityState(d: Deal): string {
  if (d.city || d.state) return [d.city, d.state].filter(Boolean).join(", ");
  const a = (d.address || "").trim();
  if (a) {
    const parts = a.split(",").map(s => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const sm = last.match(/\b([A-Z]{2})\b/);
    const state = sm ? sm[1] : "";
    let city = parts.length >= 2 ? parts[parts.length - 2] : "";
    if (/^\d/.test(city) || /\b[A-Z]{2}\b\s*\d{5}/.test(city)) city = "";
    const out = [city, state].filter(Boolean).join(", ");
    if (out) return out;
  }
  return d.market || "";
}

// Robust AI-response JSON parser — strips markdown fences, trailing commas, and
// recovers gracefully from truncated output (the same strategy used server-side
// in extract.ts). Use this whenever parsing a raw AI text response.
export function robustParseJSON(raw: string): unknown {
  if (!raw?.trim()) throw new Error("Empty response");
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(s); } catch {}
  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")); } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }
  if (first !== -1) {
    try { return _repairTruncatedJSON(s.slice(first)); } catch {}
  }
  throw new Error("All parse strategies failed");
}
function _repairTruncatedJSON(s: string): unknown {
  let inStr = false, esc = false;
  const stack: string[] = [];
  let safeLen = -1, safeClosers = "";
  const closersFor = () => stack.map(b => b === "{" ? "}" : "]").reverse().join("");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") { stack.pop(); safeLen = i + 1; safeClosers = closersFor(); }
    else if (c === ",") { safeLen = i; safeClosers = closersFor(); }
  }
  if (safeLen <= 0) throw new Error("Could not repair truncated JSON");
  return JSON.parse(s.slice(0, safeLen).replace(/,\s*$/, "") + safeClosers);
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
