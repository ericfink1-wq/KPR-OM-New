"""Unit tests for job_kit.py — run with:  python3 -m unittest discover -s tools/datex-job-kit
The fixture (fixtures/state.json + calls.jsonl) is shaped like real Datex output: fixed-width
ids with trailing spaces, duplicate $0 rows, dotted generation ids, Basis 'C', a vacated anchor
still carrying A/R, and a three-building property (Rockaway) that must be summed."""
import json
import os
import tempfile
import unittest

import job_kit as K

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")
AS_OF = "2026-10-18"


def load():
    with open(os.path.join(FIX, "state.json"), encoding="utf-8") as fh:
        state = json.load(fh)
    return state, K.load_calls(os.path.join(FIX, "calls.jsonl"))


class BuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state, cls.calls = load()
        cls.payload, cls.report = K.build(cls.state, cls.calls, AS_OF)
        cls.deals = {d["dealId"]: d for d in cls.payload["deals"]}

    def test_payload_shape(self):
        self.assertEqual(self.payload["source"], "datex")
        self.assertEqual(self.payload["asOf"], AS_OF)
        self.assertEqual(set(self.deals), {"d-cooks", "d-rock"})       # Providence has no buildings → nothing

    def test_occupancy_pins_latest_period_and_sums_buildings(self):
        c, r = self.deals["d-cooks"], self.deals["d-rock"]
        self.assertEqual(c["period"], "202610")
        self.assertEqual(c["occupiedGLA"], 205900)                       # not the 202609 row
        self.assertEqual(c["assetManager"], "Jon Smith")                 # fixed-width padding trimmed
        self.assertEqual((r["totalGLA"], r["occupiedGLA"], r["totalUnits"], r["occupiedUnits"]), (600000, 540000, 60, 54))
        self.assertEqual(r["bldgIds"], ["rockcom", "rockcrt", "rockplz"])

    def test_tenants_occpstat_rules(self):
        t = {x["tenantId"]: x for x in self.deals["d-cooks"]["tenants"]}
        self.assertNotIn("t0000009", t)                                  # Big Lots: not in Tenants(OCCPSTAT ne I) → vacated
        self.assertNotIn("t0000070.2.70", t)                             # dotted id, no status → superseded generation
        self.assertIn("t0000062.1.30", t)                                # dotted id but OCCPSTAT C → a live lease
        self.assertEqual(t["t0000005"]["occStatus"], "N")                # signed, not open
        k = t["t0000001"]
        self.assertEqual(k["annualRent"], 540000)                        # the $0 duplicate row lost
        self.assertEqual((k["name"], k["suite"], k["leaseStart"], k["leaseExpiry"]), ("Kroger", "A", "2001-03-01", "2031-02-28"))
        self.assertTrue(t["t0000062.1.30"]["coTenancy"])
        self.assertNotIn("coTenancy", t["t0000002"])                     # "N" is not a co-tenancy flag
        self.assertNotIn("leaseStart", t["t0000002"])                    # 1900 sentinel date = unknown
        self.assertNotIn("tenants", self.deals["d-rock"])                # rent roll not fetched → not sent (kept on the site)

    def test_vacant_suites_get_square_feet(self):
        self.assertEqual(self.deals["d-cooks"]["vacantSuites"], [{"suite": "B-2", "sf": 1400}, {"suite": "E", "sf": 22000}])

    def test_sales_drop_tiny_and_sentinel_rows(self):
        s = self.deals["d-cooks"]["salesHistory"]
        self.assertEqual(sorted((x["tenantId"], x["period"], x["amount"]) for x in s), [("t0000001", "202607", 2400000), ("t0000001", "202609", 2500000)])
        self.assertTrue(all(x["reportingType"] == "RPT" for x in s))

    def test_ar_buckets_and_former_tenants(self):
        a = self.deals["d-cooks"]["arAging"]
        self.assertEqual((a["totalOpen"], a["over60"], a["over90"]), (463000, 456400, 443200))
        by = {x["tenantId"]: x for x in a["byTenant"]}
        self.assertEqual(by["t0000009"]["occpstat"], "I")                # Big Lots' balance is a former tenant's
        self.assertEqual(by["t0000002"]["occpstat"], "C")
        self.assertLessEqual(a["over90"], a["over60"])
        r = self.deals["d-rock"]["arAging"]
        self.assertEqual((r["totalOpen"], r["over60"]), (12000, 0))      # academy's rows never leak in

    def test_financials(self):
        c, r = self.deals["d-cooks"]["financials"], self.deals["d-rock"]["financials"]
        self.assertEqual(c["period"], "202609")                          # last closed month, not the partial 202610
        self.assertEqual(c["basis"], "Cash")                             # Datex sends "C"
        self.assertEqual(c["noiTtmActual"], -250000 - 11 * 240000)       # 12 monthly actuals summed (raw sign)
        self.assertEqual(c["noiYtdActual"], -2200000)                    # the "Rent" group row is ignored
        self.assertEqual(r["noiTtmActual"], -1200000 - 1300000 - 900000) # no history → Datex TwelveMoActual
        self.assertEqual(r["noiYtdBudget"], -950000 - 1050000 - 720000)

    def test_financials_not_resent_when_site_has_the_period(self):
        st = json.loads(json.dumps(self.state))
        st["deals"][0]["financials"]["period"] = "202609"
        p, rep = K.build(st, self.calls, AS_OF)
        self.assertNotIn("financials", next(d for d in p["deals"] if d["dealId"] == "d-cooks"))
        self.assertTrue(any("not resent" in n for n in rep[0]["notes"]))

    def test_leasing_only_mapped_buildings(self):
        self.assertEqual([x["tenant"] for x in self.deals["d-cooks"]["leasing"]], ["Five Below"])
        self.assertEqual(self.deals["d-cooks"]["leasing"][0]["rentCommencement"], "2027-04-01")
        self.assertNotIn("leasing", self.deals["d-rock"])

    def test_delta_only_blocks_that_were_fetched(self):
        calls = [c for c in self.calls if c["entity"] == "Occupancy"]
        p, _ = K.build(self.state, calls, AS_OF)
        for d in p["deals"]:
            self.assertFalse({"tenants", "salesHistory", "arAging", "financials", "leasing", "vacantSuites"} & set(d))

    def test_roster_hash_matches_the_site(self):
        # Same vector the site's test pins (api-server datexJobKit.test.ts).
        self.assertEqual(K.roster_hash([{"tenantId": "t1", "sf": 60000, "annualRent": 540000.5, "leaseExpiry": "2031-02-28"}, {"tenantId": "t2", "sf": 1200.004}]), K.roster_hash([{"tenantId": "t2", "sf": 1200}, {"tenantId": "t1", "sf": 60000.0, "annualRent": 540000.50, "leaseExpiry": "2031-02-28T00:00:00Z"[:10]}]))
        self.assertEqual(K.js_num(60000.0), "60000")
        self.assertEqual(K.js_num(10.955), "10.96")
        self.assertEqual(K.js_num(1200.004), "1200")


