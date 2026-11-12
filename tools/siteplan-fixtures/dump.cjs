// Per-page text dump for site-plan research: node dump.cjs <pdf> <out.json>
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const fs = require("fs");
(async () => {
  const [, , inp, out] = process.argv;
  const data = new Uint8Array(fs.readFileSync(inp));
  const pdf = await pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    try {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const ops = await page.getOperatorList();
      let images = 0;
      for (const fn of ops.fnArray) if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintJpegXObject) images++;
      const vp = page.getViewport({ scale: 1 });
      // text items with position: the top-of-page text (largest y) is what a reader sees as the title
      const items = content.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), h: Math.round(Math.abs(i.transform[3])) }));
      pages.push({ page: p, text: content.items.map(i => i.str).join(" "), itemCount: content.items.length, images, paths: ops.fnArray.length, w: Math.round(vp.width), h: Math.round(vp.height), items });
    } catch (e) { pages.push({ page: p, error: String(e) }); }
  }
  fs.writeFileSync(out, JSON.stringify({ file: inp, numPages: pdf.numPages, pages }));
  console.log(inp, pdf.numPages);
})().catch(e => { console.error(e); process.exit(1); });
