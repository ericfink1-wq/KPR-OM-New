import openpyxl, json, sys, re, datetime
from copy import copy

TEMPLATE = "/tmp/slim_marsh.xlsx"
WRAP = 108

def wrap_lines(text, width=WRAP):
    text = re.sub(r"\s+", " ", str(text)).strip()
    out, line = [], ""
    for w in text.split(" "):
        if len(line) + len(w) + 1 > width and line:
            out.append(line); line = w
        else:
            line = (line + " " + w).strip()
    if line: out.append(line)
    return out or [""]

def fmtdate(v):
    if not v or v in ("Not Provided","Not provided"): return v or ""
    try: return datetime.datetime.strptime(v[:10], "%Y-%m-%d")
    except Exception: return v

def gen(abs_path, out_path):
    wb = openpyxl.load_workbook(TEMPLATE)
    ws = wb["Marshalls(r)"]
    a = json.load(open(abs_path))
    ws.title = (a["tenantName"] + ("(r)" if a.get("dba") else ""))[:31]

    def S(addr, val):
        for mr in ws.merged_cells.ranges:
            if addr in mr: addr = mr.coord.split(":")[0]; break
        ws[addr] = val
    def clearrange(rng):
        for row in ws[rng]:
            for c in row:
                try: c.value = None
                except Exception: pass

    # ---------- Header (mirrors C20/C22/I20/I22/B24 are formulas) ----------
    S("C2", a["tenantName"]); S("I2", a.get("dba",""))
    S("C4", a["center"]); S("G4", a.get("suite","")); S("I4", a.get("mriNumber","-"))
    S("C6", a["premisesGLA"])

    # ---------- Lease & Amendments ----------
    clearrange("B10:H16")
    docs = a.get("documents", [])
    rows = [10,11,12,14,16]
    for i,d in enumerate(docs[:5]):
        S(f"B{rows[i]}", f'{d["name"]} dated {d.get("date","")}'+ (f' — {d.get("description","")}' if d.get("description") else ""))

    # ---------- Lease Dates ----------
    dts = a["dates"]
    S("C30", fmtdate(dts["leaseDate"]["value"]))
    S("C31", dts.get("openDate",{}).get("value",""))
    S("C32", fmtdate(dts["leaseCommencement"]["value"]))
    S("C33", dts.get("cancelDate",{}).get("value",""))
    S("C35", fmtdate(a["expiration"]))
    S("C36", fmtdate(dts["rentStartDate"]["value"]))
    sd = a.get("securityDeposit",{})
    S("I35", sd.get("value","None") if isinstance(sd,dict) else "None")

    # ---------- Notice (Legal block; clear Copy/Billing) ----------
    clearrange("C41:I59")
    na = (a.get("noticeAddresses") or [{}])[0]
    S("C40","Legal")
    S("C41", na.get("name","")); S("C42", na.get("attn","")); S("C43", na.get("address1",""))
    S("C45", na.get("city","")); S("G45", na.get("state","")); S("I45", na.get("zip",""))
    # blank the 2nd/3rd block labels' values (keep labels)
    clearrange("C47:I59")
    S("C47",""); 

    # ---------- Options table (4 rows r67-70) ----------
    clearrange("A67:K74")
    opts = a.get("options", [])
    orows=[67,68,69,70]
    for i,o in enumerate(opts[:4]):
        r=orows[i]
        S(f"A{r}", o.get("number")); S(f"B{r}", fmtdate(o.get("windowStart","")))
        S(f"C{r}", o.get("optionType","REN")); S(f"D{r}", fmtdate(o.get("noticeDate","")) or "Automatic")
        # E/F are formulas =+G4/=+C6 in template; re-assert
        S(f"E{r}", "=+G4"); S(f"F{r}", "=+C6")
    onote = a.get("optionNotes","")
    if onote:
        S("B72","Option Notes:")
        for i,ln in enumerate(wrap_lines(onote)[:6]): S(f"D{72+i}", ln)

    # ---------- Billing - Recurring Charges (E=annual; D,G formulas) ----------
    clearrange("A80:K93")
    rs = a.get("rentSchedule", [])
    brows = [80,81,84,86,88,90]
    optlabel = {2:"Option 1",3:"Option 2",4:"Option 3",5:"Option 4"}
    for i,step in enumerate(rs[:6]):
        r=brows[i]
        if i>=2: S(f"A{r-1}", optlabel.get(i, f"Option {i-1}"))
        S(f"A{r}", step.get("incomeCategory","RNT"))
        S(f"B{r}", fmtdate(step.get("periodStart",""))); S(f"C{r}", fmtdate(step.get("periodEnd","")))
        S(f"E{r}", step.get("annualRent",""))
        S(f"D{r}", f"=E{r}/C6"); S(f"G{r}", f"=E{r}/12")

    # ---------- Percentage Rent ----------
    pr = a.get("percentageRent",{})
    prval = (pr.get("value","") if isinstance(pr,dict) else str(pr))
    has_pct = "none" not in prval.lower()[:12]
    # clear Marshalls-specific percentage-rent data (citations, reporting window, sales year end)
    for ad in ["G95","G110","F97","C107","D107","G107","E97_keep"]:
        if ad.endswith("_keep"): continue
        try:
            for mr in ws.merged_cells.ranges:
                if ad in mr: ad=mr.coord.split(":")[0]; break
            ws[ad]=None
        except Exception: pass
    S("A105", f"Use Natural Breakpoint: {'Yes' if pr.get('naturalBreakpoint') else ('No' if not has_pct else 'See Notes')}")
    clearrange("A131:K136")
    if has_pct and pr.get("naturalBreakpoint"):
        for i,step in enumerate(rs[:6]):
            r=131+i
            S(f"A{r}", fmtdate(step.get("periodStart",""))); S(f"B{r}", 0.02)
            S(f"C{r}", f"=E{brows[i]}/B{r}")

    # ---------- Lease Notes (rebuild generically from r142) ----------
    for mr in list(ws.merged_cells.ranges):
        if mr.min_row >= 142:
            ws.unmerge_cells(str(mr))
    clearrange("A142:K464")
    refB, refC, refE, refA = ws["B147"], ws["C147"], ws["E147"], ws["A147"]
    catmap = {"SECDEP":"(Security Deposit)","USE":"(Use Clause)","RADIUS":"(Radius)","LL RADIUS":"(Radius)",
      "EXCLUSI":"(Exclusive Use)","COTENCY":"(Co-tenancy)","KICKLL":"(Kickout/Termination)","KICKTN":"(Kickout/Termination)",
      "NBNC":"(LL Restrictions)","TRSTR":"(Tenant Restrictions)","CAM":"(CAM Method)","RETX":"(Tax Method)","INS":"(Insurance Method)",
      "ASSNSUB":"(Assignment & Sublet)","ALTERTN":"(Alteration Notes)","OPC":"(Operating Covenant)","GO DARK":"(Go Dark Option)",
      "LATECHG":"(Late Fee Notes)","DEFAULT":"(Default)","GUARANT":"(Guaranty)","OTPRCL":"(Outparcel Restrictions)",
      "PURCHSE":"(Purchase Option)","DUES":"(Merchant's Association)","HOLDOVR":"(Holdover)","PYLON":"(Pylon Sign)",
      "ESTOPPEL":"(Estoppel)","SUBORD":"(Subordination)","RELOCAT":"(Relocation)","UTILITY":"(Utilities)","HVAC":"(HVAC)"}
    def setstyle(dstcell, refcell):
        dstcell._style = copy(refcell._style)
    r = 142
    for n in a.get("leaseNotes", []):
        code = n.get("code",""); val = n.get("value",""); cite = n.get("cite",{}) or {}
        secref = (cite.get("section") or "")
        bc = ws.cell(row=r, column=2); setstyle(bc, refB); bc.value = code
        cc = ws.cell(row=r, column=3); setstyle(cc, refC); cc.value = catmap.get(code, n.get("label",""))
        ac = ws.cell(row=r, column=1); setstyle(ac, refA); ac.value = secref[:20]
        for li, ln in enumerate(wrap_lines(val)):
            ec = ws.cell(row=r+li, column=5); setstyle(ec, refE); ec.value = ln
        r += max(1, len(wrap_lines(val))) + 1   # blank spacer row between notes

    wb.save(out_path)
    return ws.title, r

title, lastrow = gen(sys.argv[1], sys.argv[2])
print(f"generated '{title}' -> {sys.argv[2]} (notes end ~row {lastrow})")
