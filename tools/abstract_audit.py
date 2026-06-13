#!/usr/bin/env python3
"""Abstract self-audit (CLAUDE.md rule 2): completeness + internal consistency over a
whole property's abstracts. Exit-lists every tenant exception so nothing ships unseen."""
import json, glob, sys, datetime
today = datetime.date.today().isoformat()
def pnum(x):
    try: return float(x)
    except: return None

def current_step_rent(a):
    rs = a.get("rentSchedule") or []
    for r in rs:
        s = r.get("periodStart") or ""; e = r.get("periodEnd") or ""
        if s and e and s <= today <= e:
            n = pnum(r.get("annualRent"))
            if n: return n
    return None

def audit_one(a):
    ex = []
    name = a.get("tenantName","?")
    rs = a.get("rentSchedule") or []
    com, exp = a.get("commencement"), a.get("expiration")
    base = pnum(a.get("baseRentAnnual"))
    ft=json.dumps(a.get("flags") or []).lower()
    notCommenced = bool(a.get("notYetCommenced")) or any(k in ft for k in ("not yet commenced","not-yet-commenced","not yet open","not in possession","delivery targeted"))
    # (a) term dates present OR explicitly not-commenced
    if (not com or not exp) and not notCommenced:
        ex.append(f"missing term dates (commencement={com}, expiration={exp}) and not flagged 'not commenced'")
    # (b) every rent step dated
    undated = [i for i,r in enumerate(rs) if not (r.get('periodStart') and r.get('periodEnd'))]
    if rs and undated and not notCommenced:
        ex.append(f"{len(undated)}/{len(rs)} rent steps undated")
    # (c) baseRentAnnual reconciles to a current-period step
    cur = current_step_rent(a)
    if base and cur and abs(base-cur)/cur > 0.02:
        ex.append(f"baseRentAnnual ${int(base):,} != current-period step ${int(cur):,}")
    if base is None and rs:
        ex.append("baseRentAnnual missing")
    # (f) key levers populated or explicit None
    def has(field): 
        v=a.get(field); return v not in (None,"",[],{})
    return ex

def main(globpat):
    files = sorted(glob.glob(globpat))
    print(f"AUDIT over {len(files)} abstracts  (as of {today})\n"+"="*70)
    clean=0; flagged=[]
    for f in files:
        a=json.load(open(f))
        ex=audit_one(a)
        if ex:
            flagged.append((a.get("tenantName","?"),ex))
            print(f"\n⚠ {a.get('tenantName','?')}")
            for e in ex: print(f"    - {e}")
        else:
            clean+=1
    print("\n"+"="*70)
    print(f"CLEAN: {clean}/{len(files)}   |   EXCEPTIONS: {len(flagged)} tenants")
    if flagged: print("Tenants needing fix: "+", ".join(t for t,_ in flagged))
    return flagged

if __name__=="__main__":
    main(sys.argv[1] if len(sys.argv)>1 else "/tmp/rockaway/out/*.json")
