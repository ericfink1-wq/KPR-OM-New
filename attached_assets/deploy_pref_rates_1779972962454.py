#!/usr/bin/env python3
"""
KPR Pref Equity Rate Fields — one-click deploy
Upload to Replit root, then paste into Agent:
  Read deploy_pref_rates.py and run it in the shell.
"""
import os

BASE = os.path.dirname(os.path.abspath(__file__))

def patch(path, old, new, label):
    full = os.path.join(BASE, path)
    try:
        with open(full, encoding="utf-8") as f: content = f.read()
    except FileNotFoundError:
        print(f"  MISS {label}"); return
    if old not in content:
        print(f"  SKIP {label} — already applied"); return
    with open(full, "w", encoding="utf-8") as f: f.write(content.replace(old, new, 1))
    print(f"  OK   {label}")

print("\n=== KPR Pref Equity Rate Fields ===\n")

print("1/3  lib/idb.ts")
patch("artifacts/om-database/src/lib/idb.ts",
  '  prefRate?: number | null;',
  '  prefRateCurrent?: number | null;  // current pay rate e.g. 8.0\n  prefRateAllIn?: number | null;    // all-in / catch-up rate at sale/refi e.g. 9.25',
  "split prefRate into prefRateCurrent + prefRateAllIn")

print("2/3  api-server/src/routes/deals.ts")
patch("artifacts/api-server/src/routes/deals.ts",
  '"prefRate",',
  '"prefRateCurrent", "prefRateAllIn",',
  "update pref rate keys in USER_PRESERVED_KEYS")

print("3/3  DetailView.tsx")
patch("artifacts/om-database/src/components/DetailView.tsx",
  '{f({ label:"Pref Rate / Return", field:"prefRate", placeholder:"e.g. 12.0", suffix:"%" })}',
  '{f({ label:"Current Pay Rate", field:"prefRateCurrent", placeholder:"e.g. 8.0", suffix:"%" })}\n              {f({ label:"All-In Rate (at sale/refi)", field:"prefRateAllIn", placeholder:"e.g. 9.25", suffix:"%" })}',
  "split pref rate into current pay + all-in fields")

print("\n=== Done! ===")
print("Current Pay Rate = what is paid now (e.g. 8%).")
print("All-In Rate = total return including accrual caught up at exit (e.g. 9.25%).")
