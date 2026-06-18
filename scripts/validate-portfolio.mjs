#!/usr/bin/env node
// Portfolio validation harness — "validate at scale" safety net.
//
// WHY THIS EXISTS: when we change a deterministic computation (occupancy, WALT,
// weighted-avg rent, occupancy-cost, an audit check), it silently changes how
// EVERY existing deal would render. This script re-runs the current logic across a
// whole set of deals and reports where a deal's STORED value diverges from what the
// CURRENT code would produce — i.e. which old deals a recent change just affected —
// so regressions are caught here, before Eric finds them.
//
// READ-ONLY: it never writes back to any deal or DB. It loads a backup JSON
// (the "Full backup (.json)" the app exports, or any {deals:[{id,data}]} dump),
// recomputes in memory, and prints a report. Run it against a FRESH full backup to
// cover all ~140 live deals; the partial 21-deal batch backup is only a sample.
//
//   node scripts/validate-portfolio.mjs [path-to-backup.json]
//
// The recompute formulas below are faithful ports of the app's real functions
// (artifacts/om-database/src/lib/utils.ts) — kept in lockstep with these citations:
//   recomputeRosterMetrics  utils.ts:973
//   isVacant                utils.ts:810
//   isNAPTenant             utils.ts:821
//   parseLeaseDate          utils.ts:938
// If you change those in utils.ts, mirror them here (and vice-versa).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKUP = resolve(__dirname, "deal-updates-backup-2026-05-27T12-58-44.json");

// ── faithful ports of the app's deterministic helpers ───────────────────────────
function isVacant(name) {
  const s = String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s || s === "-" || s === "–" || s === "—" || s === "n/a" || s === "na") return true;
  const c = s.replace(/^[\s\-–—•·*"']+/, "");
  if (/^vacan/.test(c)) return true;
  if (/^availab/.test(c)) return true;
  if (/^spec\s+(suite|space|unit)/.test(c)) return true;
  return false;
}
function isNAPTenant(t) {
  if (t.isNAP === true) return true;
  if (isVacant(t.name)) return false;
  const hasLease = !!(
    (typeof t.leaseStart === "string" && t.leaseStart.trim()) ||
    (typeof t.leaseExpiry === "string" && t.leaseExpiry.trim()) ||
    (typeof t.rentSchedule === "string" && t.rentSchedule.trim())
  );
  if (hasLease) return false;
  const sf = t.sf == null || t.sf === "" ? null : Number(t.sf);
  const rent = t.annualRent == null || t.annualRent === "" ? null : Number(t.annualRent);
  const rentPSF = t.rentPerSF == null || t.rentPerSF === "" ? null : Number(t.rentPerSF);
  return sf != null && sf > 0 && (rent == null || rent === 0) && (rentPSF == null || rentPSF === 0);
}
function parseLeaseDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + "T12:00:00"); return isNaN(d.getTime()) ? null : d; }
  if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split("-").map(Number); return new Date(y, m, 0, 12); }
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, d, y] = s.split("/").map(Number);
    const fy = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
    const dt = new Date(fy, mo - 1, d, 12); return isNaN(dt.getTime()) ? null : dt;
  }
  if (/^\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, y] = s.split("/").map(Number);
    const fy = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
    if (mo >= 1 && mo <= 12) return new Date(fy, mo, 0, 12);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function recomputeRosterMetrics(tenants, asOf, deal) {
  const nv = (v) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const ref = parseLeaseDate(asOf) ?? new Date();
  const verified = deal.verified || {};
  const out = {};
  const occ = tenants.filter(t => !isVacant(t.name) && !isNAPTenant(t));
  const totalSF = nv(deal.totalSF);
  if (!verified.occupancy && totalSF && totalSF > 0) {
    const occupiedSF = occ.reduce((s, t) => s + (nv(t.sf) ?? 0), 0);
    const o = Math.round(occupiedSF / totalSF * 1000) / 10;
    if (o > 0 && o <= 100) out.occupancy = o;
  }
  if (!verified.walt) {
    let sfT = 0, wT = 0;
    for (const t of occ) {
      const sf = nv(t.sf); if (!sf || sf <= 0) continue;
      const exp = parseLeaseDate(t.leaseExpiry);
      const yr = exp ? Math.max(0, (exp.getTime() - ref.getTime()) / (365.25 * 86_400_000)) : nv(t.remainingTermYears);
      if (yr == null) continue;
      sfT += sf; wT += sf * yr;
    }
    if (wT > 0 && sfT > 0) out.walt = Math.round(wT / sfT * 10) / 10;
  }
  if (!verified.weightedAvgRentPSF) {
    let sfR = 0, wR = 0;
    for (const t of occ) {
      const sf = nv(t.sf), r = nv(t.rentPerSF);
      if (sf && sf > 0 && r && r > 0) { sfR += sf; wR += sf * r; }
    }
    if (sfR > 0) out.weightedAvgRentPSF = Math.round(wR / sfR * 100) / 100;
  }
  return out;
}

// ── load + normalize the backup into a flat [{id, deal}] list ────────────────────
// Skips soft-deleted (trashedAt) deals — they're hidden on the site, so validating
// them would report issues on records the user already deleted.
function loadDeals(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const arr = Array.isArray(raw) ? raw : (raw.deals || raw.data || []);
  return arr
    .map(r => (r && r.data ? { id: r.id, deal: r.data } : { id: r?.id, deal: r }))
    .filter(({ deal }) => deal && !deal.trashedAt);
}

