---
name: PDF image extraction
description: How cover photos and site plans are extracted from PDF files in the browser.
---

Source of truth: `artifacts/om-database/src/lib/pdfExtract.ts`

## Cover photo — _capturePagePhoto
Uses **PDF.js operator list** to extract the largest embedded image (the actual property photo) rather than screenshotting the page. This strips broker logos and text overlaid on top.

Algorithm:
1. Render page to canvas as fallback
2. Walk the operator list tracking the transform matrix (save/restore/transform ops)
3. Collect all paintImageXObject / paintJpegXObject ops with their center-x position
4. For "left"/"right" half mode: filter images by which half of the page they sit on
5. Pick the largest image by pixel area (w × h)
6. Extract via `page.objs.get(name)` — handles ImageBitmap, RGB_24BPP (kind=2), RGBA_32BPP (kind=3)
7. Minimum size: 560×360 (full) or 360×240 (half) — else fall back to page render
8. Scale to 1200px wide (0.74q) for cover, 168px (0.5q) for thumb via _scaleCanvas

## Site plan — extractPdfImages
Uses keyword scanning on per-page text content:
- **Strong keywords** (score 2): site plan, site map, leasing plan/map, site layout, plot plan, lease plan, overall plan, parcel map, tax parcel, key plan
- **Weak keywords** (score 1): aerial, site aerial, asset overview
- Sorts matches by score (descending), then page number
- Renders top 3 matches using `_renderPdfPage` at 1500px width (0.74q)
- If NO site plan found: renders page thumbnails 1–24 at 900px (0.6q) for manual picker → `needsSitePlanPick: true`

## Text extraction — extractPdfText
Position-aware line assembly (handles InDesign PDFs where each character is a separate item):
1. Group items by rounded Y position
2. Sort each line's items by X position
3. Detect word gaps: gap > 0.6× average character width → insert space; smaller gap → concatenate
4. Truncates output at 180K chars (120K front + 40K tail)

**Why:** The original om-database.jsx used the same embedded-image approach because broker OMs often layer logos and text on top of the property photo, so a page screenshot captures all that noise.
