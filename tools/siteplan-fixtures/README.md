# Site-plan picker fixtures

`artifacts/om-database/src/lib/__tests__/pickSitePlanReal.test.ts` runs the site-plan picker
(`pickSitePlanPages`, lib/pdfExtract.ts) on real OMs. The fixtures hold LAYOUT FEATURES ONLY:
no OM prose or figures go in the repo, which is public.

To add an OM, run these from a scratch folder, not the repo:

    npm i pdfjs-dist@3.11.174
    node dump.cjs <om.pdf> dumps/<Name>.json          # per-page text + type sizes
    python3 -I sanitize.py dumps <repo>/artifacts/om-database/src/lib/__tests__/fixtures/siteplan-oms

Then look at the PDF yourself and add `[<Name>, [[true pages]], "why"]` to `TRUTH` in the test.
Every acceptable answer is a set of PDF page numbers (a spread, Phase I/II), or `[]` when the
book has no site plan.