class PlanTest(unittest.TestCase):
    def test_phase_one_is_a_single_occupancy_call(self):
        state, _ = load()
        p = K.plan(state, [], AS_OF)
        self.assertEqual((p["phase"], len(p["calls"])), (1, 1))
        self.assertEqual(p["calls"][0]["args"]["entity"], "Occupancy")

    def test_phase_two_rereads_only_moved_rolls(self):
        state, calls = load()
        p = K.plan(state, [c for c in calls if c["entity"] == "Occupancy"], AS_OF)
        tm = [c for c in p["calls"] if c["args"]["entity"] == "TenantsMetrics"]
        self.assertEqual([c["args"]["filters"][0]["value"] for c in tm], ["brunswic"])   # Rockaway didn't move
        self.assertEqual(tm[0]["args"]["filters"][1], {"field": "Period", "operator": "eq", "value": "202610"})
        # Period/SalesPeriod are text in Datex — no gt/ge filters on them anywhere.
        for c in p["calls"]:
            for f in c["args"].get("filters") or []:
                if f["field"] in ("Period", "SalesPeriod"):
                    self.assertIn(f["operator"], ("eq", "startsWith"))
        self.assertEqual(len([c for c in p["calls"] if c["args"]["entity"] == "TenantLedger"]), 3)

    def test_monthly_reads_every_roll_and_sales(self):
        state, calls = load()
        p = K.plan(state, [c for c in calls if c["entity"] == "Occupancy"], AS_OF, mode="monthly")
        bl = {c["args"]["filters"][0]["value"] for c in p["calls"] if c["args"]["entity"] == "TenantsMetrics"}
        self.assertEqual(bl, {"brunswic", "rockcom", "rockcrt", "rockplz"})
        self.assertTrue(any(c["args"]["entity"] == "SalesHistory" for c in p["calls"]))


class ExtractTest(unittest.TestCase):
    def test_transcript_extraction_incl_saved_file_and_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved = os.path.join(tmp, "mcp-Datex_MCP-read_records-1.txt")
            with open(saved, "w", encoding="utf-8") as fh:
                json.dump({"items": [{"BuildingId": "brunswic", "Period": "202610", "TotalGLA": 300386}], "hasMore": False}, fh)
            lines = [
                {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "a", "name": "mcp__Datex_MCP__read_records", "input": {"entity": "Occupancy", "first": 100}}]}},
                {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "a", "content": f"Error: result (85,029 characters) exceeds maximum allowed tokens. Output has been saved to {saved}.\nFormat: JSON"}]}},
                {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "b", "name": "mcp__Datex_MCP__aggregate_records", "input": {"entity": "TenantLedger", "function": "sum", "field": "TransactionOpenAmount", "filters": [{"field": "TransactionOpenAmount", "operator": "gt", "value": 0}]}}]}},
                {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "b", "content": [{"type": "text", "text": json.dumps({"results": [{"group": {"BuildingId": "brunswic", "TenantId": "t1"}, "value": 5}], "hasMore": False})}]}]}},
                {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "c", "name": "mcp__Datex_MCP__aggregate_records", "input": {"entity": "Tenants"}}]}},
                {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "c", "is_error": True, "content": "An error occurred"}]}},
                {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "d", "name": "mcp__KPR_OM_Data__get_deal", "input": {}}]}},
                {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "d", "content": "{\"items\": []}"}]}},
            ]
            tr = os.path.join(tmp, "session.jsonl")
            with open(tr, "w", encoding="utf-8") as fh:
                fh.write("\n".join(json.dumps(x) for x in lines) + "\nnot json\n")
            calls = K.extract_calls(tr)
        self.assertEqual([(c["entity"], c["tool"], len(c["rows"])) for c in calls], [("Occupancy", "read", 1), ("TenantLedger", "aggregate", 1)])
        self.assertEqual(calls[1]["rows"][0], {"BuildingId": "brunswic", "TenantId": "t1", "value": 5})


if __name__ == "__main__":
    unittest.main()
