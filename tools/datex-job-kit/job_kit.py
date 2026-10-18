#!/usr/bin/env python3
"""KPR Datex job kit — the helper the scheduled Datex auto-refresh task runs.

Served by the site at GET /api/datex/job-kit (same Bearer token as the ingest endpoints).
Python 3 standard library only. The task's loop:

  export DATEX_INGEST_TOKEN=kpr_dx_...
  python3 job_kit.py state --out state.json                       # 1. what the site has
  python3 job_kit.py plan --state state.json                      # 2a. the Occupancy call
      ... make that Datex MCP call ...
  python3 job_kit.py extract --transcript <session.jsonl> --out calls.jsonl
  python3 job_kit.py plan --state state.json --calls calls.jsonl  # 2b. the remaining calls
      ... make those calls (follow nextCursor while hasMore) ...
  python3 job_kit.py extract --transcript <session.jsonl> --out calls.jsonl
  python3 job_kit.py build --state state.json --calls calls.jsonl --out payload.json
  python3 job_kit.py post --payload payload.json --dry-run        # 5. preview
  python3 job_kit.py post --payload payload.json                  #    then write

calls.jsonl is one JSON object per line: {"entity", "tool", "filters", "rows": [...]}. The
`extract` command builds it from the task's own transcript (/root/.claude/projects/*/<id>.jsonl);
a hand-written file in the same shape works too.

The kit builds a DELTA payload: a block is sent for a deal only when the calls actually
covered that deal's buildings. The site keeps every block that isn't sent. All guardrails
(owned-only, building map, occupied <= total, over90 <= over60, no sale fields) are enforced
again on the server — the kit is a convenience, never the safety net.
"""
import argparse
import datetime as dt
import glob
import hashlib
import json
import math
import os
import re
import ssl
import sys
import urllib.error
import urllib.request

KIT_VERSION = "2026-10-18.1"
DEFAULT_BASE = os.environ.get("KPR_BASE_URL", "https://kpr-oms.replit.app")

# The field that names the building, per entity (Datex ids are fixed-width: always trim).
BLDG_FIELD = {
    "Occupancy": "BuildingId", "TenantsMetrics": "BuildingId", "Tenants": "BuildingId",
    "SalesHistory": "BuildingId", "TenantLedger": "BuildingId", "FinancialGroups": "EntityID",
    "LeaseAppDealHistoryBySuite": "BldgId", "VacantSuites": "BLDGID", "Spaces": "BLDGID",
}
BASIS = {"C": "Cash", "A": "Accrual"}


# ── small helpers ──────────────────────────────────────────────────────────────
def nid(v):
    """Datex character ids are fixed-width with trailing spaces; compare trimmed, lowercase."""
    return str(v if v is not None else "").strip().lower()


def s(v):
    t = str(v if v is not None else "").strip()
    return t or None


def num(v):
    if v is None or v == "":
        return None
    try:
        n = float(str(v).replace(",", "").replace("$", "")) if isinstance(v, str) else float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def iso_day(v):
    """'2034-12-31T00:00:00Z' -> '2034-12-31'. Datex's 1900 sentinel dates mean 'none'."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(v or ""))
    if not m or int(m.group(1)) < 1950:
        return None
    return m.group(0)


def yyyymm(v):
    t = str(v or "").strip()
    if re.fullmatch(r"\d{6}", t):
        return t
    m = re.match(r"^(\d{4})-(\d{2})", t)
    return m.group(1) + m.group(2) if m else None


def add_months(p, k):
    y, m = int(p[:4]), int(p[4:]) + k
    while m < 1:
        y, m = y - 1, m + 12
    while m > 12:
        y, m = y + 1, m - 12
    return f"{y:04d}{m:02d}"


def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[4:]) - int(a[4:])


def js_num(n):
    """Format a number the way JavaScript's String() does after Math.round(n*100)/100 —
    so the roster hash here matches the site's byte for byte."""
    r = math.floor(n * 100 + 0.5) / 100
    if r == int(r):
        return str(int(r))
    return repr(r)


def roster_hash(tenants):
    """Must equal rosterHash() in the site (lib/datexIngest.ts)."""
    def f(v):
        x = num(v)
        return "" if x is None else js_num(x)
    lines = sorted("|".join([str(t.get("tenantId") or "").strip(), f(t.get("sf")), f(t.get("annualRent")), str(t.get("leaseExpiry") or "")[:10]]) for t in tenants)
    return hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()[:16]


