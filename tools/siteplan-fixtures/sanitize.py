import json, re, sys, os, glob
S, OUT = sys.argv[1], sys.argv[2]
KEEP = set("""site plan plans layout leasing map maps tenant tenants roster mix tenancy stacking suite ste unit space no no. sf gla rsf size sq ft square feet
available leased occupied vacant nap not a part opportunity opportunities roof hvac parcel redevelopment aerial trade area demographic demographics regional location
traffic zoning flood utility survey contents table of rent roll lease expiration report schedule cash flow operating statement income sales debt service argus
amortization floor level first second phase i ii property overview description summary offering investment highlights retail center plot key lease merchandising
competition competitive comparable legend the see below following on this page""".split())
def unspace(t): return re.sub(r'\b(?:[A-Za-z&] ){2,}[A-Za-z&]\b', lambda m: m.group(0).replace(' ', ''), t)
SF = re.compile(r'\b\d{1,3}(?:,\d{3})+\s*(?:SF|RSF|GLA)\b|\b\d{3,6}\s*SF\b', re.I)
def clean(t):
    t = unspace(t or '')
    t = SF.sub(' 1,000 SF ', t)
    out = []
    for w in re.findall(r"1,000 SF|[A-Za-z][A-Za-z.&']*|\d+", t):
        lw = w.lower().strip(".'")
        if w == '1,000 SF' or w.isdigit(): out.append(w if w == '1,000 SF' else '0')
        elif lw in KEEP or w.lower() in KEEP: out.append(w)
        elif w.lower() in ('siteplan','sitelayout','tenantroster','leasingplan','sitemap','floorplan'): out.append(w)
        else: out.append('w')
    return re.sub(r'\b(?:[w0] )+[w0]\b', 'w', ' '.join(out))
for f in sorted(glob.glob(S + '/*.json')):
    d = json.load(open(f)); pages = []
    for p in d['pages']:
        if p.get('text') is None or p['page'] > 40: continue
        its = [i for i in p.get('items', []) if i['s'].strip() and i['h'] > 0]
        sizes = sorted({round(i['h']) for i in its}, reverse=True)[:3]
        heads = [{'s': clean(i['s']), 'h': i['h']} for i in its if i['h'] >= 11 and round(i['h']) in sizes]
        pages.append({'page': p['page'], 'itemCount': p['itemCount'], 'text': clean(p['text']), 'items': heads})
    json.dump({'numPages': d['numPages'], 'pages': pages}, open(os.path.join(OUT, os.path.basename(f)), 'w'), separators=(',', ':'))