// ── checks ───────────────────────────────────────────────────────────────────────
const n = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
const findings = [];
function add(deal, severity, check, detail) {
  findings.push({ name: deal.propertyName || deal.fileName || "(untitled)", uploadedAt: deal.uploadedAt || null, severity, check, detail });
}

function validate(deal) {
  const tenants = Array.isArray(deal.tenants) ? deal.tenants : [];

  // 1. Stored vs recomputed occupancy / WALT / rentPSF (catches logic-change drift)
  if (tenants.length) {
    const r = recomputeRosterMetrics(tenants, deal.tenantsAsOf, deal);
    const cmp = (label, stored, fresh, absTol, relTol) => {
      const s = n(stored), f = fresh;
      if (s == null || f == null) return;
      const abs = Math.abs(s - f), rel = s !== 0 ? abs / Math.abs(s) : (f === 0 ? 0 : 1);
      if (abs > absTol && rel > relTol) add(deal, "drift", label, `stored ${s} vs current logic ${f} (Δ${abs.toFixed(1)})`);
    };
    cmp("occupancy", deal.occupancy, r.occupancy, 1, 0.02);
    cmp("walt", deal.walt, r.walt, 0.3, 0.05);
    cmp("weightedAvgRentPSF", deal.weightedAvgRentPSF, r.weightedAvgRentPSF, 0.5, 0.05);
  }

  // 2. Per-tenant rent integrity: rentPerSF × sf should ≈ annualRent (OCR/keying slips)
  for (const t of tenants) {
    if (isVacant(t.name) || isNAPTenant(t)) continue;
    const sf = n(t.sf), psf = n(t.rentPerSF), ann = n(t.annualRent);
    if (sf && psf && ann && ann > 0) {
      const implied = sf * psf, rel = Math.abs(implied - ann) / ann;
      if (rel > 0.05 && Math.abs(implied - ann) > 2000)
        add(deal, "tenant", "rent psf×sf vs annual", `${t.name}: ${psf}×${sf}=${Math.round(implied).toLocaleString()} vs annualRent ${ann.toLocaleString()} (${Math.round(rel*100)}% off)`);
    }
  }

  // 3. Occupancy-cost consistency (the recent fix): stated occ cost vs computed from
  //    base+recoveries+pct+other ÷ sales — only when sales + a cost component exist.
  for (const t of tenants) {
    const stated = n(t.occupancyCost), salesPSF = n(t.salesPSF), sf = n(t.sf);
    if (stated == null || stated <= 0 || !salesPSF || !sf) continue;
    const grossSales = salesPSF * sf;
    const base = n(t.annualRent) ?? 0, reimb = n(t.expenseReimbursements) ?? 0, pct = n(t.percentageRent) ?? 0, other = n(t.otherRent) ?? 0;
    const totalOcc = base + reimb + pct + other;
    if (grossSales > 0 && totalOcc > 0) {
      const computed = totalOcc / grossSales * 100;
      const abs = Math.abs(computed - stated), rel = abs / stated;
      if (rel > 0.30 && abs > 2)
        add(deal, "tenant", "occ-cost stated vs computed", `${t.name}: OM-stated ${stated}% vs computed ${computed.toFixed(1)}%`);
    }
  }

  // 4. NOI ÷ cap vs asking price three-way tie-out
  const noi = n(deal.noi), cap = n(deal.capRate), price = n(deal.askingPrice);
  if (noi && cap && price && cap > 0) {
    const implied = noi / (cap / 100), rel = Math.abs(implied - price) / price;
    if (rel > 0.05 && Math.abs(implied - price) > 100000)
      add(deal, "deal", "noi/cap vs price", `NOI ${noi.toLocaleString()} ÷ ${cap}% = ${Math.round(implied).toLocaleString()} vs price ${price.toLocaleString()} (${Math.round(rel*100)}% off)`);
  }
}

// ── run ────────────────────────────────────────────────────────────────────────
const path = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_BACKUP;
const deals = loadDeals(path);
for (const { deal } of deals) { try { validate(deal); } catch (e) { add(deal || {}, "error", "harness", String(e.message)); } }

// date-aware ordering: oldest-uploaded first (Eric's ask — old deals most at risk)
findings.sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));

const bySev = findings.reduce((m, f) => (m[f.severity] = (m[f.severity] || 0) + 1, m), {});
console.log(`\n=== Portfolio validation — ${deals.length} deals from ${path.split("/").pop()} ===`);
console.log(`Findings: ${findings.length} total`, JSON.stringify(bySev));
console.log(`(drift = a deal whose stored metric would CHANGE under current logic — i.e. a recent change touched it)\n`);
const label = { drift: "📈 LOGIC DRIFT", deal: "🔢 DEAL TIE-OUT", tenant: "🏪 TENANT", error: "⚠️ ERROR" };
for (const f of findings) {
  const when = f.uploadedAt ? new Date(f.uploadedAt).toISOString().slice(0, 10) : "—";
  console.log(`${label[f.severity] || f.severity}  [${when}]  ${f.name}`);
  console.log(`    ${f.check}: ${f.detail}`);
}
if (!findings.length) console.log("✅ No discrepancies — every deal's stored metrics match current logic.");
console.log("");