def warn(msg):
    print(f"  ! {msg}", file=sys.stderr)


# ── transcript extraction ──────────────────────────────────────────────────────
DATEX_TOOL = re.compile(r"^mcp__.*datex.*__(read_records|aggregate_records)$", re.I)
SAVED_TO = re.compile(r"saved to (\S+?\.(?:txt|json))", re.I)


def _result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""


def _parse_result(text):
    """A tool result is the Datex JSON, or a pointer to a file holding it when it was large."""
    t = (text or "").strip()
    if not t.startswith("{"):
        m = SAVED_TO.search(t)
        if not m:
            return None                         # an error message, not data
        try:
            with open(m.group(1), encoding="utf-8") as fh:
                t = fh.read().strip()
        except OSError as e:
            warn(f"couldn't read saved result {m.group(1)}: {e}")
            return None
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        return None


def extract_calls(transcript_path):
    """Every successful Datex read/aggregate in a Claude session transcript, in call order.
    Pages of the same call (followed via `after`) come out as separate entries; build() merges them."""
    uses, out = {}, []
    with open(transcript_path, encoding="utf-8") as fh:
        for line in fh:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            content = (o.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for it in content:
                if not isinstance(it, dict):
                    continue
                if it.get("type") == "tool_use" and DATEX_TOOL.match(str(it.get("name", ""))):
                    uses[it.get("id")] = it
                elif it.get("type") == "tool_result" and it.get("tool_use_id") in uses:
                    if it.get("is_error"):
                        continue
                    use = uses.pop(it["tool_use_id"])
                    data = _parse_result(_result_text(it.get("content")))
                    if not isinstance(data, dict):
                        continue
                    inp = use.get("input") or {}
                    agg = str(use.get("name", "")).endswith("aggregate_records")
                    if agg:
                        rows = [{**(r.get("group") or {}), "value": r.get("value")} for r in data.get("results") or []]
                    else:
                        rows = list(data.get("items") or [])
                    out.append({"entity": inp.get("entity"), "tool": "aggregate" if agg else "read",
                                "function": inp.get("function"), "field": inp.get("field"),
                                "filters": inp.get("filters") or [], "filterLogic": inp.get("filterLogic") or "and",
                                "rows": rows})
    return out


# ── call bookkeeping ───────────────────────────────────────────────────────────
def load_calls(path):
    calls = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                c = json.loads(line)
                c.setdefault("filters", [])
                c.setdefault("rows", [])
                c.setdefault("tool", "read")
                calls.append(c)
    return calls


def call_buildings(call):
    """The buildings a call was filtered to, or None when it covered every building."""
    fld = BLDG_FIELD.get(call.get("entity"))
    ids = {nid(f.get("value")) for f in call.get("filters") or []
           if f and f.get("field") == fld and str(f.get("operator", "")).lower() in ("eq", "contains", "startswith")}
    return ids or None


def covered(calls, entity, bldgs):
    """True when every one of these buildings was covered by at least one call on the entity."""
    cs = [c for c in calls if c.get("entity") == entity]
    if not cs:
        return False
    for b in bldgs:
        if not any(call_buildings(c) is None or b in call_buildings(c) for c in cs):
            return False
    return True


def rows_for(calls, entity, bldgs, tool=None):
    fld, seen, out = BLDG_FIELD.get(entity), set(), []
    for c in calls:
        if c.get("entity") != entity or (tool and c.get("tool") != tool):
            continue
        for r in c.get("rows") or []:
            if fld and nid(r.get(fld)) not in bldgs:
                continue
            k = json.dumps(r, sort_keys=True)
            if k not in seen:
                seen.add(k)
                out.append(r)
    return out


def latest_period(calls):
    ps = [yyyymm(r.get("Period")) for c in calls if c.get("entity") == "Occupancy" for r in c.get("rows") or []]
    ps = [p for p in ps if p]
    return max(ps) if ps else None


# ── build: raw Datex rows -> v2 payload, delta form ─────────────────────────────
OCC_SUMS = [("totalGLA", "TotalGLA"), ("occupiedGLA", "TotalGLAOccupied"), ("vacantGLA", "TotalGLAVacant"),
            ("totalUnits", "TotalUnits"), ("occupiedUnits", "TotalOccupiedUnits"), ("vacantUnits", "TotalVacantUnits")]
SEGMENTS = {"shop": "Shop", "major": "Major", "subMajor": "SubMajor", "pad": "Pad", "groundLease": "GroundLease"}


def build_occupancy(calls, bl, period):
    rows = [r for r in rows_for(calls, "Occupancy", bl) if yyyymm(r.get("Period")) == period]
    have = {nid(r.get("BuildingId")) for r in rows}
    if not rows or have != set(bl):
        return None, None
    out = {"period": period}
    for k, f in OCC_SUMS:
        vals = [num(r.get(f)) for r in rows]
        if all(v is not None for v in vals):
            out[k] = sum(vals)
    seg = {}
    for key, pre in SEGMENTS.items():
        g = [num(r.get(f"{pre}GLA")) for r in rows]
        if any(v is not None for v in g):
            d = {"gla": sum(v or 0 for v in g)}
            og = [num(r.get(f"{pre}OccupiedGLA")) for r in rows]
            if any(v is not None for v in og):
                d["occupiedGLA"] = sum(v or 0 for v in og)
            seg[key] = d
    if seg:
        out["segments"] = seg
    am = next((s(r.get("AssetManager")) for r in rows if s(r.get("AssetManager"))), None)
    return out, am


def tenant_index(calls, bl):
    """(building, tenantId) -> Tenants row, when Tenants was fetched for those buildings."""
    idx = {}
    for r in rows_for(calls, "Tenants", bl):
        idx[(nid(r.get("BuildingId")), str(r.get("TenantId") or "").strip())] = r
    return idx


def build_tenants(calls, bl):
    tm = rows_for(calls, "TenantsMetrics", bl)
    if not tm:
        return []
    # One Period only: the latest present per building (an unpinned read counts tenants many times).
    latest = {}
    for r in tm:
        b, p = nid(r.get("BuildingId")), yyyymm(r.get("Period")) or ""
        latest[b] = max(latest.get(b, ""), p)
    tm = [r for r in tm if (yyyymm(r.get("Period")) or "") == latest[nid(r.get("BuildingId"))]]
    have_tenants = covered(calls, "Tenants", bl)
    idx = tenant_index(calls, bl)
    best = {}
    for r in tm:
        b, tid, suite = nid(r.get("BuildingId")), str(r.get("TenantId") or "").strip(), str(r.get("SUITID") or "").strip()
        if not tid:
            continue
        k = (b, tid, suite)
        # Duplicate rows per tenant arrive at $0 rent — keep the one carrying the rent.
        if k not in best or (num(r.get("AnnualRent")) or 0) > (num(best[k].get("AnnualRent")) or 0):
            best[k] = r
    out = []
    for (b, tid, suite), r in sorted(best.items()):
        t = idx.get((b, tid))
        occ = (s(t.get("OCCPSTAT")) or "").upper()[:1] if t else ""
        if occ == "I":
            continue                              # vacated
        if t is None and have_tenants:
            continue                              # Tenants was read (OCCPSTAT ne I) and this id isn't in it: vacated
        if not occ and "." in tid:
            continue                              # no status: a dotted id is a superseded generation
        row = {"tenantId": tid, "name": s((t or {}).get("DBA")) or s(r.get("Tenant")) or s((t or {}).get("Tenant")) or tid}
        if suite:
            row["suite"] = suite
        for key, f in (("sf", "SuiteSQFT"), ("annualRent", "AnnualRent"), ("annualRentPSF", "AnnualRentPSF"), ("annualNNN", "AnnualNNN"),
                       ("annualNNNPSF", "AnnualNNNPSF"), ("annualOther", "AnnualOther"), ("delinquency", "Delinquency")):
            v = num(r.get(f))
            if v is not None:
                row[key] = v
        lsp = yyyymm(r.get("LastSalesPeriod"))
        if lsp:
            row["lastSalesPeriod"] = lsp
        if t:
            if s(t.get("NationalTenant")):
                row["nationalTenant"] = s(t.get("NationalTenant"))
            if iso_day(t.get("BEGINDATE")):
                row["leaseStart"] = iso_day(t.get("BEGINDATE"))
            if iso_day(t.get("EXPIR")):
                row["leaseExpiry"] = iso_day(t.get("EXPIR"))
            ct = (s(t.get("COTENANT")) or "").upper()
            if ct and ct not in ("N", "NO", "0", "FALSE"):
                row["coTenancy"] = True
            if occ:
                row["occStatus"] = occ
        out.append(row)
    return out


def build_vacant(calls, bl):
    sq = {(nid(r.get("BLDGID")), str(r.get("SUITID") or "").strip()): num(r.get("SUITSQFT")) for r in rows_for(calls, "Spaces", bl)}
    out = []
    for r in rows_for(calls, "VacantSuites", bl):
        suite = str(r.get("SUITID") or "").strip()
        if not suite:
            continue
        v = {"suite": suite}
        sf = sq.get((nid(r.get("BLDGID")), suite))
        if sf is not None:
            v["sf"] = sf
        out.append(v)
    return out


def build_sales(calls, bl):
    out = []
    for r in rows_for(calls, "SalesHistory", bl):
        st = (s(r.get("SalesType")) or "GROSS").upper()
        amt, per, tid = num(r.get("SalesAmount")), yyyymm(r.get("SalesPeriod")), s(r.get("TenantId"))
        if st != "GROSS" or not tid or not per or per == "190001" or amt is None or amt <= 1:
            continue
        out.append({"tenantId": tid, "period": per, "amount": amt, "reportingType": (s(r.get("ReportingType")) or "RPT").upper()})
    return out


def _age_days(as_of, v):
    d = iso_day(v)
    return None if not d else (dt.date.fromisoformat(as_of) - dt.date.fromisoformat(d)).days


def build_ar(calls, bl, as_of, current_ids):
    """A/R from TenantLedger — raw rows (bucketed by TransactionDate) or the plan's three
    aggregate calls (sum of TransactionOpenAmount by building + tenant, no date filter /
    TransactionDate <= as_of-60d / <= as_of-90d)."""
    per = {}

    def bucket(tid, name, key, amt):
        e = per.setdefault(tid, {"tenantId": tid, "name": name or tid, "total": 0.0, "over60": 0.0, "over90": 0.0})
        if name and e["name"] == tid:
            e["name"] = name
        e[key] += amt

    for c in calls:
        if c.get("entity") != "TenantLedger":
            continue
        rows = [r for r in c.get("rows") or [] if nid(r.get("BuildingId")) in bl]
        if c.get("tool") == "aggregate":
            cut = next((f.get("value") for f in c.get("filters") or [] if f.get("field") == "TransactionDate" and str(f.get("operator")).lower() in ("le", "lt")), None)
            age = _age_days(as_of, cut) if cut else None
            key = "total" if age is None else "over90" if age >= 89 else "over60" if age >= 59 else None
            if key is None:
                continue
            for r in rows:
                amt = num(r.get("value"))
                if amt and amt > 0:
                    bucket(str(r.get("TenantId") or "").strip(), s(r.get("TenantFlags")), key, amt)
        else:
            for r in rows:
                amt = num(r.get("TransactionOpenAmount"))
                if not amt or amt <= 0:
                    continue
                tid, nm, age = str(r.get("TenantId") or "").strip(), s(r.get("TenantFlags")), _age_days(as_of, r.get("TransactionDate"))
                bucket(tid, nm, "total", amt)
                if age is not None and age >= 60:
                    bucket(tid, nm, "over60", amt)
                if age is not None and age >= 90:
                    bucket(tid, nm, "over90", amt)
    if not per:
        return {"totalOpen": 0, "over60": 0, "over90": 0, "byTenant": []}
    by = []
    for e in per.values():
        row = {"tenantId": e["tenantId"], "name": e["name"], "over60": round(e["over60"], 2), "over90": round(e["over90"], 2)}
        if current_ids is not None:
            row["occpstat"] = current_ids.get(e["tenantId"], "I")
        by.append(row)
    by.sort(key=lambda x: -x["over60"])
    return {"totalOpen": round(sum(e["total"] for e in per.values()), 2), "over60": round(sum(e["over60"] for e in per.values()), 2),
            "over90": round(sum(e["over90"] for e in per.values()), 2), "byTenant": [r for r in by if r["over60"] > 0][:25]}


def build_financials(calls, bl, period):
    rows = [r for r in rows_for(calls, "FinancialGroups", bl) if (s(r.get("AccountGroupId")) or "").upper() == "NOI"]
    at = [r for r in rows if yyyymm(r.get("Period")) == period]
    if not at or {nid(r.get("EntityID")) for r in at} != set(bl):
        return None
    out = {"period": period}
    for key, f in (("noiYtdActual", "YtdActual"), ("noiYtdBudget", "YtdBudget"), ("noiYearBudget", "CurrentYearBudget")):
        vals = [num(r.get(f)) for r in at]
        if all(v is not None for v in vals):
            out[key] = sum(vals)
    ttm = 0.0
    for b in bl:
        mine = {yyyymm(r.get("Period")): num(r.get("Actual")) for r in rows if nid(r.get("EntityID")) == b}
        want = [add_months(period, -i) for i in range(12)]
        if all(mine.get(p) is not None for p in want):
            ttm += sum(mine[p] for p in want)                   # 12 monthly actuals: exact
        else:
            v = next((num(r.get("TwelveMoActual")) for r in at if nid(r.get("EntityID")) == b), None)
            if v is None:
                ttm = None
                break
            ttm += v                                            # Datex's own trailing-12
    if ttm is not None:
        out["noiTtmActual"] = ttm
    bases = {BASIS.get((s(r.get("Basis")) or "").upper()[:1], s(r.get("Basis"))) for r in at if s(r.get("Basis"))}
    if bases:
        out["basis"] = bases.pop() if len(bases) == 1 else "Mixed"
    return out


def build_leasing(calls, bl):
    out = []
    for r in rows_for(calls, "LeaseAppDealHistoryBySuite", bl):
        t = s(r.get("DBA")) or s(r.get("LegalName"))
        if not t:
            continue
        o = {"tenant": t}
        if s(r.get("SuiteId")):
            o["suite"] = s(r.get("SuiteId"))
        for key, f in (("gla", "ProposedGLA"), ("rentPSF", "ProposedRentInitialPSFRent"), ("termMonths", "LeaseTermTotalMonths")):
            v = num(r.get(f))
            if v:
                o[key] = v
        if s(r.get("DocumentStageDesc")):
            o["stage"] = s(r.get("DocumentStageDesc"))
        for key, f in (("submitted", "DateSubmitted"), ("executed", "ExecutionDate"), ("rentCommencement", "AnticipatedRentCommencementDate")):
            if iso_day(r.get(f)):
                o[key] = iso_day(r.get(f))
        out.append(o)
    return out


def closed_period(as_of):
    """The last COMPLETED month (the current month's financials are partial)."""
    return add_months(as_of[:4] + as_of[5:7], -1)


def build(state, calls, as_of, fin_period=None, force=False):
    """The delta payload + a per-deal report of what was included and why."""
    period = latest_period(calls)
    fin_period = fin_period or closed_period(as_of)
    deals, report = [], []
    for d in state.get("deals") or []:
        bl = [nid(b) for b in d.get("bldgIds") or []]
        if not bl:
            continue
        p = {"dealId": d["dealId"], "bldgIds": d["bldgIds"]}
        notes = []
        if period and covered(calls, "Occupancy", bl):
            occ, am = build_occupancy(calls, bl, period)
            if occ:
                p.update(occ)
                if am:
                    p["assetManager"] = am
            else:
                notes.append(f"occupancy skipped: not every building has a {period} row")
        tenants = None
        if covered(calls, "TenantsMetrics", bl):
            tenants = build_tenants(calls, bl)
            if tenants:
                p["tenants"] = tenants
                if roster_hash(tenants) == ((d.get("tenants") or {}).get("hash")):
                    notes.append("rent roll unchanged (hash matches)")
            else:
                notes.append("TenantsMetrics returned no rows — rent roll not sent")
        if covered(calls, "VacantSuites", bl):
            p["vacantSuites"] = build_vacant(calls, bl)
        if covered(calls, "SalesHistory", bl):
            p["salesHistory"] = build_sales(calls, bl)
        if covered(calls, "TenantLedger", bl):
            # Former vs current: the fresh Tenants read when there is one, else the site's roster.
            cur = None
            if covered(calls, "Tenants", bl):
                cur = {str(r.get("TenantId") or "").strip(): ((s(r.get("OCCPSTAT")) or "C").upper()[:1]) for r in rows_for(calls, "Tenants", bl)}
                cur = {k: v for k, v in cur.items() if v != "I"}
            elif d.get("tenants", {}).get("ids"):
                cur = {t: "C" for t in d["tenants"]["ids"]}
            p["arAging"] = build_ar(calls, set(bl), as_of, cur)
        if covered(calls, "FinancialGroups", bl):
            if not force and (d.get("financials") or {}).get("period") == fin_period:
                notes.append(f"financials already at {fin_period} — not resent")
            else:
                fin = build_financials(calls, bl, fin_period)
                if fin:
                    p["financials"] = fin
                else:
                    notes.append(f"financials skipped: no NOI row for every building at {fin_period}")
        if covered(calls, "LeaseAppDealHistoryBySuite", bl):
            lease = build_leasing(calls, set(bl))
            if lease:
                p["leasing"] = lease
        blocks = [k for k in p if k not in ("dealId", "bldgIds")]
        if blocks:
            deals.append(p)
        report.append({"dealId": d["dealId"], "propertyName": d.get("propertyName"), "blocks": blocks, "notes": notes})
    payload = {"source": "datex", "asOf": as_of, "generatedBy": f"job_kit {KIT_VERSION}", "deals": deals}
    return payload, report


# ── plan: the minimum Datex calls, given what the site already has ──────────────
TM_FIELDS = ["BuildingId", "TenantId", "Tenant", "SUITID", "Period", "SuiteSQFT", "AnnualRent", "AnnualRentPSF", "AnnualNNN", "AnnualNNNPSF", "AnnualOther", "Delinquency", "LastSalesPeriod"]
TEN_FIELDS = ["BuildingId", "TenantId", "Tenant", "DBA", "NationalTenant", "OCCPSTAT", "BEGINDATE", "EXPIR", "COTENANT"]
OCC_FIELDS = ["BuildingId", "Period", "TotalGLA", "TotalGLAOccupied", "TotalGLAVacant", "TotalUnits", "TotalOccupiedUnits", "TotalVacantUnits", "AssetManager",
              "ShopGLA", "ShopOccupiedGLA", "MajorGLA", "MajorOccupiedGLA", "SubMajorGLA", "SubMajorOccupiedGLA", "PadGLA", "PadOccupiedGLA", "GroundLeaseGLA", "GroundLeaseOccupiedGLA"]


def F(field, op, value):
    return {"field": field, "operator": op, "value": value}


def plan(state, calls, as_of, mode="weekly"):
    """Phase 1 (no Occupancy yet): the one Occupancy call. Phase 2: everything else, sized to
    what changed. Each entry is ready to pass to the Datex MCP tool as-is."""
    out = []

    def add(tool, why, **args):
        out.append({"tool": tool, "why": why, "args": args})

    period = latest_period(calls or [])
    if not period:
        add("read_records", "Occupancy for every building at the latest period (one call; the newest period sorts first)",
            entity="Occupancy", select=OCC_FIELDS, orderBy=[{"field": "Period", "direction": "desc"}, {"field": "BuildingId", "direction": "asc"}], first=100)
        return {"phase": 1, "calls": out, "notes": ["Make this call, extract, then run plan again with --calls."]}

    deals = [d for d in state.get("deals") or [] if d.get("bldgIds")]
    roster, notes = [], []
    for d in deals:
        bl = [nid(b) for b in d["bldgIds"]]
        occ, _ = build_occupancy(calls, bl, period)
        st = d.get("occupancy") or {}
        moved = occ is None or any(num(occ.get(k)) != num(st.get(k)) for k in ("totalGLA", "occupiedGLA", "occupiedUnits"))
        if mode == "monthly" or not d.get("hasSnapshot") or not (d.get("tenants") or {}).get("count") or moved:
            roster.append(d)
    notes.append(f"latest period {period}; rent roll re-pull for {len(roster)} of {len(deals)} properties ({'monthly: all' if mode == 'monthly' else 'occupancy moved or no stored roll'})")
    for d in roster:
        for b in d["bldgIds"]:
            bid = nid(b)
            add("read_records", f"{d.get('propertyName') or d['dealId']}: rent roll at {period}", entity="TenantsMetrics",
                filters=[F("BuildingId", "contains", bid), F("Period", "eq", period)], select=TM_FIELDS, first=100)
            add("read_records", f"{d.get('propertyName') or d['dealId']}: OCCPSTAT, dates, co-tenancy", entity="Tenants",
                filters=[F("BuildingId", "contains", bid), F("OCCPSTAT", "ne", "I")], select=TEN_FIELDS, first=100)
            add("read_records", f"{d.get('propertyName') or d['dealId']}: vacant suites", entity="VacantSuites", filters=[F("BLDGID", "contains", bid)], first=100)
            add("read_records", f"{d.get('propertyName') or d['dealId']}: suite square feet (for vacant suites)", entity="Spaces",
                filters=[F("BLDGID", "contains", bid)], select=["BLDGID", "SUITID", "SUITSQFT"], first=100)

    # Sales: monthly, plus any property with no monthly history stored yet. SalesPeriod is a
    # text field (no 'gt'), so filter by year and let the site upsert.
    for d in deals:
        sl = d.get("sales") or {}
        first_run = not sl.get("storedMonthlyRows")
        if mode != "monthly" and not first_run:
            continue
        since = add_months(period, -24) if first_run or not sl.get("maxPeriod") else add_months(sl["maxPeriod"], -3)
        for b in d["bldgIds"]:
            for y in range(int(since[:4]), int(period[:4]) + 1):
                add("read_records", f"{d.get('propertyName') or d['dealId']}: sales {y}{' (first run: 24 months)' if first_run else ''}", entity="SalesHistory",
                    filters=[F("BuildingId", "contains", nid(b)), F("SalesType", "contains", "GROSS"), F("SalesPeriod", "startsWith", str(y))],
                    select=["BuildingId", "TenantId", "SalesType", "ReportingType", "SalesPeriod", "SalesAmount"], first=100)

    # A/R: three portfolio-wide aggregates (total / over 60 / over 90 days).
    d60 = (dt.date.fromisoformat(as_of) - dt.timedelta(days=60)).isoformat()
    d90 = (dt.date.fromisoformat(as_of) - dt.timedelta(days=90)).isoformat()
    for label, extra in (("total open", []), ("over 60 days", [F("TransactionDate", "le", d60)]), ("over 90 days", [F("TransactionDate", "le", d90)])):
        add("aggregate_records", f"A/R {label}, every building", entity="TenantLedger", function="sum", field="TransactionOpenAmount",
            groupBy=["BuildingId", "TenantId", "TenantFlags"], filters=[F("TransactionOpenAmount", "gt", 0)] + extra, first=100)

    fp = closed_period(as_of)
    if mode == "monthly" or any((d.get("financials") or {}).get("period") != fp for d in deals):
        add("read_records", f"NOI for {fp} (last closed month), every building", entity="FinancialGroups",
            filters=[F("Period", "eq", fp), F("AccountGroupId", "contains", "NOI")],
            select=["EntityID", "Period", "Basis", "AccountGroupId", "Actual", "YtdActual", "YtdBudget", "CurrentYearBudget", "TwelveMoActual"], first=100)
    else:
        notes.append(f"financials already at {fp} everywhere — skipped")

    subs = [(d.get("leasing") or {}).get("latestSubmitted") for d in deals]
    year_ago = (dt.date.fromisoformat(as_of) - dt.timedelta(days=365)).isoformat()
    since = min([x for x in subs if x] or [year_ago]) if all(subs) else year_ago
    add("read_records", f"leasing applications submitted since {since}, every building", entity="LeaseAppDealHistoryBySuite",
        filters=[F("DateSubmitted", "ge", since)], orderBy=[{"field": "DateSubmitted", "direction": "desc"}],
        select=["BldgId", "DBA", "LegalName", "SuiteId", "ProposedGLA", "ProposedRentInitialPSFRent", "DocumentStageDesc", "DateSubmitted", "ExecutionDate", "AnticipatedRentCommencementDate", "LeaseTermTotalMonths"], first=100)
    notes.append("Any call that returns hasMore:true — call it again with after=<nextCursor> until hasMore is false.")
    return {"phase": 2, "period": period, "calls": out, "notes": notes}


# ── HTTP ───────────────────────────────────────────────────────────────────────
def _ctx():
    for p in (os.environ.get("SSL_CERT_FILE"), os.environ.get("REQUESTS_CA_BUNDLE"), "/root/.ccr/ca-bundle.crt"):
        if p and os.path.exists(p):
            return ssl.create_default_context(cafile=p)
    return ssl.create_default_context()


def http(method, path, token, base, body=None):
    req = urllib.request.Request(base.rstrip("/") + path, method=method, data=json.dumps(body).encode("utf-8") if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": f"kpr-job-kit/{KIT_VERSION}"})
    try:
        with urllib.request.urlopen(req, context=_ctx(), timeout=120) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"error": str(e)}


def _token(a):
    t = a.token or os.environ.get("DATEX_INGEST_TOKEN")
    if not t:
        sys.exit("Set DATEX_INGEST_TOKEN (or pass --token).")
    return t


def main(argv=None):
    ap = argparse.ArgumentParser(description="KPR Datex auto-refresh job kit")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("state", "post"):
        sp = sub.add_parser(name)
        sp.add_argument("--token")
        sp.add_argument("--base", default=DEFAULT_BASE)
        if name == "state":
            sp.add_argument("--out", default="state.json")
        else:
            sp.add_argument("--payload", default="payload.json")
            sp.add_argument("--dry-run", action="store_true")
    ex = sub.add_parser("extract")
    ex.add_argument("--transcript", required=True, help="session transcript .jsonl (a glob is fine)")
    ex.add_argument("--out", default="calls.jsonl")
    pl = sub.add_parser("plan")
    pl.add_argument("--state", required=True)
    pl.add_argument("--calls")
    pl.add_argument("--mode", choices=["weekly", "monthly"], default="weekly")
    pl.add_argument("--as-of", default=dt.date.today().isoformat())
    bd = sub.add_parser("build")
    bd.add_argument("--state", required=True)
    bd.add_argument("--calls", required=True)
    bd.add_argument("--out", default="payload.json")
    bd.add_argument("--as-of", default=dt.date.today().isoformat())
    bd.add_argument("--fin-period", help="YYYYMM; default = last closed month")
    bd.add_argument("--force", action="store_true", help="resend financials even if the site already has that period")
    a = ap.parse_args(argv)

    if a.cmd == "state":
        code, data = http("GET", "/api/datex/state", _token(a), a.base)
        if code != 200:
            sys.exit(f"state failed ({code}): {data}")
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=1)
        print(f"wrote {a.out}: {len(data.get('deals') or [])} properties")
    elif a.cmd == "extract":
        paths = sorted(glob.glob(a.transcript)) or [a.transcript]
        calls = [c for p in paths for c in extract_calls(p)]
        with open(a.out, "w", encoding="utf-8") as fh:
            for c in calls:
                fh.write(json.dumps(c) + "\n")
        by = {}
        for c in calls:
            by[c["entity"]] = by.get(c["entity"], 0) + len(c["rows"])
        print(f"wrote {a.out}: {len(calls)} calls · " + ", ".join(f"{k} {v} rows" for k, v in sorted(by.items())))
    elif a.cmd == "plan":
        st = json.load(open(a.state, encoding="utf-8"))
        calls = load_calls(a.calls) if a.calls and os.path.exists(a.calls) else []
        p = plan(st, calls, a.as_of, a.mode)
        print(json.dumps(p, indent=1))
    elif a.cmd == "build":
        st = json.load(open(a.state, encoding="utf-8"))
        payload, report = build(st, load_calls(a.calls), a.as_of, a.fin_period, a.force)
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=1)
        for r in report:
            print(f"{r['propertyName'] or r['dealId']}: {', '.join(r['blocks']) or 'nothing to send'}" + (f"  ({'; '.join(r['notes'])})" if r["notes"] else ""))
        print(f"wrote {a.out}: {len(payload['deals'])} properties with changes")
    elif a.cmd == "post":
        payload = json.load(open(a.payload, encoding="utf-8"))
        code, data = http("POST", "/api/datex/ingest" + ("?dryRun=1" if a.dry_run else ""), _token(a), a.base, payload)
        print(json.dumps(data, indent=1))
        if code != 200:
            sys.exit(f"ingest failed ({code})")


if __name__ == "__main__":
    main()
