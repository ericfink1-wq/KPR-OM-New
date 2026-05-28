#!/usr/bin/env python3
"""
KPR Upside Items — one-click deploy
Drop in Replit project root, then run in Shell:
    python3 deploy_upside_items.py
"""
import os, base64

BASE = os.path.dirname(os.path.abspath(__file__))

def patch(path, old, new, label):
    full = os.path.join(BASE, path)
    try:
        with open(full, encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        print(f"  MISS {label} — file not found")
        return
    if old not in content:
        print(f"  SKIP {label} — already applied")
        return
    with open(full, "w", encoding="utf-8") as f:
        f.write(content.replace(old, new, 1))
    print(f"  OK   {label}")

print("\n=== KPR Upside Items — applying changes ===\n")

# ── 1. idb.ts — add upsideItems to Deal type ──────────────────────────
print("1/3  lib/idb.ts")

patch("artifacts/om-database/src/lib/idb.ts",
  "  redFlags?: { severity: string; description: string }[];",
  "  redFlags?: { severity: string; description: string }[];\n  upsideItems?: { priority: string; item: string; detail: string }[];",
  "upsideItems field on Deal")

# ── 2. extract.ts — add upsideItems to extraction prompt ──────────────
print("2/3  api-server/src/lib/extract.ts")

patch("artifacts/api-server/src/lib/extract.ts",
  '"redFlags": [{"severity": "high|medium|low", "description": "string — high only for substantial roof end-of-life or anchor with weak credit/closure history. NEVER flag absent asking price or non-reassessed RE taxes."}],',
  '"redFlags": [{"severity": "high|medium|low", "description": "string — high only for substantial roof end-of-life or anchor with weak credit/closure history. NEVER flag absent asking price or non-reassessed RE taxes."}],\n  "upsideItems": [{"priority": "high|medium|low", "item": "short label e.g. Mark-to-Market Rent Upside", "detail": "1-2 sentence explanation of the opportunity and magnitude if quantifiable — high only for significant value-creation opportunities clearly supported by OM data. Examples: below-market leases rolling to market, repositioning/redevelopment potential, shadow anchor lease-up, occupancy upside, strong demographics supporting rent growth. Do NOT list generic positives already captured in dealScore.strengths. Empty array if no genuine upside items beyond the going-in yield."}],',
  "upsideItems in extraction prompt")

# ── 3. DetailView.tsx — add nav item + render green panel ─────────────
print("3/3  DetailView.tsx")

patch("artifacts/om-database/src/components/DetailView.tsx",
  'if ((deal.redFlags && deal.redFlags.length > 0) || deriveExpenseRiskFlag(deal)) items.push({ id: "section-redflags", label: "Red Flags" });',
  'if ((deal.upsideItems && deal.upsideItems.length > 0)) items.push({ id: "section-upside", label: "Upside Items" });\n  if ((deal.redFlags && deal.redFlags.length > 0) || deriveExpenseRiskFlag(deal)) items.push({ id: "section-redflags", label: "Red Flags" });',
  "Upside Items nav entry")

UPSIDE_PANEL = """
      {/* Upside items */}
      {(d.upsideItems && d.upsideItems.length > 0) && (() => {
        const priOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const sorted = [...d.upsideItems!].sort((a, b) => (priOrder[a.priority ?? "low"] ?? 2) - (priOrder[b.priority ?? "low"] ?? 2));
        return (
          <div id="section-upside" style={{ background:"#f2faf0", border:"1px solid #3f7a1f40", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
              <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#2d7a0e", fontWeight:700 }}>&#10024; UPSIDE ITEMS</div>
              {d.analysisStale && <StaleBadge />}
            </div>
            {sorted.map((u,i) => (
              <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom:i<sorted.length-1?"1px solid #d4edca":"none", alignItems:"flex-start" }}>
                <span style={{ fontSize:9, padding:"2px 6px", borderRadius:3, background:u.priority==="high"?"#22c55e20":u.priority==="medium"?"#86efac20":"#bbf7d020", color:u.priority==="high"?"#166534":u.priority==="medium"?"#15803d":"#166534", fontWeight:600, flexShrink:0 }}>{u.priority?.toUpperCase()}</span>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:"#1a3d12", marginBottom:2 }}>{u.item}</div>
                  <div style={{ fontSize:11, color:"#3d5c35", lineHeight:1.55 }}>{u.detail}</div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Red flags */}"""

patch("artifacts/om-database/src/components/DetailView.tsx",
  "      {/* Red flags */}",
  UPSIDE_PANEL,
  "render upside panel above red flags")

print("\n=== All done! ===")
print("Replit will hot-reload automatically.")
print("")
print("EXISTING DEALS: upside items will appear after you re-analyze any deal")
print("  (Actions menu > Re-analyze from stored text, or re-upload the PDF).")
print("NEW DEALS uploaded from now on will extract upside items automatically.")
