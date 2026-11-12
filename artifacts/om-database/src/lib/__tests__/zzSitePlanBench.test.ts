import { it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { pickSitePlanPages, scoreSitePlanPage } from "../pdfExtract";
const TRUTH: Record<string, number[][]> = { BoltonPlaza:[[13]], CobblerCrossing_CBRE:[[13]], DarienTowneCenter_CBRE:[[16]], FredMeyerBend:[[11],[]], FrederickCountySquare_NMRK:[[10,11],[10]], LillyGardens:[[]], OverlandPlaza:[[13],[7]], PaddockShops:[[28]], ProjectEvergreen:[[]], ShopsAtCrossroads:[[13]], ShortPumpTownCenter_Eastdil:[[20],[22],[24],[22,24]], SunshinePlaza_2011:[[4]], TownNCountry_BCA:[[6]], TrussvillePromenade_JLL:[[9,10]], VillageSquare_CBRE:[[16]] };
it("bench", () => {
  const D = "/tmp/claude-0/-home-user-KPR-OM-New/086b3005-c4ea-5d04-b9d7-62d3f14dcaa5/scratchpad/sp-bench/dumps"; let ok = 0;
  for (const f of readdirSync(D)) {
    const j = JSON.parse(readFileSync(D + "/" + f, "utf8")); const k = f.replace(".json","");
    const pages = j.pages.filter((p: any) => p.page >= 2 && p.page <= 40 && p.text != null).map((p: any) => ({ page: p.page, text: p.text, itemCount: p.itemCount, items: p.items }));
    const got = pickSitePlanPages(pages);
    const good = TRUTH[k].some(t => JSON.stringify(t) === JSON.stringify(got)); if (good) ok++;
    const top = pages.map((p: any) => ({ p: p.page, ...scoreSitePlanPage(p) })).filter((x: any) => x.s > 0).sort((a: any, b: any) => b.s - a.s).slice(0, 3).map((x: any) => x.p + ":" + Math.round(x.s) + ":" + x.reason);
    console.log((good ? "OK  " : "MISS") + " " + k + " got " + JSON.stringify(got) + " want " + JSON.stringify(TRUTH[k][0]) + " | " + top.join(" ; "));
  }
  console.log("SCORE", ok, "/ 15");
});
