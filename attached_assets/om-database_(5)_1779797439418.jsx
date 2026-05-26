import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "om_deals_v4";

// ── Deal storage: IndexedDB (holds hundreds of MB) with localStorage migration ──
// localStorage caps at ~5MB which overflows with hundreds of rich deals.
function _dealDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open("kpr_deals_db", 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("deals")) db.createObjectStore("deals");
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources");
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
// Per-deal images (cover photo + site plan), stored apart from the deal so they
// never enter the deals list, the AI prompt, or exports unless explicitly loaded.
async function idbSaveImages(id, payload) {
  const db = await _dealDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").put(payload, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error || new Error("image write failed"));
  });
}
async function idbLoadImages(id) {
  const db = await _dealDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("images", "readonly");
    const r = tx.objectStore("images").get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function idbDeleteImages(id) {
  try {
    const db = await _dealDB();
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").delete(id);
  } catch {}
}
// Per-deal source text (the extracted OM text) so we can re-analyze on schema
// changes without re-uploading. Kept in a separate store to keep the deals
// list (and the AI prompt) lean.
async function idbSaveSource(id, payload) {
  const db = await _dealDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("sources", "readwrite");
    tx.objectStore("sources").put(payload, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error || new Error("source write failed"));
  });
}
async function idbLoadSource(id) {
  const db = await _dealDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("sources", "readonly");
    const r = tx.objectStore("sources").get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function idbDeleteSource(id) {
  try {
    const db = await _dealDB();
    const tx = db.transaction("sources", "readwrite");
    tx.objectStore("sources").delete(id);
  } catch {}
}
async function idbHasSource(id) {
  try { return !!(await idbLoadSource(id)); } catch { return false; }
}
async function idbLoadDeals() {
  const db = await _dealDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("deals", "readonly");
    const r = tx.objectStore("deals").get("all");
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function idbSaveDeals(deals) {
  const db = await _dealDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("deals", "readwrite");
    tx.objectStore("deals").put(deals, "all");
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error || new Error("IndexedDB write failed"));
  });
}

const ASSET_TYPES = ["All","Retail","Office","Industrial","Multifamily","Mixed-Use","NNN","Other"];
const STATUS_OPTS = ["Prospect","Under Contract","Owned","Sold","Passed"];
const CENTER_TYPES = ["All","Grocery-Anchored","Power Center","Neighborhood Center","Community Center","Lifestyle Center","Regional Mall","Super-Regional Mall","Outlet Center","Strip/Unanchored","Single-Tenant NNN","Mixed-Use","Other"];
const URBANICITY = ["All","Urban","Suburban","Exurban","Rural"];
const STATUS_COLORS = { "Prospect":"#7d766a","Under Contract":"#d9890c","Owned":"#6dba43","Sold":"#0d9488","Passed":"#a69e91" };
// Map any legacy status value to the current set.
const _STATUS_MIGRATE = { Prospect:"Prospect", Active:"Prospect", LOI:"Under Contract", "Under Contract":"Under Contract", Closed:"Owned", Owned:"Owned", Sold:"Sold", Pass:"Passed", Passed:"Passed", Archived:"Passed" };
// A deal sitting as "Prospect" this long auto-shifts to "Passed".
const PROSPECT_STALE_DAYS = 122; // ~4 months
// Normalize legacy statuses and auto-pass stale prospects. Returns {deals, changed}.
function migrateAndAutoPass(list) {
  const now = Date.now();
  let changed = false;
  const deals = (list || []).map(d => {
    let next = d;
    const mapped = _STATUS_MIGRATE[d.status] || (d.status || "Prospect");
    if (mapped !== d.status) { next = { ...next, status: mapped }; changed = true; }
    if (!next.deleted && next.status === "Prospect") {
      const since = next.statusSince || next.uploadedAt;
      const sinceMs = since ? new Date(since).getTime() : null;
      if (sinceMs && (now - sinceMs) >= PROSPECT_STALE_DAYS * 86400000) {
        const ts = new Date().toISOString();
        next = { ...next, status: "Passed", autoPassed: true, autoPassedAt: ts, statusSince: ts,
          editHistory: [...(next.editHistory || []), { ts, by: "Auto (stale prospect)", changes: [{ field: "status", from: "Prospect", to: "Passed" }] }] };
        changed = true;
      }
    }
    return next;
  });
  return { deals, changed };
}
const GRADE_COLORS = { "A+":"#0f9d63","A":"#0f9d63","B+":"#16a34a","B":"#383a37","C+":"#52554e","C":"#52554e","D":"#dc2626" };

// Human-entered / looked-up fields: preserved when a deal is refreshed from a re-uploaded
// OM, and absorbed (fill-in-the-blanks) when merging true-duplicate deals.
const USER_DATA_FIELDS = ["status","statusSince","autoPassed","autoPassedAt","userNotes","marketSale","marketDemographics","txnPurchasePrice","txnSeller","txnLoiDate","txnCloseDate","txnSalePrice","txnBuyer","txnSaleDate","txnBroker","dispExitCap","dispCosts","dispLoanPayoff","dispNotes","acqCapRate","acqNOIAtClose","acqEntity","acqBroker","acqContractDate","acqDDExpiration","acqDeposit","acqClosingCosts","acqFee","acqTitleCo","acqCounsel","acqPropManager","acqStrategy","acqHoldPeriod","acqTargetIRR","acqNotes","debtLender","debtType","debtLoanAmount","debtRate","debtRateType","debtIndex","debtSpread","debtOriginationDate","debtMaturityDate","debtTermYears","debtAmortYears","debtIOPeriod","debtLTV","debtDSCR","debtRecourse","debtPrepay","debtExtensions","debtEscrows","debtAssumable","debtLoanNumber","debtContact","debtNotes"];

// Fields the analyst's edits should coerce to numbers when it returns a numeric string.
const NUMERIC_FIELDS = new Set(["askingPrice","capRate","noi","grossPotentialRent","effectiveGrossIncome","operatingExpenses","expenseRatio","nnnRecoveries","occupancy","totalSF","pricePerSF","walt","weightedAvgRentPSF","yearBuilt","renovationYear","numberOfUnits","numberOfBuildings","lotSizeAcres","parkingSpaces","parkingRatio","loanBalance","loanRate","lastSalePrice","txnPurchasePrice","txnSalePrice","acqCapRate","acqNOIAtClose","debtLoanAmount","debtRate","debtLTV","debtDSCR"]);

// Tool that lets the analyst PROPOSE edits to deals. Proposed edits are shown to
// the user for one-click confirmation before anything is written.
const ANALYST_TOOLS = [{
  name: "edit_deals",
  description: "Propose one or more edits to deals in the database. Call this whenever the user asks to change, update, set, correct, reclassify, mark, or annotate deal data — including status (Prospect/Under Contract/Owned/Sold/Passed), notes (userNotes), or any financial/property field. Every proposed edit is shown to the user for one-click confirmation before it is applied, so propose confidently when asked. Use exact field names as they appear in the database JSON (e.g. status, userNotes, capRate, noi, askingPrice). Never invent field names or fabricate values the user didn't ask for.",
  input_schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        description: "The edits to propose.",
        items: {
          type: "object",
          properties: {
            dealId: { type: "string", description: "The id of the deal to edit, taken from the database JSON." },
            dealName: { type: "string", description: "The deal's property name, for display." },
            changes: { type: "object", description: "Map of field name to new value, e.g. {\"status\":\"Pass\"} or {\"capRate\":5.75}." },
            note: { type: "string", description: "Short reason for the change." }
          },
          required: ["dealId", "changes"]
        }
      }
    },
    required: ["edits"]
  }
}];

const SUGGESTED = [
  "What's the average WALT across all deals by asset type?",
  "Which tenants have the best rent bumps and renewal structures?",
  "Flag every deal with occupancy cost above 15% or high rollover risk in 24 months.",
  "Compare weighted average rent/SF across markets — only use recent data.",
  "Find deals with assumable debt — summarize rates and maturities.",
  "Which deals have the weakest tenant credit quality?",
  "Rank deals by NOI growth potential based on below-market rents and upcoming bumps.",
  "What demographic patterns appear in the strongest vs weakest deals?",
  "Are there any emerging metrics appearing across multiple OMs I should know about?",
];

// ── PDF.js loader ─────────────────────────────────────────────
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}

// Single extraction API call with robust error handling
const _sleep = ms => new Promise(r => setTimeout(r, ms));

async function callExtractionAPI(content, onStatus) {
  const requestBody = JSON.stringify({
    model: "claude-sonnet-4-6", max_tokens: 32000,
    messages: [{ role: "user", content }]
  });

  const MAX_ATTEMPTS = 9;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: requestBody
      });
    } catch(fetchErr) {
      // Network blip — retry with backoff
      lastErr = new Error(`Network error: ${fetchErr.message}. Request was ${(requestBody.length/1024).toFixed(0)}KB. (If on mobile, try desktop — the phone app blocks large requests.)`);
      if (attempt < MAX_ATTEMPTS) { await _backoff(attempt, null, onStatus, "Network issue"); continue; }
      throw lastErr;
    }

    // Rate limited (429) or server overloaded (529 / 500 / 503) — wait and retry
    if (resp.status === 429 || resp.status === 529 || resp.status === 500 || resp.status === 503) {
      // Read the body to tell a transient rate-limit apart from a Claude plan/usage cap.
      let bodyMsg = "";
      try { bodyMsg = (await resp.clone().text()) || ""; } catch {}
      if (resp.status === 429 && /usage|quota|credit|spend|limit reached|monthly|daily limit|exceeded your|insufficient|out of/i.test(bodyMsg)) {
        const e = new Error("Claude usage limit reached — extraction can't run until your plan's limit resets. Wait and try again, or check your usage in Claude settings.");
        e.usageLimit = true;
        throw e;
      }
      const retryAfter = parseFloat(resp.headers.get("retry-after"));
      lastErr = new Error(`API ${resp.status === 429 ? "rate limit" : "temporarily overloaded"} (HTTP ${resp.status}).`);
      if (attempt < MAX_ATTEMPTS) {
        await _backoff(attempt, isNaN(retryAfter) ? null : retryAfter, onStatus, resp.status === 429 ? "Rate limited — waiting it out" : "Server busy");
        continue;
      }
      const e = new Error(`Still rate-limited after ${MAX_ATTEMPTS} attempts. This is usually too many requests at once, or your Claude plan's usage limit. Wait a minute and retry — uploads now run one at a time.`);
      e.rateLimited = true;
      throw e;
    }

    const respText = await resp.text();
    let data;
    try { data = JSON.parse(respText); }
    catch { throw new Error(`Response not JSON. HTTP ${resp.status}. Body: ${respText.slice(0,300)}`); }

    if (data.error) {
      const m = typeof data.error === "string" ? data.error : (data.error.message || data.error.type || "unknown");
      // Overloaded errors sometimes arrive in the body with a 200 — retry those too
      if (/overload|rate|429|529/i.test(m) && attempt < MAX_ATTEMPTS) {
        await _backoff(attempt, null, onStatus, "Server busy");
        continue;
      }
      throw new Error(`API rejected request: ${m}. HTTP ${resp.status}.`);
    }

    const raw = data.content?.find(b => b.type === "text")?.text || "";
    if (!raw) throw new Error(`AI returned empty content. stop_reason=${data.stop_reason}.`);

    return { raw, stopReason: data.stop_reason, usage: data.usage };
  }
  throw lastErr || new Error("Extraction failed after retries.");
}

// Exponential backoff with jitter; respects a server-provided retry-after (seconds).
async function _backoff(attempt, retryAfterSec, onStatus, label) {
  const waitMs = retryAfterSec != null
    ? Math.min(retryAfterSec * 1000, 90000)
    : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 45000);
  const secs = Math.ceil(waitMs / 1000);
  if (onStatus) onStatus(`${label} — waiting ${secs}s then retrying (attempt ${attempt + 1})…`);
  await _sleep(waitMs);
}

// Extract a deal from OM text, AUTO-RECOVERING truncated tenant lists.
// If the rent roll is too big for one response, it fetches the rest automatically.
// Builds in-context guidance from the user's past manual corrections so future
// extractions pay closer attention to fields the user often fixes. This is NOT model
// training — it's a "corrections memory" injected into the extraction prompt.
function buildCorrectionsNote(deals) {
  const skip = new Set(["extraction","record","propertyGroup","status","marketSale","marketDemographics","imageMeta","userNotes"]);
  const counts = {};
  for (const d of deals || []) {
    for (const h of d.editHistory || []) {
      if (/^(AI|Auto|PDF)/i.test(h.by || "")) continue; // human corrections only
      for (const c of h.changes || []) {
        const f = c.field;
        if (!f || skip.has(f)) continue;
        if (c.to === "verified" || c.to === "unverified") continue; // verify toggles aren't value fixes
        counts[f] = (counts[f] || 0) + 1;
      }
    }
  }
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([f]) => humanizeKey(f));
  if (!top.length) return "";
  return `\n\nANALYST CORRECTION HISTORY — across prior deals the user has manually corrected these fields, so the source figures or a first read were often off. Extract these with extra care: prefer the ACTUAL/in-place figures stated in the OM (not asking, pro-forma, or marketing numbers) and double-check them: ${top.join(", ")}.`;
}

async function extractWithRecovery(text, onMsg, extraGuidance = "") {
  // Initial extraction
  const first = await callExtractionAPI(EXTRACTION_PROMPT + (extraGuidance || "") + "\n\nOM TEXT:\n" + text, onMsg);
  let extracted;
  try { extracted = robustParseJSON(first.raw); }
  catch(pe) { throw new Error("Could not parse AI response: " + pe.message + ". Start: " + first.raw.slice(0,200)); }

  if (!extracted.tenants) extracted.tenants = [];

  // Auto-recover: if response was cut off at the token limit, fetch remaining tenants
  let rounds = 0;
  let stopReason = first.stopReason;
  while (stopReason === "max_tokens" && rounds < 8) {
    rounds++;
    const haveNames = extracted.tenants.map(t => t.name).filter(Boolean);
    if (onMsg) onMsg(`Large rent roll — fetching more tenants (${haveNames.length} so far)…`);

    const contPrompt =
      "From the Offering Memorandum text below, extract ONLY the tenants that are NOT already in this list:\n" +
      haveNames.join(", ") +
      "\n\nReturn ONLY a JSON object of the form {\"tenants\":[...]} using this schema per tenant: " +
      "{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, reimbursementMethod, rentBumps, rentSchedule, renewalOptions, percentageRent, creditRating, salesPSF, isAnchor, remainingTermYears}. " +
      "If there are no more tenants, return {\"tenants\":[]}. Output must start with { and end with }.\n\nOM TEXT:\n" + text;

    let cont;
    try { cont = await callExtractionAPI(contPrompt, onMsg); }
    catch(e) { break; } // continuation failed — keep what we have

    let contParsed;
    try { contParsed = robustParseJSON(cont.raw); }
    catch { break; }

    const newOnes = (contParsed.tenants || []).filter(t => t && t.name && !haveNames.includes(t.name));
    if (newOnes.length === 0) break; // nothing new — done

    extracted.tenants = extracted.tenants.concat(newOnes);
    stopReason = cont.stopReason;
  }

  extracted._tenantsComplete = (stopReason !== "max_tokens");
  return extracted;
}

// Robust JSON parser — handles truncated responses, markdown fences, text wrapping
function robustParseJSON(raw) {
  if (!raw || !raw.trim()) throw new Error("Empty response");
  let s = raw.trim();

  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  // Strategy 1: direct parse
  try { return JSON.parse(s); } catch {}

  // Strategy 1.5: remove trailing commas before } or ]
  try {
    const noTrailing = s.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(noTrailing);
  } catch {}

  // Strategy 2: extract from first { to last }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const sub = s.slice(first, last + 1);
    try { return JSON.parse(sub); } catch {}
  }

  // Strategy 3: response was truncated — recover the longest valid prefix
  if (first !== -1) {
    try { return repairTruncatedJSON(s.slice(first)); } catch {}
  }

  throw new Error("All parse strategies failed");
}

// Recovers the longest valid prefix of a truncated JSON object by tracking the
// structural stack and string state, then closing any open brackets/braces.
// Truncates at the last point that was provably "between complete values"
// (a closing bracket, or a comma) so we never leave a half-finished token.
function repairTruncatedJSON(s) {
  let inStr = false, esc = false;
  const stack = [];
  let safeLen = -1, safeClosers = "";
  const closersFor = () => stack.map(b => b === "{" ? "}" : "]").reverse().join("");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; }
    else if (c === "{" || c === "[") { stack.push(c); }
    else if (c === "}" || c === "]") {
      stack.pop();
      safeLen = i + 1;          // everything up to & including this closer is valid
      safeClosers = closersFor();
    }
    else if (c === ",") {
      safeLen = i;              // value before the comma is complete; drop the comma
      safeClosers = closersFor();
    }
  }

  if (safeLen <= 0) throw new Error("Could not repair truncated JSON");
  const repaired = s.slice(0, safeLen).replace(/,\s*$/, "") + safeClosers;
  return JSON.parse(repaired);
}

// Render a single PDF page to a compressed JPEG data URL at a target pixel width.
// `half` can be "full" (default), "left", or "right" — for two-page-spread OMs
// where the relevant content sits on one side of a wide page.
async function _renderPdfPage(pdf, n, targetW, quality, half = "full") {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  // When cropping to a half, render at ~2x target so the kept half stays sharp.
  const wantW = half === "full" ? targetW : targetW * 2;
  const scale = Math.min(wantW / base.width, 3);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); // flatten transparency
  await page.render({ canvasContext: ctx, viewport }).promise;
  let out = canvas;
  if (half === "left" || half === "right") {
    const hw = Math.floor(canvas.width / 2);
    const c = document.createElement("canvas");
    c.width = hw; c.height = canvas.height;
    const cx = c.getContext("2d");
    cx.drawImage(canvas, half === "left" ? 0 : (canvas.width - hw), 0, hw, canvas.height, 0, 0, hw, canvas.height);
    out = c;
  }
  const url = out.toDataURL("image/jpeg", quality);
  canvas.width = canvas.height = 0;
  if (out !== canvas) { out.width = out.height = 0; }
  return url;
}

// Downscale a source canvas to a target width and return a JPEG data URL.
function _scaleCanvas(src, targetW, quality) {
  const ratio = Math.min(1, targetW / src.width);
  const w = Math.max(1, Math.round(src.width * ratio));
  const h = Math.max(1, Math.round(src.height * ratio));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d");
  cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, w, h);
  cx.drawImage(src, 0, 0, w, h);
  const url = c.toDataURL("image/jpeg", quality);
  c.width = c.height = 0;
  return url;
}

// Capture a clean property photo from a page: extract the largest EMBEDDED image
// (the actual photo) rather than screenshotting the page, which strips the broker
// logos and text that are layered on top. Tracks the transform matrix so it can
// pick the largest photo on a chosen `half` ("full"|"left"|"right") of a two-page
// spread. Falls back to a (optionally half-cropped) page render. Returns {cover,thumb}.
async function _capturePagePhoto(pdf, n, pdfjsLib, half = "full") {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  // Render the page (also resolves embedded image objects) — used as fallback.
  const wantW = half === "full" ? 1500 : 3000;
  const scale = Math.min(wantW / base.width, half === "full" ? 2.2 : 3);
  const viewport = page.getViewport({ scale });
  const pc = document.createElement("canvas");
  pc.width = Math.round(viewport.width); pc.height = Math.round(viewport.height);
  const pctx = pc.getContext("2d");
  pctx.fillStyle = "#ffffff"; pctx.fillRect(0, 0, pc.width, pc.height);
  await page.render({ canvasContext: pctx, viewport }).promise;

  let cleanCanvas = null;
  try {
    const OPS = pdfjsLib.OPS;
    const opList = await page.getOperatorList();
    // Track the current transform matrix to know where each image sits on the page.
    let m = [1,0,0,1,0,0];
    const stack = [];
    const mul = (a,b)=>[ a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5] ];
    const halfBound = base.width / 2;
    const found = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i], args = opList.argsArray[i];
      if (fn === OPS.save) stack.push(m.slice());
      else if (fn === OPS.restore) { if (stack.length) m = stack.pop(); }
      else if (fn === OPS.transform) m = mul(m, args);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
        const a = args[0];
        if (typeof a === "string") found.push({ name: a, cx: m[0]*0.5 + m[2]*0.5 + m[4] }); // image center x (page units)
      }
    }
    let best = null, bestArea = 0;
    for (const it of found) {
      if (half === "left" && it.cx > halfBound) continue;
      if (half === "right" && it.cx < halfBound) continue;
      let img = null; try { img = page.objs.get(it.name); } catch { img = null; }
      if (!img) continue;
      const w = img.width || (img.bitmap && img.bitmap.width) || 0;
      const h = img.height || (img.bitmap && img.bitmap.height) || 0;
      if (w * h > bestArea) { bestArea = w * h; best = { img, w, h }; }
    }
    const minW = half === "full" ? 560 : 360, minH = half === "full" ? 360 : 240;
    if (best && best.w >= minW && best.h >= minH) {
      const ic = document.createElement("canvas");
      ic.width = best.w; ic.height = best.h;
      const ictx = ic.getContext("2d");
      const im = best.img;
      if (im.bitmap) { ictx.drawImage(im.bitmap, 0, 0); cleanCanvas = ic; }
      else if (im.data) {
        const out = new Uint8ClampedArray(best.w * best.h * 4);
        const d = im.data;
        if (im.kind === 3) { out.set(d.subarray(0, out.length)); }                 // RGBA_32BPP
        else if (im.kind === 2) { for (let p = 0, q = 0; q < out.length; p += 3, q += 4) { out[q]=d[p]; out[q+1]=d[p+1]; out[q+2]=d[p+2]; out[q+3]=255; } } // RGB_24BPP
        if (im.kind === 2 || im.kind === 3) { ictx.putImageData(new ImageData(out, best.w, best.h), 0, 0); cleanCanvas = ic; }
      }
    }
  } catch {}

  let source = cleanCanvas || pc;
  // No clean photo found but a half was requested → crop the page render to it.
  if (!cleanCanvas && (half === "left" || half === "right")) {
    const hw = Math.floor(pc.width / 2);
    const c = document.createElement("canvas");
    c.width = hw; c.height = pc.height;
    const cx = c.getContext("2d");
    cx.drawImage(pc, half === "left" ? 0 : (pc.width - hw), 0, hw, pc.height, 0, 0, hw, pc.height);
    source = c;
  }
  const cover = _scaleCanvas(source, 1200, 0.74);
  const thumb = _scaleCanvas(source, 168, 0.5);
  pc.width = pc.height = 0;
  if (cleanCanvas) { cleanCanvas.width = cleanCanvas.height = 0; }
  if (source !== pc && source !== cleanCanvas) { source.width = source.height = 0; }
  return { cover, thumb };
}

async function extractPdfText(file, onProgress, captureImages = true) {
  const pdfjsLib = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  let allText = "";
  const pageTexts = [];               // per-page text, for site-plan detection
  const pagesToExtract = Math.min(totalPages, 120);

  for (let i = 1; i <= pagesToExtract; i++) {
    if (onProgress) onProgress(Math.round((i / pagesToExtract) * 50));
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // POSITION-AWARE EXTRACTION
    // Group items by y-position (line), sort by x-position (left to right)
    // Detect word boundaries by gap between adjacent items
    // Handles InDesign-style PDFs where each character is its own positioned item
    const lines = {};
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!lines[y]) lines[y] = [];
      lines[y].push({ str: item.str, x, width: item.width || 0 });
    }

    const lineKeys = Object.keys(lines).map(Number).sort((a,b) => b - a);
    const lineTexts = [];
    for (const y of lineKeys) {
      const items = lines[y].sort((a,b) => a.x - b.x);
      if (!items.length) continue;

      // Use median character width as the threshold for word boundary detection
      const widths = items.map(it => it.width / Math.max(it.str.length, 1)).filter(w => w > 0);
      const avgCharWidth = widths.length ? widths.reduce((s,w) => s + w, 0) / widths.length : 4;
      const wordGap = avgCharWidth * 0.6;

      let lineText = items[0].str;
      for (let j = 1; j < items.length; j++) {
        const prev = items[j-1];
        const curr = items[j];
        const gap = curr.x - (prev.x + prev.width);
        // Gap larger than half a char width = word boundary; otherwise concatenate
        lineText += (gap > wordGap) ? " " + curr.str : curr.str;
      }
      lineTexts.push(lineText);
    }

    const pageText = lineTexts.join("\n");
    pageTexts[i] = pageText;
    allText += `\n--- Page ${i} ---\n${pageText}`;
  }

  if (allText.length > 180000) {
    allText = allText.slice(0, 120000) + "\n...[middle truncated]...\n" + allText.slice(-40000);
  }

  // ── Image capture: clean cover photo + site plan (auto-detected, else picker) ──
  let images = null;
  if (captureImages) {
    images = { cover: null, coverThumb: null, sitePlan: [], pagePicks: [], needsSitePlanPick: false };
    try { const c = await _capturePagePhoto(pdf, 1, pdfjsLib); images.cover = c.cover; images.coverThumb = c.thumb; } catch {}
    try {
      // Prefer strong site-plan terms; fall back to "aerial". Render up to 3 matches.
      const strong = /site\s*plan|site\s*map|leasing\s*plan|leasing\s*map|site\s*layout|plot\s*plan|lease\s*plan|overall\s*plan|parcel\s*map|tax\s*parcel|key\s*plan/i;
      const weak = /aerial|site\s*aerial|asset\s*overview/i;
      const score = p => { const t = pageTexts[p] || ""; if (p === 1) return 0; if (strong.test(t)) return 2; if (weak.test(t)) return 1; return 0; };
      const matches = [];
      for (let p = 2; p <= pagesToExtract; p++) if (score(p) > 0) matches.push(p);
      matches.sort((a, b) => score(b) - score(a) || a - b);
      const chosen = matches.slice(0, 3).sort((a, b) => a - b);
      for (const p of chosen) {
        try { const img = await _renderPdfPage(pdf, p, 1500, 0.74); if (img) images.sitePlan.push(img); } catch {}
      }
      // No site plan found → render page thumbnails so the user can pick one.
      if (images.sitePlan.length === 0) {
        const limit = Math.min(pagesToExtract, 24);
        for (let p = 1; p <= limit; p++) {
          try { const thumb = await _renderPdfPage(pdf, p, 900, 0.6); if (thumb) images.pagePicks.push({ page: p, img: thumb }); } catch {}
        }
        if (images.pagePicks.length) images.needsSitePlanPick = true;
      }
    } catch {}
  }

  return { text: allText, pages: totalPages, images };
}

// ── Utilities ─────────────────────────────────────────────────
function getRecency(deal) {
  const src = deal.omDate || deal.uploadedAt;
  if (!src) return { tier:"Unknown", months:null, color:"#958d80", label:"Unknown date" };
  const months = Math.floor((Date.now() - new Date(src)) / (1000*60*60*24*30.4));
  if (months <= 6)  return { tier:"Fresh",     months, color:"#0f9d63", label:`${months}mo — Fresh` };
  if (months <= 18) return { tier:"Recent",    months, color:"#16a34a", label:`${months}mo — Recent` };
  if (months <= 36) return { tier:"Dated",     months, color:"#383a37", label:`${months}mo — Dated` };
  return               { tier:"Historical", months, color:"#dc2626", label:`${Math.floor(months/12)}yr — Historical` };
}

// Derive consistent trade-area tiers from demographics so every deal is classified
// the same way, regardless of whether the OM stated it. Based on 3-mile ring.
function classifyLocation(deal) {
  const pop = Number(deal.population3mi) || null;
  const inc = Number(deal.avgHHIncome3mi) || Number(deal.medianHHIncome3mi) || null;

  let density = null;
  if (pop != null) {
    if (pop >= 250000)      density = { tier:"Dense Urban",   color:"#7c3aed" };
    else if (pop >= 150000) density = { tier:"Urban",         color:"#2563eb" };
    else if (pop >= 75000)  density = { tier:"Suburban",      color:"#0f9d63" };
    else if (pop >= 30000)  density = { tier:"Light Suburban", color:"#c97a18" };
    else                    density = { tier:"Thin / Rural",  color:"#dc2626" };
  }

  let income = null;
  if (inc != null) {
    if (inc >= 120000)      income = { tier:"High Income",     color:"#0f9d63" };
    else if (inc >= 90000)  income = { tier:"Above Average",   color:"#16a34a" };
    else if (inc >= 60000)  income = { tier:"Moderate Income", color:"#c97a18" };
    else                    income = { tier:"Lower Income",    color:"#dc2626" };
  }

  // Use stated urbanicity if the OM provided it; otherwise infer from density
  const urbanicity = deal.urbanicity || (density ? (
    density.tier === "Dense Urban" || density.tier === "Urban" ? "Urban" :
    density.tier === "Thin / Rural" ? "Rural" : "Suburban"
  ) : null);

  return { density, income, urbanicity, pop, inc };
}

function wordSim(a, b) {
  if (!a || !b) return 0;
  const stop = new Set(["the","at","of","in","a","an","and","or","for","to","on","by"]);
  const wa = new Set(a.toLowerCase().split(/[\s,.-]+/).filter(w => w.length > 2 && !stop.has(w)));
  const wb = new Set(b.toLowerCase().split(/[\s,.-]+/).filter(w => w.length > 2 && !stop.has(w)));
  return [...wa].filter(w => wb.has(w)).length / Math.max(wa.size, wb.size, 1);
}

function findSimilar(incoming, existing) {
  return existing.filter(d => {
    if (d.id === incoming.id) return false;
    return wordSim(incoming.propertyName, d.propertyName) > 0.55 ||
           wordSim((incoming.address||"").split(",")[0], (d.address||"").split(",")[0]) > 0.65;
  });
}

// Collect all extraField keys that appear in >= 2 deals (emerging metrics)
function getEmergingFields(deals) {
  const counts = {};
  deals.forEach(d => {
    Object.keys(d.extraFields || {}).forEach(k => { counts[k] = (counts[k]||0) + 1; });
  });
  return Object.entries(counts).filter(([,v]) => v >= 2).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ key: k, count: v }));
}

// Turn a raw data key (camelCase or snake_case) into a clean, human label.
// e.g. "avgHHIncome1mi" → "Avg HH Income 1mi", "real_estate_tax_not_reassessed"
// → "Real Estate Tax Not Reassessed", "noi_cagr_5yr" → "NOI CAGR 5yr".
const _ACRONYMS = new Set(["hh","hhi","noi","cagr","sf","psf","gla","walt","cam","rea","ti","loi","nnn","vpd","egi","gpr","roi","irr","ltv","dscr","fmv","reit","om","usd","ebitda","yoy","gp","lp","cy","ti/lc"]);
const _UNIT_RE = /^\d+(?:\.\d+)?(mi|yr|yrs|mo|mos|k|m|bps|pct|sf|ft|psf|day|days)$/i;
function humanizeKey(key) {
  let s = String(key || "").trim();
  if (!s) return "";
  s = s.replace(/[_\-]+/g, " ");                       // snake/kebab → spaces
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");        // camelCase boundary: aB → a B
  s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");     // acronym→word: HHIncome → HH Income
  s = s.replace(/([A-Za-z])(\d)/g, "$1 $2");           // letter→digit: Income1mi → Income 1mi
  return s.split(/\s+/).map(w => {
    const lw = w.toLowerCase();
    if (_ACRONYMS.has(lw)) return w.toUpperCase();      // known acronyms uppercased
    if (_UNIT_RE.test(w)) return lw;                    // 1mi, 5yr → keep lowercase unit
    if (/^\d/.test(w)) return w;                        // starts with a digit, leave as-is
    return w.charAt(0).toUpperCase() + w.slice(1);      // Title Case
  }).join(" ");
}

// ── Extraction prompt ─────────────────────────────────────────
const EXTRACTION_PROMPT = `You are an expert real estate investment analyst. Extract ALL available data from this Offering Memorandum text and return ONLY a single valid JSON object. Use null for anything not found.

REQUIRED SCHEMA:
{
  "propertyName": "string",
  "address": "full street address",
  "city": "city / town name only, e.g. 'Lewis Center' (no state or zip) or null",
  "state": "2-letter state abbreviation, e.g. 'OH' or null",
  "market": "metro market (e.g. Dallas-Fort Worth)",
  "submarket": "string or null",
  "assetType": "Retail|Office|Industrial|Multifamily|Mixed-Use|NNN|Other",
  "centerType": "For retail, the center FORMAT: Grocery-Anchored|Power Center|Neighborhood Center|Community Center|Lifestyle Center|Regional Mall|Super-Regional Mall|Outlet Center|Strip/Unanchored|Single-Tenant NNN|Mixed-Use|Other. Infer from anchors and description (e.g. a Kroger/Publix/grocery anchor = Grocery-Anchored; big-box discount/off-price cluster like TJ Maxx, Ross, Best Buy, Target = Power Center). null if not retail.",
  "urbanicity": "Urban|Suburban|Exurban|Rural — the setting of the property based on location description and density. null if unclear.",
  "omDate": "YYYY-MM-DD — date OM was prepared. Look for report dates, header dates, 'as of' dates.",

  "askingPrice": number or null — populate ONLY if an explicit asking or guidance price is stated in the OM. Many OMs are unpriced/'price upon request'; if no price is given, use null. Do NOT infer a price from comps, cap rate, or NOI.,
  "capRate": number or null — populate ONLY if an explicit cap rate is stated. If the OM gives NOI but no price/cap rate, do NOT compute one; use null.,
  "noi": number or null,
  "grossPotentialRent": number or null,
  "effectiveGrossIncome": number or null,
  "operatingExpenses": number or null,
  "expenseRatio": number or null,
  "nnnRecoveries": number or null,
  "occupancy": number or null,
  "totalSF": number or null,
  "pricePerSF": number or null,
  "walt": number or null,
  "weightedAvgRentPSF": number or null,

  "yearBuilt": number or null,
  "renovationYear": number or null,
  "numberOfBuildings": number or null,
  "numberOfUnits": number or null,
  "lotSizeAcres": number or null,
  "parkingSpaces": number or null,
  "parkingRatio": number or null,
  "constructionType": "string or null",
  "zoning": "string or null",
  "roofData": {
    "summary": "overall roof age/condition as stated, e.g. 'Roofs replaced 2015-2018; outparcel original 2002' or null",
    "sections": [ { "area": "building / parcel / tenant area label", "installedYear": number or null, "ageYears": number or null, "condition": "string or null" } ],
    "concern": "CRITICAL for capital planning: if a LARGE portion of roof area is old or near end-of-life, flag it here as a capital-allocation concern, e.g. '~40% of GLA on 20+ yr roofs — budget replacement reserve'. null if roofs are newer or not a concern."
  },
  "lastSaleDate": "YYYY-MM-DD or null",
  "lastSalePrice": number or null,

  "assumableDebt": true|false|null,
  "loanBalance": number or null,
  "loanRate": number or null,
  "loanMaturity": "string or null",
  "loanType": "Fixed|Floating|null",

  "broker": "brokerage firm name",
  "seller": "string or null",

  "trafficCountVPD": number or null,
  "population1mi": number or null,
  "population3mi": number or null,
  "population5mi": number or null,
  "medianHHIncome3mi": number or null,
  "avgHHIncome3mi": number or null,
  "proximityHighways": "string or null",
  "retailCotenants": "string or null",

  "tenants": [
    {
      "name": "string",
      "suite": "string or null",
      "sf": number or null,
      "rentPerSF": number or null,
      "annualRent": number or null,
      "leaseStart": "lease commencement date as shown (e.g. 'Oct-08' or 'YYYY-MM-DD') or null",
      "leaseExpiry": "string",
      "leaseType": "NNN|Gross|Modified Gross|null",
      "reimbursementMethod": "recovery structure exactly as stated, e.g. 'Pro-Rata NNN', 'NNN + 5% CAM Cap', 'Fixed CAM/INS', 'Gross' or null",
      "percentOfNOI": number or null,
      "rentBumps": "SUMMARIZE the escalation pattern in a few words — do NOT enumerate every year. e.g. '3%/yr', '10% / 5yrs', '$0.50 PSF/yr', 'flat'. ",
      "rentSchedule": "the explicit future step dates and rates ONLY if the OM lists a discrete schedule (kept for reference/hover, not the headline), e.g. '$11.10 Nov-28; $11.60 Nov-33'. null if escalations are a simple pattern already captured in rentBumps.",
      "renewalOptions": "CONCISE remaining/FUTURE options only, e.g. '3×5yr @ FMV' or '2×5yr flat'. Do NOT list options the tenant has ALREADY exercised — those go in recentlyExercisedRenewal. null if none.",
      "recentlyExercisedRenewal": "if the tenant has RECENTLY exercised a renewal or option (a positive commitment signal), note it concisely here, e.g. 'Exercised 5-yr option 2025'. Keep this SEPARATE from future renewalOptions. null if none.",
      "percentageRent": "CONCISE % rent terms only, e.g. '2% over $16M' or null",
      "creditRating": "Investment Grade|Non-Investment Grade|null",
      "salesPSF": number or null — the most recent / representative reported sales per SF for this tenant (a single SUMMARY figure, NOT a year-by-year list),
      "salesNotes": "brief, summarized sales/performance note for this tenant, e.g. 'Top 20% in chain; ~$3.1M latest' — summarize, do not list every year. null if none.",
      "occupancyCost": number or null — most recent occupancy-cost ratio %,
      "assumptionNote": "CRITICAL — any footnote or underwriting ASSUMPTION attached to this tenant in the rent roll or property summary, e.g. 'Seller covering gap rent until Mar-26', 'assumed to exercise option', 'rent abatement through 2026', 'LOI not yet executed', 'proforma/estimated rent'. Concise. null if none.",
      "isAnchor": true|false,
      "originalLeaseDate": "YYYY or null",
      "remainingTermYears": number or null
    }
  ],

  "cashFlowProjection": [
    {
      "label": "year label exactly as shown, e.g. 'Pro-Forma', 'Year 1 (Jul-27)', 'Year 2'",
      "noi": number or null,
      "egr": "effective gross revenue / effective gross income for the year, number or null",
      "totalBaseRent": number or null,
      "reimbursements": number or null,
      "operatingExpenses": number or null,
      "netCashFlow": number or null
    }
  ],

  "incomeBreakdown": {
    "anchorBaseRent": number or null,
    "shopBaseRent": number or null,
    "camReimbursements": number or null,
    "realEstateTaxReimbursements": number or null,
    "insuranceReimbursements": number or null,
    "percentageRentIncome": number or null,
    "vacancyLoss": number or null
  },

  "expenseBreakdown": {
    "commonAreaExpenses": number or null,
    "realEstateTax": number or null,
    "insurance": number or null,
    "managementFee": number or null
  },

  "underwritingAssumptions": {
    "analysisPeriodYears": number or null,
    "analysisStartDate": "string or null",
    "expenseInflation": "string e.g. '3.0% annually' or null",
    "marketRentInflation": "string or null",
    "capitalReserves": "string e.g. '$0.15 PSF' or null",
    "managementFeePct": "string e.g. '3.0% of EGR' or null",
    "generalVacancyLoss": "string e.g. '2.4% effective' or null",
    "renewalProbability": "string e.g. 'Shop 75%, Anchor 90%' or null",
    "tiAllowance": "string e.g. 'New $15 PSF, Renewal $0' or null",
    "leasingCommissions": "string e.g. 'New 6%, Renewal 3%' or null",
    "marketRentsBySpaceType": "string summarizing market rent assumptions by space type if shown, or null"
  },

  "shadowAnchors": "ONLY anchors physically located ON the subject property that are NOT part of this sale — i.e. owned by a third party and excluded from the offering, typically labeled 'NAP' (not a part) or 'unowned' on the site/parcel plan. They still drive traffic and co-tenancy. Do NOT include retailers at neighboring or nearby properties, and do NOT include tenants that ARE part of the sale. MOST CENTERS HAVE NONE — return null unless the OM explicitly marks an on-site parcel as NAP / unowned.",

  "keyAssumptions": ["array of ONLY the most material deal-level footnotes/assumptions that genuinely affect underwriting or value — e.g. 'Seller covering gap rent on Suite 120 until Mar-26', 'NOI assumes Tenant X exercises its option', 'Includes a $250K leasing credit at closing', 'Proforma rents used for 3 vacant suites'. Capture at most the ~6 most important; CONSOLIDATE related footnotes into one line and OMIT routine boilerplate (standard inflation/vacancy/management-fee assumptions, generic disclaimers, immaterial notes). Empty array if none."],

  "comparableSales": [
    {
      "address": "string",
      "saleDate": "string",
      "salePrice": number or null,
      "capRate": number or null,
      "pricePerSF": number or null,
      "sf": number or null
    }
  ],

  "dealScore": {
    "grade": "A+|A|B+|B|C+|C|D",
    "rationale": "one precise sentence",
    "strengths": ["strength 1", "strength 2", "strength 3"],
    "risks": ["risk 1", "risk 2", "risk 3"]
  },

  "redFlags": [
    { "severity": "high|medium|low", "description": "specific concern. Reserve 'high' severity for issues that genuinely impair value — the two biggest are: (1) a SUBSTANTIAL portion of the GLA sitting on old / near-end-of-life roofs, and (2) an ANCHOR tenant with poor (non-investment-grade) credit and/or a recent history of store closures or bankruptcy. Do NOT raise red flags for things that are normal in OMs: a missing or undisclosed asking price is NEVER a red flag (OMs are routinely unpriced), and real estate taxes that are NOT reassessed in the pro forma is standard OM practice — do NOT flag it." }
  ],

  "notes": "2-3 sentence investment summary",

  "extraFields": {
    "any_other_notable_metric_found": "value",
    "description": "Include anything notable that doesn't fit above — unique lease structures, environmental notes, anchor co-tenancy clauses, kick-out clauses, exclusives, property tax abatements, TIF districts, condemnation clauses, etc."
  }
}

IMPORTANT: extraFields should capture real data found in the OM that isn't covered by the schema above. Be specific — include field names that describe what the data is.

PRIORITIES:
- PRICING: only fill askingPrice / capRate when explicitly stated. Unpriced OMs are common — leave them null rather than inferring. The user enters price/cap manually when needed.
- FOOTNOTES & ASSUMPTIONS: scour the rent roll and property/financial summary for footnotes and underwriting assumptions about tenants (gap rent covered by seller, assumed option exercise, abatements, proforma/estimated rents, unexecuted LOIs). Put genuinely material, value-affecting ones in the tenant's assumptionNote and/or deal-level keyAssumptions — but be SELECTIVE: keep only what affects value, consolidate related notes, and skip routine boilerplate (standard inflation/vacancy/management assumptions, generic disclaimers). Aim for the few most important, not an exhaustive list.
- ROOFS: capture roof ages/condition into roofData. If a large share of roof area is old or near end-of-life, populate roofData.concern — this drives capital-reserve decisions and is important.
- RENEWALS: keep already-exercised renewals in recentlyExercisedRenewal, separate from future renewalOptions. Keep tenant fields concise.
- RED FLAGS: reserve high-severity red flags for genuinely value-impairing issues — most importantly (1) a substantial share of roof area at/near end of life, and (2) an anchor with weak/non-investment-grade credit and/or a recent store-closure or bankruptcy history. NEVER treat an undisclosed/absent asking price as a red flag (OMs are usually unpriced), and NEVER flag real estate taxes that aren't reassessed in the pro forma (that is normal and expected).
- SHADOW ANCHORS: only on-site parcels excluded from the sale and marked NAP / unowned count as shadow anchors — never neighboring or nearby properties. Usually there are none, so default to null.

Return ONLY raw JSON. No markdown, no code fences, no explanation.`;

// ── System prompt ─────────────────────────────────────────────
// Parse a loose date string (e.g. "2025-09", "Sep 2025", "Q3 2025", "2024")
// into {y, m}. m is 0 when only a year is known.
function _parseYM(s) {
  if (!s) return null;
  const str = String(s);
  const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  let mt = str.match(/(\d{4})[-\/](\d{1,2})/);                       // 2025-09
  if (mt) return { y:+mt[1], m:+mt[2] };
  mt = str.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})/); // Sep 2025
  if (mt) return { y:+mt[2], m:months[mt[1]] };
  mt = str.toLowerCase().match(/q([1-4])\s*[-\/ ]?\s*(\d{4})/);       // Q3 2025
  if (mt) return { y:+mt[2], m:(+mt[1])*3 - 2 };
  mt = str.match(/(19|20)\d{2}/);                                     // bare year
  if (mt) return { y:+mt[0], m:0 };
  return null;
}
// Is a found sale dated AFTER the OM? A sale before the OM is a prior/historical
// transaction (e.g. the seller's earlier purchase), not the eventual sale. If
// either date is unparseable we defer to the model's own judgment (return true).
function _saleIsAfterOM(soldDate, omDate) {
  const s = _parseYM(soldDate), o = _parseYM(omDate);
  if (!s || !o) return true;
  if (s.m && o.m) return (s.y*12 + s.m) >= (o.y*12 + o.m);
  return s.y >= o.y;
}

function buildSystemPrompt(deals) {
  const tenantIdx = {};
  deals.forEach(d => {
    const rec = getRecency(d);
    (d.tenants||[]).forEach(t => {
      const k = t.name?.toLowerCase().trim();
      if (!k) return;
      if (!tenantIdx[k]) tenantIdx[k] = [];
      tenantIdx[k].push({ ...t, deal:d.propertyName, market:d.market, assetType:d.assetType, recencyTier:rec.tier, omDate:d.omDate||d.uploadedAt });
    });
  });
  const emerging = getEmergingFields(deals);
  const enriched = deals.map(d => {
    const loc = classifyLocation(d);
    return { ...d, _recencyTier:getRecency(d).tier, _ageMonths:getRecency(d).months,
      _densityTier: loc.density?.tier || null, _incomeTier: loc.income?.tier || null, _urbanicity: loc.urbanicity || null };
  });

  return `You are the KPR Centers Deal Intelligence analyst, an elite real estate investment analyst AI with access to KPR's proprietary OM database. KPR Centers acquires retail and industrial properties (grocery-anchored centers, power centers, and industrial/distribution) in primary and secondary markets nationwide. Be rigorous, data-driven, and specific.

═══ DEAL DATABASE (${deals.length} deals) ═══
${JSON.stringify(enriched, null, 2)}

═══ TENANT INDEX (cross-deal) ═══
${JSON.stringify(tenantIdx, null, 2)}

═══ EMERGING METRICS (extraFields appearing in 2+ deals) ═══
${emerging.length > 0 ? JSON.stringify(emerging) : "None yet — upload more OMs to surface patterns"}

═══ RECENCY RULES ═══
• FRESH (0-6mo): Use freely for benchmarks
• RECENT (6-18mo): Reliable with minor caveats
• DATED (18-36mo): Flag it, note the age
• HISTORICAL (3yr+): Trend analysis ONLY, never cite as current benchmarks
Always warn when citing stale data for current-market questions.

═══ ANALYSIS CAPABILITIES ═══
• WALT analysis: weighted average lease term, rollover concentration risk
• Rent bump compounding: project future rent growth from escalation clauses
• Occupancy cost analysis: flag retail tenants >12-15% occupancy cost
• Debt analysis: compare assumable loan terms to current market rates
• Demographic scoring: correlate income/population/traffic to NOI performance
• Comparable sales: use comps data to validate or challenge asking prices
• Cash flow projection: analyze year-by-year NOI growth, compounding, and the pro forma trajectory (cashFlowProjection field)
• Reimbursement structure: assess recovery risk by tenant (reimbursementMethod) — NNN vs CAM caps vs gross leakage
• Underwriting assumptions: scrutinize the OM's pro forma assumptions (underwritingAssumptions) — inflation, reserves, TI/LC, vacancy, renewal probability — and flag aggressive ones
• Income/expense breakdown: analyze revenue composition (anchor vs shop, reimbursement income) and expense ratios
• Transaction tracking: deals carry user-entered transaction fields — txnPurchasePrice, txnSeller (acquired from), txnLoiDate, txnCloseDate, txnSalePrice, txnBuyer (sold to), txnSaleDate, txnBroker. Statuses are Prospect (being evaluated), Under Contract (LOI/PSA signed, not yet closed), Owned (acquired/in portfolio), Sold (exited), and Passed (declined or dead). A deal that sits as a Prospect for 4+ months is auto-shifted to Passed (flagged autoPassed:true). Use these to answer questions about what KPR has under contract, acquired, owns, or has sold, counterparties, realized gains (txnSalePrice − txnPurchasePrice), and hold periods.
• Disposition record (for Sold deals): dispExitCap (exit cap rate), dispCosts (selling costs), dispLoanPayoff, dispNotes. These are raw facts the user records. Do NOT compute or present realized returns, equity multiples, or IRRs — the user performs all return analysis manually offline. You may state the recorded figures and simple factual differences if asked, but never present derived return metrics as authoritative.
• Acquisition record (for Owned deals): acqCapRate (going-in cap), acqNOIAtClose, acqEntity (title-holding entity), acqBroker, acqContractDate, acqDDExpiration, acqDeposit, acqClosingCosts, acqFee, acqTitleCo, acqCounsel, acqPropManager, acqStrategy (Core/Core-Plus/Value-Add/Opportunistic), acqHoldPeriod (target years), acqTargetIRR, acqNotes (business plan). Use these for questions about going-in yields, all-in basis, strategy mix, target returns, advisors, and closing economics across owned assets.
• Financing & debt (for owned deals): user-entered fields debtLender, debtType, debtLoanAmount, debtRate, debtRateType, debtIndex, debtSpread, debtOriginationDate, debtMaturityDate, debtTermYears, debtAmortYears, debtIOPeriod, debtLTV, debtDSCR, debtRecourse, debtAssumable, debtPrepay, debtExtensions, debtEscrows, debtLoanNumber, debtContact, debtNotes. Use these to answer questions about lenders, rates, upcoming loan maturities, debt service, leverage (LTV), recourse, and refinancing exposure across the owned portfolio.
• Center-type & trade-area segmentation: each deal carries centerType (Grocery-Anchored, Power Center, etc.), urbanicity, and DERIVED tiers _densityTier (Dense Urban→Thin/Rural, from 3-mi population) and _incomeTier (from 3-mi avg HHI). CRITICAL: rents, cap rates, and sales PSF are only comparable within like center types AND similar density/income tiers. A dense-urban grocery-anchored center and a thin-market power center are not peers — always benchmark like-for-like and explicitly flag when a comparison crosses formats or trade-area profiles. Use these segments to explain rent and valuation differences.
• Emerging metrics: surface patterns from extraFields across deals
• Credit quality: differentiate investment grade vs non-IG tenant exposure

═══ MAKING EDITS ═══
You can modify the database, not just read it. When the user asks you to change, update, set, correct, reclassify, mark, or annotate a deal — e.g. "mark the Dallas deal as Pass", "set Oakwood's cap rate to 5.75", "add a note that the seller is motivated" — use the edit_deals tool to propose the change(s). Reference each deal by its exact "id" from the database above. Every edit you propose is shown to the user for confirmation before it takes effect, so propose confidently, and in your text reply briefly state what you're changing and why. Only propose edits the user actually asked for — never fabricate values. For pure questions, just answer normally without the tool.

═══ RESPONSE STYLE ═══
• Cite deal names and specific numbers always
• Pipe tables for comparisons: | Metric | Value | Deal | Age |
• **Bold** key figures
• › bullets for lists
• Warn explicitly when data is Dated/Historical
• Be direct about risks — don't soften red flags`;
}

// ── Mini components ───────────────────────────────────────────
function RecencyBadge({ deal, compact }) {
  const r = getRecency(deal);
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:compact?9:10, color:r.color, background:`${r.color}15`, padding:compact?"1px 5px":"2px 7px", borderRadius:3 }}>
      <span style={{ width:5, height:5, borderRadius:"50%", background:r.color, flexShrink:0 }}/>
      {compact ? r.tier : r.label}
    </span>
  );
}

function ScoreBadge({ score, size }) {
  if (!score?.grade) return null;
  const c = GRADE_COLORS[score.grade] || "#7d766a";
  return <span style={{ fontFamily:"'Fraunces',serif", fontWeight:800, fontSize:size||13, color:c, background:`${c}15`, padding:"2px 9px", borderRadius:4, border:`1px solid ${c}35`, letterSpacing:"0.04em" }}>{score.grade}</span>;
}

function StatusTag({ status, onChange }) {
  const [open, setOpen] = useState(false);
  const c = STATUS_COLORS[status] || "#7d766a";
  return (
    <div style={{ position:"relative" }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ background:`${c}15`, border:`1px solid ${c}40`, color:c, padding:"2px 10px", borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>
        {status||"Set status"} ▾
      </button>
      {open && (
        <div style={{ position:"absolute", top:"100%", left:0, zIndex:50, background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:6, overflow:"hidden", marginTop:4, minWidth:120 }}>
          {STATUS_OPTS.map(s => (
            <div key={s} onClick={()=>{ onChange(s); setOpen(false); }}
              style={{ padding:"8px 14px", cursor:"pointer", fontSize:11, color:STATUS_COLORS[s], fontFamily:"'Inter',sans-serif" }}
              onMouseEnter={e=>e.currentTarget.style.background="#e7e0d2"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Md({ text }) {
  if (!text) return null;

  // Inline: escape HTML first, then apply bold / italic / code
  const inline = (s) => {
    let h = s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return h
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#2a2c27;font-weight:600">$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f1eadc;padding:1px 5px;border-radius:4px;font-size:0.9em;font-family:ui-monospace,monospace">$1</code>');
  };

  const lines = text.split("\n");
  const blocks = [];
  const isBullet = l => /^\s*[-*•›]\s+/.test(l);
  const isNum = l => /^\s*\d+\.\s+/.test(l);
  const isSep = l => l && /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // Table (header row followed by |---| separator)
    if (line.includes("|") && isSep(lines[i+1])) {
      const split = r => r.replace(/^\s*\|/,"").replace(/\|\s*$/,"").split("|").map(c=>c.trim());
      const head = split(line); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(split(lines[i])); i++; }
      blocks.push({ type:"table", head, rows });
      continue;
    }
    // Heading
    const hm = line.match(/^(#{1,4})\s+(.*)$/);
    if (hm) { blocks.push({ type:"h", level:hm[1].length, text:hm[2] }); i++; continue; }
    // Bullet list
    if (isBullet(line)) {
      const items = [];
      while (i < lines.length && isBullet(lines[i])) { items.push(lines[i].replace(/^\s*[-*•›]\s+/,"")); i++; }
      blocks.push({ type:"ul", items }); continue;
    }
    // Numbered list
    if (isNum(line)) {
      const items = [];
      while (i < lines.length && isNum(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/,"")); i++; }
      blocks.push({ type:"ol", items }); continue;
    }
    // Paragraph
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() && !isBullet(lines[i]) && !isNum(lines[i]) && !lines[i].match(/^#{1,4}\s/) && !(lines[i].includes("|") && isSep(lines[i+1]))) { para.push(lines[i]); i++; }
    blocks.push({ type:"p", text: para.join(" ") });
  }

  const HSIZE = { 1:19, 2:16, 3:14, 4:13 };
  return (
    <div style={{ fontSize:14, color:"#4a4d47", lineHeight:1.7 }}>
      {blocks.map((b, bi) => {
        if (b.type==="h") return <div key={bi} style={{ fontFamily:"'Fraunces',serif", fontWeight:600, fontSize:HSIZE[b.level]||14, color:"#2a2c27", marginTop:bi===0?0:18, marginBottom:6, letterSpacing:"-0.01em" }} dangerouslySetInnerHTML={{__html:inline(b.text)}}/>;
        if (b.type==="p") return <p key={bi} style={{ margin:"0 0 10px" }} dangerouslySetInnerHTML={{__html:inline(b.text)}}/>;
        if (b.type==="ul") return <ul key={bi} style={{ margin:"0 0 12px", padding:0, listStyle:"none" }}>{b.items.map((it,ii)=><li key={ii} style={{ display:"flex", gap:10, marginBottom:6, alignItems:"flex-start" }}><span style={{ color:"#6dba43", flexShrink:0, fontWeight:700, marginTop:1 }}>•</span><span dangerouslySetInnerHTML={{__html:inline(it)}}/></li>)}</ul>;
        if (b.type==="ol") return <ol key={bi} style={{ margin:"0 0 12px", padding:0, listStyle:"none" }}>{b.items.map((it,ii)=><li key={ii} style={{ display:"flex", gap:10, marginBottom:6, alignItems:"flex-start" }}><span style={{ color:"#6dba43", flexShrink:0, fontWeight:700, minWidth:16 }}>{ii+1}.</span><span dangerouslySetInnerHTML={{__html:inline(it)}}/></li>)}</ol>;
        if (b.type==="table") return (
          <div key={bi} style={{ overflowX:"auto", margin:"4px 0 14px", border:"1px solid #efe8da", borderRadius:10 }}>
            <table style={{ borderCollapse:"collapse", width:"100%", fontSize:13 }}>
              <thead><tr>{b.head.map((c,ci)=><th key={ci} style={{ textAlign:ci===0?"left":"right", padding:"9px 14px", background:"#f7f9fa", color:"#383a37", fontWeight:600, fontSize:11, letterSpacing:"0.03em", textTransform:"uppercase", borderBottom:"1px solid #e6dfd0", whiteSpace:"nowrap" }} dangerouslySetInnerHTML={{__html:inline(c)}}/>)}</tr></thead>
              <tbody>{b.rows.map((row,ri)=><tr key={ri}>{row.map((c,ci)=><td key={ci} style={{ textAlign:ci===0?"left":"right", padding:"8px 14px", color:ci===0?"#383a37":"#5c5f57", borderBottom:ri<b.rows.length-1?"1px solid #f1eadc":"none", fontWeight:ci===0?500:400, whiteSpace:"nowrap" }} dangerouslySetInnerHTML={{__html:inline(c)}}/>)}</tr>)}</tbody>
            </table>
          </div>
        );
        return null;
      })}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [deals, setDeals] = useState([]);
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState("");
  const [backupMenu, setBackupMenu] = useState(false);
  const [uploadMenu, setUploadMenu] = useState(false);
  const loadedRef = useRef(false);
  const [tab, setTab] = useState("analyst");
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [selectedTenant, setSelectedTenant] = useState(null);
  // Clicking a tenant name asks first, then opens that tenant's cross-portfolio summary.
  const openTenant = (name) => {
    if (!name) return;
    if (window.confirm(`View the tenant summary for ${name}? It shows every property in your database where ${name} is a tenant.`)) {
      setSelectedTenant(name); setTab("tenant");
    }
  };
  const [compareDeals, setCompareDeals] = useState(null);
  const [search, setSearch] = useState("");
  const [filterAsset, setFilterAsset] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterCenter, setFilterCenter] = useState("All");
  const [filterDensity, setFilterDensity] = useState("All");
  const [sortBy, setSortBy] = useState("recency");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const [dupQueue, setDupQueue] = useState([]);     // unresolved possible-duplicate uploads
  const [mergeModal, setMergeModal] = useState(null); // { ids, keeperId } for the bulk merge tool
  const [queue, setQueue] = useState([]);
  const stopRef = useRef(false); // set true to halt in-progress queues (uploads, re-analyze, lookups)
  const [queueOpen, setQueueOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [linkModal, setLinkModal] = useState(null);
  // Confirmation gate for token-heavy (Claude API) actions. Promise-based so any
  // action can `await confirmTokens(...)` and bail if the user cancels.
  const [confirmGate, setConfirmGate] = useState(null);
  const confirmResolver = useRef(null);
  function confirmTokens(actionDesc, count, web) {
    return new Promise(resolve => {
      confirmResolver.current = resolve;
      setConfirmGate({
        body: `You're about to ${actionDesc}. That sends ${count} ${web ? "web search + AI request" : "AI request"}${count===1?"":"s"} to the Claude API and will draw down your usage. Continue?`,
      });
    });
  }
  const resolveConfirm = (ok) => { setConfirmGate(null); const r = confirmResolver.current; confirmResolver.current = null; if (r) r(ok); };
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);
  // ── Audit / trash / undo (item 4) ──
  const [editor, setEditor] = useState(() => { try { return localStorage.getItem("om_editor") || ""; } catch { return ""; } });
  const [trashOpen, setTrashOpen] = useState(false);
  const [undoBuf, setUndoBuf] = useState(null);        // { ids:[...], label:"..." }
  const [purgeConfirm, setPurgeConfirm] = useState(null); // deal id pending permanent delete
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  const [lookingUp, setLookingUp] = useState(() => new Set()); // deal ids with a sale lookup in flight
  const [gettingDemo, setGettingDemo] = useState(() => new Set()); // deal ids with a demographics pull in flight
  const fileRef = useRef();
  const folderRef = useRef();
  const rerunRef = useRef();
  const restoreRef = useRef();
  const rerunTargetsRef = useRef([]);
  const chatEndRef = useRef();

  // Load deals from IndexedDB on mount (migrate from localStorage if present)
  useEffect(() => {
    (async () => {
      try {
        let loaded = await idbLoadDeals();
        if (!loaded) {
          // One-time migration from old localStorage store
          const legacy = localStorage.getItem(STORAGE_KEY);
          if (legacy) { try { loaded = JSON.parse(legacy); } catch {} }
          if (loaded && loaded.length) await idbSaveDeals(loaded);
        }
        if (loaded && loaded.length) {
          const { deals: mg, changed } = migrateAndAutoPass(loaded);
          setDeals(mg);
          if (changed) idbSaveDeals(mg).catch(()=>{});
        }
      } catch(e) {
        // Fall back to localStorage if IndexedDB unavailable
        const legacy = localStorage.getItem(STORAGE_KEY);
        if (legacy) try { setDeals(migrateAndAutoPass(JSON.parse(legacy)).deals); } catch {}
      } finally {
        loadedRef.current = true;
      }
    })();
  }, []);

  // Persist to IndexedDB whenever deals change (after initial load)
  useEffect(() => {
    if (!loadedRef.current) return;
    idbSaveDeals(deals).catch(err => {
      console.error("IndexedDB save failed:", err);
      setStorageError("Could not save to local storage — your browser may be out of space. Recent uploads are in memory but may not persist after reload.");
    });
  }, [deals]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatHistory, thinking]);
  useEffect(() => { if (!notice) return; const t = setTimeout(()=>setNotice(""), 6000); return ()=>clearTimeout(t); }, [notice]);
  // The undo toast is a quick path; deals also stay recoverable from Trash regardless.
  useEffect(() => { if (!undoBuf) return; const t = setTimeout(()=>setUndoBuf(null), 12000); return ()=>clearTimeout(t); }, [undoBuf]);

  // Soft-deleted deals are kept in the array with deleted:true so they're recoverable.
  // Everything user-facing (portfolio, stats, AI context) reads activeDeals instead.
  const activeDeals = deals.filter(d => !d.deleted);
  const trashedDeals = deals.filter(d => d.deleted);

  function saveEditor(v) { setEditor(v); try { localStorage.setItem("om_editor", v); } catch {} }

  function save(updated) {
    setDeals(updated);   // persistence handled by the [deals] effect
  }

  // Race-proof append: functional update so concurrent uploads can't clobber each other
  function addDeal(deal) {
    setDeals(prev => [deal, ...prev]);
  }

  function updQ(id, patch) {
    setQueue(q => q.map(it => it.id === id ? { ...it, ...patch } : it));
  }

  // Process a single queue item end-to-end. Uses a ref to accumulate saved deals
  // so concurrent workers don't clobber each other's saves.
  async function processOne(item) {
    if (item.reanalyze) return reanalyzeOne(item);
    let prog = 0;
    const bump = (to, msg) => { prog = Math.max(prog, to); updQ(item.id, { progress: Math.round(prog), ...(msg!=null?{msg}:{}) }); };
    // Recovery/wait messages shouldn't advance the bar; only real work does.
    const onMsg = (m) => {
      if (/waiting|rate limit|server busy|network issue/i.test(m)) updQ(item.id, { msg: m });
      else bump(Math.min(88, prog + 7), m);
    };
    updQ(item.id, { status: "processing", progress: 3, msg: "Reading PDF…" });
    try {
      const { text, pages, images } = await extractPdfText(item.file, p =>
        bump(3 + (p/100)*32, `Reading PDF… ${Math.round(p)}%`)
      );
      bump(40, `Extracting data from ${pages} pages…`);

      const extracted = await extractWithRecovery(text, onMsg, buildCorrectionsNote(deals));
      bump(95);

      const imageMeta = { cover: !!(images && images.cover), sitePlan: (images && images.sitePlan ? images.sitePlan.length : 0), needsSitePlanPick: !!(images && images.needsSitePlanPick) };

      if (item.rerunId) {
        // Refresh an existing deal in place, preserving user-set fields
        let refreshed = null;
        setDeals(prev => prev.map(d => {
          if (d.id !== item.rerunId) return d;
          const locked = {};
          for (const f of Object.keys(d.verified || {})) if (d[f] !== undefined) locked[f] = d[f];
          const lockedCount = Object.keys(locked).length;
          refreshed = {
            ...d, ...extracted,
            id: d.id, status: d.status, userNotes: d.userNotes,
            propertyGroupId: d.propertyGroupId, uploadedAt: d.uploadedAt,
            fileName: item.name, pdfPages: pages, refreshedAt: new Date().toISOString(), imageMeta,
            txnPurchasePrice: d.txnPurchasePrice, txnSeller: d.txnSeller, txnLoiDate: d.txnLoiDate,
            txnCloseDate: d.txnCloseDate, txnSalePrice: d.txnSalePrice, txnBuyer: d.txnBuyer,
            txnSaleDate: d.txnSaleDate, txnBroker: d.txnBroker, dispExitCap: d.dispExitCap, dispCosts: d.dispCosts, dispLoanPayoff: d.dispLoanPayoff, dispNotes: d.dispNotes, acqCapRate: d.acqCapRate, acqNOIAtClose: d.acqNOIAtClose, acqEntity: d.acqEntity, acqBroker: d.acqBroker, acqContractDate: d.acqContractDate, acqDDExpiration: d.acqDDExpiration, acqDeposit: d.acqDeposit, acqClosingCosts: d.acqClosingCosts, acqFee: d.acqFee, acqTitleCo: d.acqTitleCo, acqCounsel: d.acqCounsel, acqPropManager: d.acqPropManager, acqStrategy: d.acqStrategy, acqHoldPeriod: d.acqHoldPeriod, acqTargetIRR: d.acqTargetIRR, acqNotes: d.acqNotes, debtLender: d.debtLender, debtType: d.debtType, debtLoanAmount: d.debtLoanAmount, debtRate: d.debtRate, debtRateType: d.debtRateType, debtIndex: d.debtIndex, debtSpread: d.debtSpread, debtOriginationDate: d.debtOriginationDate, debtMaturityDate: d.debtMaturityDate, debtTermYears: d.debtTermYears, debtAmortYears: d.debtAmortYears, debtIOPeriod: d.debtIOPeriod, debtLTV: d.debtLTV, debtDSCR: d.debtDSCR, debtRecourse: d.debtRecourse, debtPrepay: d.debtPrepay, debtExtensions: d.debtExtensions, debtEscrows: d.debtEscrows, debtAssumable: d.debtAssumable, debtLoanNumber: d.debtLoanNumber, debtContact: d.debtContact, debtNotes: d.debtNotes,
            ...locked, verified: d.verified,
            editHistory: [...(d.editHistory || []), { ts: new Date().toISOString(), by: editor || "PDF re-run", changes: [{ field: "extraction", from: "prior values", to: lockedCount ? `refreshed from re-uploaded PDF (${lockedCount} verified field${lockedCount>1?"s":""} preserved)` : "refreshed from re-uploaded PDF" }] }]
          };
          return refreshed;
        }));
        idbSaveSource(item.rerunId, { text, pages, fileName: item.name }).catch(()=>{});
        if (images && (images.cover || images.sitePlan.length)) idbSaveImages(item.rerunId, images).catch(()=>{});
        const tcount = (extracted.tenants || []).length;
        updQ(item.id, {
          status: "done", progress: 100, deal: refreshed,
          msg: `Refreshed ${extracted.propertyName || item.name} · ${tcount} tenant${tcount===1?"":"s"}`
        });
        return { ok: true, deal: refreshed };
      }

      const deal = {
        ...extracted,
        id: crypto.randomUUID(), fileName: item.name,
        uploadedAt: new Date().toISOString(), status: "Prospect",
        userNotes: "", pdfPages: pages, imageMeta
      };

      // Race-proof append — concurrent workers each get the latest list
      addDeal(deal);
      // Store the source text internally so the deal can be re-analyzed later
      // (after a schema update) without re-uploading the PDF.
      idbSaveSource(deal.id, { text, pages, fileName: item.name }).catch(()=>{});
      if (images && (images.cover || images.sitePlan.length)) idbSaveImages(deal.id, images).catch(()=>{});

      const tcount = (deal.tenants || []).length;
      const partial = deal._tenantsComplete === false;
      updQ(item.id, {
        status: "done", progress: 100, deal,
        msg: `${deal.propertyName || item.name} · ${tcount} tenant${tcount===1?"":"s"}${partial ? " · partial" : ""}`
      });
      return { ok: true, deal };
    } catch(err) {
      console.error("Upload failed:", item.name, err);
      if (err.usageLimit) setStorageError(err.message);
      updQ(item.id, { status: "error", error: err.message || "Unknown error", msg: err.usageLimit ? "Usage limit reached" : "Failed" });
      return { ok: false, usageLimit: !!err.usageLimit };
    }
  }

  // Run a list of queue items through a fixed-size worker pool (concurrency).
  async function runQueue(items, concurrency = 1) {
    stopRef.current = false;
    let cursor = 0;
    const results = [];
    async function worker() {
      while (cursor < items.length) {
        if (stopRef.current) break;
        const item = items[cursor++];
        const r = await processOne(item);
        if (r) results.push(r);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    if (stopRef.current) {
      // Mark anything not yet started as stopped so the queue doesn't sit "pending" forever.
      setQueue(prev => prev.map(it => it.status === "pending" ? { ...it, status:"error", msg:"Stopped", error:"Stopped by user" } : it));
    }
    return results;
  }

  // Halt any in-progress queue/lookup. Items mid-flight finish; nothing new starts.
  function stopAll() {
    stopRef.current = true;
    setNotice("Stopping… in-progress item will finish, then the queue halts.");
  }

  async function handleFiles(e) {
    let files = Array.from(e.target.files || []);
    e.target.value = "";
    // Folder uploads include non-PDF files — keep only PDFs
    files = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) return;
    if (files.length >= 3 && !(await confirmTokens(`extract data from ${files.length} PDFs`, files.length, false))) return;
    await ingestFiles(files);
  }

  async function ingestFiles(files) {
    const existingBefore = deals; // snapshot of what was already in the DB before this batch
    const items = files.map(f => ({
      id: crypto.randomUUID(), file: f, name: f.name,
      status: "pending", msg: "Queued…", deal: null, error: null
    }));
    setQueue(prev => [...items, ...prev]);
    setQueueOpen(true);

    const results = await runQueue(items, 1);

    // Duplicate-catch: for each newly-created deal (not a re-run), see if it looks like
    // something already in the database and queue it for the user to resolve.
    const created = results.filter(r => r?.ok && r.deal && !existingBefore.some(e => e.id === r.deal.id)).map(r => r.deal);
    const dups = [];
    for (const nd of created) {
      const matches = findSimilar(nd, existingBefore);
      if (matches.length) dups.push({ newDeal: nd, matches });
    }
    if (dups.length) setDupQueue(prev => [...prev, ...dups]);
  }

  async function retryFailed() {
    const failed = queue.filter(q => q.status === "error");
    if (!failed.length) return;
    failed.forEach(f => updQ(f.id, { status: "pending", msg: "Queued…", error: null }));
    await runQueue(failed, 1);
  }

  // Drag-and-drop a folder or files anywhere on the page
  async function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const dropped = [];
    const items = e.dataTransfer?.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      // Recursively walk dropped folders
      const walk = async (entry) => {
        if (entry.isFile) {
          await new Promise(res => entry.file(f => { if (f.name.toLowerCase().endsWith(".pdf")) dropped.push(f); res(); }, () => res()));
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readBatch = () => new Promise(res => reader.readEntries(async (entries) => {
            if (!entries.length) return res();
            for (const en of entries) await walk(en);
            await readBatch(); res();
          }, () => res()));
          await readBatch();
        }
      };
      const entries = Array.from(items).map(it => it.webkitGetAsEntry()).filter(Boolean);
      for (const en of entries) await walk(en);
    } else {
      Array.from(e.dataTransfer.files || []).forEach(f => { if (f.name.toLowerCase().endsWith(".pdf")) dropped.push(f); });
    }
    if (dropped.length) await ingestFiles(dropped);
  }

  function linkDeals(newDeal, targetDeal) {
    const groupId = targetDeal.propertyGroupId || crypto.randomUUID();
    const updated = deals.map(d =>
      (d.id===newDeal.id || d.id===targetDeal.id || d.propertyGroupId===targetDeal.propertyGroupId)
        ? { ...d, propertyGroupId:groupId } : d
    );
    save(updated); setLinkModal(null);
    setSelectedDeal(updated.find(d => d.id===newDeal.id)); setTab("detail");
  }

  // ── Duplicate handling & manual link/merge ──────────────────────────
  // Hard-remove a just-uploaded deal the user chose not to keep.
  function discardNewDeal(id) {
    setDeals(prev => prev.filter(d => d.id !== id));
    idbDeleteImages(id).catch(()=>{});
    idbDeleteSource(id).catch(()=>{});
  }

  // "Update existing": fold a freshly-uploaded deal into an existing one — take the
  // new OM's extracted data, images, and text, but keep the existing deal's status,
  // notes, verified fields, transaction record, and history. Removes the duplicate upload.
  async function updateExistingFromUpload(newDeal, existingId) {
    const ts = new Date().toISOString();
    try {
      const imgs = await idbLoadImages(newDeal.id);
      if (imgs && (imgs.cover || (imgs.sitePlan && imgs.sitePlan.length))) await idbSaveImages(existingId, imgs);
    } catch {}
    try {
      const src = await idbLoadSource(newDeal.id);
      if (src) await idbSaveSource(existingId, src);
    } catch {}
    idbDeleteImages(newDeal.id).catch(()=>{});
    idbDeleteSource(newDeal.id).catch(()=>{});

    setDeals(prev => {
      const E = prev.find(d => d.id === existingId);
      if (!E) return prev.filter(d => d.id !== newDeal.id);
      const preserve = {};
      for (const f of [...USER_DATA_FIELDS, "propertyGroupId", "uploadedAt"]) if (E[f] !== undefined) preserve[f] = E[f];
      const merged = {
        ...newDeal, ...preserve,
        id: E.id, verified: E.verified, refreshedAt: ts,
        editHistory: [...(E.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "extraction", from: "prior values", to: "updated from re-uploaded OM (duplicate caught on upload)" }] }]
      };
      for (const f of Object.keys(E.verified || {})) if (E[f] !== undefined) merged[f] = E[f]; // keep verified values
      return prev.filter(d => d.id !== newDeal.id).map(d => d.id === E.id ? merged : d);
    });
    setNotice("Updated the existing deal from the re-uploaded OM.");
  }

  // "Link as versions" from the duplicate prompt — keeps both OMs, groups them.
  function linkAsVersions(newDeal, existingDeal) {
    const groupId = existingDeal.propertyGroupId || crypto.randomUUID();
    setDeals(prev => prev.map(d =>
      (d.id === newDeal.id || d.id === existingDeal.id || (existingDeal.propertyGroupId && d.propertyGroupId === existingDeal.propertyGroupId))
        ? { ...d, propertyGroupId: groupId } : d));
    setNotice("Linked as the same property — both OMs kept.");
  }

  // Manual multi-select: group selected deals as one property's version history (keeps all).
  function linkSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length < 2) return;
    const sel = deals.filter(d => ids.includes(d.id));
    const groupId = sel.find(d => d.propertyGroupId)?.propertyGroupId || crypto.randomUUID();
    const ts = new Date().toISOString();
    setDeals(prev => prev.map(d =>
      (ids.includes(d.id) || (d.propertyGroupId && sel.some(s => s.propertyGroupId && s.propertyGroupId === d.propertyGroupId)))
        ? { ...d, propertyGroupId: groupId, editHistory: [...(d.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "propertyGroup", from: "\u2014", to: "linked as same property" }] }] }
        : d));
    clearSelection();
    setNotice(`Linked ${ids.length} deals as one property's version history.`);
  }

  function openMerge() {
    const ids = Array.from(selectedIds);
    if (ids.length >= 2) setMergeModal({ ids, keeperId: ids[0] });
  }

  // Manual merge: fold true-duplicate deals into a chosen keeper; extras go to Trash (reversible).
  async function doMerge(keeperId, ids) {
    const others = ids.filter(id => id !== keeperId);
    const ts = new Date().toISOString();
    try {
      const kImgs = await idbLoadImages(keeperId).catch(()=>null);
      if (!kImgs || (!kImgs.cover && !(kImgs.sitePlan && kImgs.sitePlan.length))) {
        for (const oid of others) { const oi = await idbLoadImages(oid).catch(()=>null); if (oi && (oi.cover || (oi.sitePlan && oi.sitePlan.length))) { await idbSaveImages(keeperId, oi); break; } }
      }
      const kSrc = await idbLoadSource(keeperId).catch(()=>null);
      if (!kSrc) { for (const oid of others) { const os = await idbLoadSource(oid).catch(()=>null); if (os) { await idbSaveSource(keeperId, os); break; } } }
    } catch {}

    setDeals(prev => {
      const K = prev.find(d => d.id === keeperId); if (!K) return prev;
      const os = prev.filter(d => others.includes(d.id));
      const merged = { ...K };
      for (const f of USER_DATA_FIELDS) {
        if (f === "userNotes") continue;
        if (merged[f] === undefined || merged[f] === null || merged[f] === "") {
          const donor = os.find(o => o[f] !== undefined && o[f] !== null && o[f] !== "");
          if (donor) merged[f] = donor[f];
        }
      }
      const notes = [K.userNotes, ...os.map(o => o.userNotes)].filter(Boolean);
      if (notes.length) merged.userNotes = Array.from(new Set(notes)).join("\n\n");
      const ver = { ...(K.verified || {}) };
      for (const o of os) for (const vf of Object.keys(o.verified || {})) if (!ver[vf]) { ver[vf] = o.verified[vf]; if (merged[vf] === undefined && o[vf] !== undefined) merged[vf] = o[vf]; }
      merged.verified = ver;
      merged.editHistory = [...(K.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "record", from: `${others.length + 1} duplicate deals`, to: "merged into one" }] }];
      return prev.map(d => {
        if (d.id === keeperId) return merged;
        if (others.includes(d.id)) return { ...d, deleted: true, deletedAt: ts, editHistory: [...(d.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "record", from: "active", to: `merged into ${K.propertyName || K.fileName || "keeper"} (trashed)` }] }] };
        return d;
      });
    });
    setUndoBuf({ ids: others, label: `Merged ${others.length + 1} deals` });
    setMergeModal(null); clearSelection();
    setNotice(`Merged ${ids.length} deals into one. The extras are in Trash if you need them back.`);
  }

  function updateDeal(id, patch) {
    const ts = new Date().toISOString();
    // When the status is changed by hand, reset the 4-month prospect clock and
    // clear any auto-passed flag — this is now a deliberate human decision.
    const stamp = (prev) => (patch.status !== undefined && patch.status !== prev.status)
      ? { statusSince: ts, autoPassed: false } : {};
    const logEntry = (prev) => {
      const changes = _diffChanges(prev, patch);
      return changes.length
        ? [...(prev.editHistory || []), { ts, by: editor || "Unknown", changes }]
        : (prev.editHistory || []);
    };
    setDeals(prev => prev.map(d => d.id === id ? { ...d, ...patch, ...stamp(d), editHistory: logEntry(d) } : d));
    if (selectedDeal?.id === id) setSelectedDeal(prev => ({ ...prev, ...patch, ...stamp(prev), editHistory: logEntry(prev) }));
  }

  // Mark/unmark a single extracted field as verified (locked against re-analyze).
  function toggleVerified(id, field) {
    const ts = new Date().toISOString();
    const apply = (deal) => {
      const v = { ...(deal.verified || {}) };
      const nowOn = !v[field];
      if (nowOn) v[field] = { by: editor || "Unknown", ts }; else delete v[field];
      const entry = { ts, by: editor || "Unknown", changes: [{ field, from: nowOn ? "unverified" : "verified", to: nowOn ? "verified" : "unverified" }] };
      return { ...deal, verified: v, editHistory: [...(deal.editHistory || []), entry] };
    };
    setDeals(prev => prev.map(d => d.id === id ? apply(d) : d));
    if (selectedDeal?.id === id) setSelectedDeal(prev => apply(prev));
  }

  // Soft delete: flag the deal as deleted (recoverable from Trash) and keep its
  // stored OM text so a restore is lossless and re-analyze still works.
  function deleteDeal(id) {
    const ts = new Date().toISOString();
    setDeals(prev => prev.map(d => d.id === id
      ? { ...d, deleted: true, deletedAt: ts, editHistory: [...(d.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "record", from: "active", to: "moved to trash" }] }] }
      : d));
    setUndoBuf({ ids: [id], label: "Deal moved to trash" });
    setSelectedDeal(null); setTab("database");
  }

  // ── Multi-select bulk actions ──
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function clearSelection() { setSelectedIds(new Set()); }
  function selectAllFiltered() {
    setSelectedIds(prev => {
      const allShown = filteredDeals.every(d => prev.has(d.id));
      return allShown ? new Set() : new Set(filteredDeals.map(d => d.id));
    });
  }
  function bulkChangeStatus(status) {
    const ts = new Date().toISOString();
    setDeals(prev => prev.map(d => selectedIds.has(d.id)
      ? { ...d, status, statusSince: ts, autoPassed: false, editHistory: [...(d.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "status", from: d.status || "\u2014", to: status }] }] }
      : d));
    setBulkStatusOpen(false);
    clearSelection();
  }
  function bulkDelete() {
    const ts = new Date().toISOString();
    const ids = Array.from(selectedIds);
    setDeals(prev => prev.map(d => selectedIds.has(d.id)
      ? { ...d, deleted: true, deletedAt: ts, editHistory: [...(d.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "record", from: "active", to: "moved to trash" }] }] }
      : d));
    setUndoBuf({ ids, label: `${ids.length} deal${ids.length > 1 ? "s" : ""} moved to trash` });
    setConfirmBulkDel(false);
    clearSelection();
  }

  // ── Trash: restore / undo / permanent purge ──
  function restoreDeals(ids) {
    const set = new Set(ids);
    const ts = new Date().toISOString();
    setDeals(prev => prev.map(d => set.has(d.id)
      ? { ...d, deleted: false, deletedAt: null, editHistory: [...(d.editHistory || []), { ts, by: editor || "Unknown", changes: [{ field: "record", from: "trash", to: "restored" }] }] }
      : d));
  }
  function restoreDeal(id) { restoreDeals([id]); }
  function undoDelete() { if (undoBuf) { restoreDeals(undoBuf.ids); setUndoBuf(null); } }
  function purgeDeal(id) {            // permanent — no recovery
    setDeals(prev => prev.filter(d => d.id !== id));
    idbDeleteSource(id);
    idbDeleteImages(id);
    setPurgeConfirm(null);
  }
  function emptyTrash() {
    const ids = deals.filter(d => d.deleted).map(d => d.id);
    ids.forEach(idbDeleteSource);
    ids.forEach(idbDeleteImages);
    setDeals(prev => prev.filter(d => !d.deleted));
    setEmptyConfirm(false);
  }
  function bulkCompare() {
    const sel = deals.filter(d => selectedIds.has(d.id));
    if (sel.length === 2) { setCompareDeals(sel); setTab("compare"); clearSelection(); }
  }
  // Re-run extraction: needs the source PDFs again (we don't retain uploaded files).
  // Opens a picker; files are matched to selected deals by filename and updated in place.
  function bulkRerun() {
    rerunTargetsRef.current = deals.filter(d => selectedIds.has(d.id));
    rerunRef.current?.click();
  }
  // Re-analyze using stored source text — no re-upload. Used after schema updates.
  async function reanalyzeOne(item) {
    let prog = 0;
    const bump = (to, msg) => { prog = Math.max(prog, to); updQ(item.id, { progress: Math.round(prog), ...(msg!=null?{msg}:{}) }); };
    const onMsg = (m) => {
      if (/waiting|rate limit|server busy|network issue/i.test(m)) updQ(item.id, { msg: m });
      else bump(Math.min(88, prog + 7), m);
    };
    updQ(item.id, { status: "processing", progress: 10, msg: "Loading stored OM text…" });
    try {
      const src = await idbLoadSource(item.dealId);
      if (!src || !src.text) {
        updQ(item.id, { status: "error", msg: "No stored text", error: "This deal was uploaded before internal storage. Re-run it from the PDF once, then it can be re-analyzed anytime." });
        return { ok: false };
      }
      bump(40, "Re-extracting with current schema…");
      const extracted = await extractWithRecovery(src.text, onMsg, buildCorrectionsNote(deals));
      bump(95);
      let updated = null;
      setDeals(prev => prev.map(d => {
        if (d.id !== item.dealId) return d;
        const keep = {
          id: d.id, status: d.status, userNotes: d.userNotes, propertyGroupId: d.propertyGroupId,
          uploadedAt: d.uploadedAt, fileName: d.fileName, pdfPages: d.pdfPages || src.pages,
          txnPurchasePrice: d.txnPurchasePrice, txnSeller: d.txnSeller, txnLoiDate: d.txnLoiDate,
          txnCloseDate: d.txnCloseDate, txnSalePrice: d.txnSalePrice, txnBuyer: d.txnBuyer,
          txnSaleDate: d.txnSaleDate, txnBroker: d.txnBroker, dispExitCap: d.dispExitCap, dispCosts: d.dispCosts, dispLoanPayoff: d.dispLoanPayoff, dispNotes: d.dispNotes, acqCapRate: d.acqCapRate, acqNOIAtClose: d.acqNOIAtClose, acqEntity: d.acqEntity, acqBroker: d.acqBroker, acqContractDate: d.acqContractDate, acqDDExpiration: d.acqDDExpiration, acqDeposit: d.acqDeposit, acqClosingCosts: d.acqClosingCosts, acqFee: d.acqFee, acqTitleCo: d.acqTitleCo, acqCounsel: d.acqCounsel, acqPropManager: d.acqPropManager, acqStrategy: d.acqStrategy, acqHoldPeriod: d.acqHoldPeriod, acqTargetIRR: d.acqTargetIRR, acqNotes: d.acqNotes, debtLender: d.debtLender, debtType: d.debtType, debtLoanAmount: d.debtLoanAmount, debtRate: d.debtRate, debtRateType: d.debtRateType, debtIndex: d.debtIndex, debtSpread: d.debtSpread, debtOriginationDate: d.debtOriginationDate, debtMaturityDate: d.debtMaturityDate, debtTermYears: d.debtTermYears, debtAmortYears: d.debtAmortYears, debtIOPeriod: d.debtIOPeriod, debtLTV: d.debtLTV, debtDSCR: d.debtDSCR, debtRecourse: d.debtRecourse, debtPrepay: d.debtPrepay, debtExtensions: d.debtExtensions, debtEscrows: d.debtEscrows, debtAssumable: d.debtAssumable, debtLoanNumber: d.debtLoanNumber, debtContact: d.debtContact, debtNotes: d.debtNotes
        };
        // Verified (locked) fields override the fresh extraction so a re-analyze
        // can never silently change a number you've checked against the OM.
        const locked = {};
        for (const f of Object.keys(d.verified || {})) if (d[f] !== undefined) locked[f] = d[f];
        const lockedCount = Object.keys(locked).length;
        updated = { ...d, ...extracted, ...keep, ...locked, verified: d.verified, refreshedAt: new Date().toISOString(),
          editHistory: [...(d.editHistory || []), { ts: new Date().toISOString(), by: editor || "AI re-analysis", changes: [{ field: "extraction", from: "prior values", to: lockedCount ? `refreshed from OM text (${lockedCount} verified field${lockedCount>1?"s":""} preserved)` : "refreshed from stored OM text" }] }] };
        return updated;
      }));
      const tcount = (extracted.tenants || []).length;
      updQ(item.id, { status: "done", progress: 100, deal: updated, msg: `Re-analyzed ${extracted.propertyName || item.name} · ${tcount} tenant${tcount===1?"":"s"}` });
      return { ok: true, deal: updated };
    } catch(err) {
      console.error("Re-analyze failed:", err);
      updQ(item.id, { status: "error", error: err.message || "Unknown error", msg: "Failed" });
      return { ok: false };
    }
  }

  // Bulk: re-analyze selected deals from stored text (no upload)
  // ── Backup / Export / Restore ──
  function _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function _stamp() { return new Date().toISOString().slice(0,10); }

  // Full, lossless backup: every deal + its stored OM text. Re-importable.
  async function exportBackup() {
    setBackupMenu(false);
    try {
      setNotice("Preparing backup…");
      const sources = {}, images = {};
      for (const d of deals) {
        try { const s = await idbLoadSource(d.id); if (s) sources[d.id] = s; } catch {}
        try { const im = await idbLoadImages(d.id); if (im) images[d.id] = im; } catch {}
      }
      const payload = { app: "KPR Deal Intelligence", schema: 2, exportedAt: new Date().toISOString(), dealCount: deals.length, deals, sources, images };
      _download(new Blob([JSON.stringify(payload)], { type: "application/json" }), `kpr-portfolio-backup-${_stamp()}.json`);
      setNotice(`Backup downloaded — ${deals.length} deals (keep this file safe).`);
    } catch(e) {
      setStorageError("Backup failed: " + (e.message || "unknown error"));
    }
  }

  // Flat spreadsheet of key fields, one row per deal, for Excel/sharing.
  function exportCSV() {
    setBackupMenu(false);
    const esc = v => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cols = [
      ["Property", d => d.propertyName || d.fileName],
      ["Address", d => d.address], ["Market", d => d.market], ["Submarket", d => d.submarket],
      ["Asset Type", d => d.assetType], ["Center Type", d => d.centerType], ["Urbanicity", d => classifyLocation(d).urbanicity],
      ["Status", d => d.status], ["Score", d => d.dealScore?.grade],
      ["Asking Price", d => d.askingPrice], ["Cap Rate %", d => d.capRate], ["NOI", d => d.noi],
      ["Total SF", d => d.totalSF], ["Price/SF", d => d.pricePerSF], ["Occupancy %", d => d.occupancy], ["WALT", d => d.walt],
      ["Pop 3mi", d => d.population3mi], ["Avg HHI 3mi", d => d.avgHHIncome3mi],
      ["Tenants", d => (d.tenants||[]).length], ["Broker", d => d.broker], ["Seller (OM)", d => d.seller],
      ["Purchase Price", d => d.txnPurchasePrice], ["Acquired From", d => d.txnSeller], ["Close Date", d => d.txnCloseDate],
      ["Going-In Cap", d => d.acqCapRate], ["Strategy", d => d.acqStrategy],
      ["Lender", d => d.debtLender], ["Loan Amount", d => d.debtLoanAmount], ["Rate %", d => d.debtRate], ["Loan Maturity", d => d.debtMaturityDate],
      ["Sale Price", d => d.txnSalePrice], ["Sold To", d => d.txnBuyer], ["Sale Date", d => d.txnSaleDate],
      ["OM Date", d => d.omDate], ["File", d => d.fileName],
    ];
    const header = cols.map(c => esc(c[0])).join(",");
    const rows = deals.filter(d => !d.deleted).map(d => cols.map(c => esc(c[1](d))).join(","));
    const csv = "\uFEFF" + [header, ...rows].join("\r\n"); // BOM for Excel
    _download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `kpr-portfolio-${_stamp()}.csv`);
    setNotice(`Spreadsheet exported — ${deals.length} deals.`);
  }

  // Restore from a JSON backup. Merges by id (imported replaces same id, new ids added).
  async function handleRestore(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data) ? data : data.deals;
      if (!Array.isArray(incoming)) throw new Error("Not a valid backup file.");
      setDeals(prev => {
        const byId = new Map(prev.map(d => [d.id, d]));
        let added = 0, updated = 0;
        for (const d of incoming) {
          if (!d || !d.id) continue;
          if (byId.has(d.id)) updated++; else added++;
          byId.set(d.id, d);
        }
        setNotice(`Restored backup — ${added} added, ${updated} updated, ${byId.size} total.`);
        return Array.from(byId.values());
      });
      // Restore stored OM texts so re-analyze still works
      if (data.sources && typeof data.sources === "object") {
        for (const [id, src] of Object.entries(data.sources)) {
          idbSaveSource(id, src).catch(()=>{});
        }
      }
      // Restore captured cover / site-plan images
      if (data.images && typeof data.images === "object") {
        for (const [id, im] of Object.entries(data.images)) {
          idbSaveImages(id, im).catch(()=>{});
        }
      }
    } catch(err) {
      setStorageError("Restore failed: " + (err.message || "could not read file"));
    }
  }

  async function reanalyzeSelected() {
    const targets = deals.filter(d => selectedIds.has(d.id));
    if (!targets.length) return;
    if (targets.length >= 2 && !(await confirmTokens(`re-analyze ${targets.length} deals`, targets.length, false))) return;
    clearSelection();
    const items = targets.map(t => ({
      id: crypto.randomUUID(), dealId: t.id, name: t.propertyName || t.fileName,
      status: "pending", msg: "Queued for re-analysis…", deal: null, error: null, reanalyze: true
    }));
    setQueue(prev => [...items, ...prev]);
    setQueueOpen(true);
    await runQueue(items, 1);
  }

  async function handleRerunFiles(e) {
    let files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    e.target.value = "";
    if (!files.length) return;
    if (files.length >= 3 && !(await confirmTokens(`re-run ${files.length} PDFs through extraction`, files.length, false))) return;
    const targets = rerunTargetsRef.current;
    const norm = s => (s||"").toLowerCase().trim();
    const items = files.map(f => {
      const match = targets.find(t => norm(t.fileName) === norm(f.name));
      return {
        id: crypto.randomUUID(), file: f, name: f.name,
        status: "pending", msg: match ? "Queued — will refresh existing deal…" : "Queued — new deal (no match)…",
        deal: null, error: null, rerunId: match ? match.id : null
      };
    });
    setQueue(prev => [...items, ...prev]);
    setQueueOpen(true);
    clearSelection();
    await runQueue(items, 1);
  }

  async function sendMessage(text) {
    if (!text.trim() || thinking) return;
    if (activeDeals.length===0) {
      setChatHistory(h => [...h, {role:"user",content:text}, {role:"assistant",content:"No deals yet — upload some OMs first, then ask anything."}]);
      setChatInput(""); return;
    }
    const msgs = [...chatHistory, { role:"user", content:text }];
    setChatHistory(msgs); setChatInput(""); setThinking(true);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:1500,
          system: buildSystemPrompt(activeDeals),
          tools: ANALYST_TOOLS,
          messages: msgs.map(m => ({ role:m.role, content:m.content }))
        })
      });
      const data = await resp.json();
      const blocks = data.content || [];
      const textReply = blocks.filter(b => b.type==="text").map(b => b.text).join("\n").trim();
      // Turn any edit_deals tool calls into reviewable, confirmable actions.
      const actions = [];
      for (const tc of blocks.filter(b => b.type==="tool_use" && b.name==="edit_deals")) {
        for (const e of (tc.input?.edits || [])) {
          const deal = deals.find(d => d.id===e.dealId);
          if (!deal) continue;
          const changes = {}, skipped = [];
          for (const [k,v] of Object.entries(e.changes || {})) {
            const allowed = k==="status" || k==="userNotes" || (k in deal);    // no inventing new fields
            if (!allowed) { skipped.push(k); continue; }
            changes[k] = (NUMERIC_FIELDS.has(k) && v!=null && v!=="" && !isNaN(Number(v))) ? Number(v) : v;
          }
          if (Object.keys(changes).length) actions.push({ dealId:e.dealId, dealName:e.dealName || deal.propertyName || deal.fileName, changes, note:e.note||"", skipped });
        }
      }
      const reply = textReply || (actions.length ? `I've prepared ${actions.length} change${actions.length>1?"s":""} for your review below.` : "No response.");
      setChatHistory(h => [...h, { role:"assistant", content:reply, actions: actions.length?actions:undefined }]);
    } catch { setChatHistory(h => [...h, { role:"assistant", content:"Network error. Try again." }]); }
    setThinking(false);
  }

  // Apply / discard analyst-proposed edits. Applying routes through updateDeal so
  // every change lands in the audit trail just like a manual edit.
  function applyAnalystEdits(msgIndex) {
    const msg = chatHistory[msgIndex];
    if (!msg?.actions || msg.applied) return;
    for (const a of msg.actions) updateDeal(a.dealId, a.changes);
    setChatHistory(h => h.map((m,i) => i===msgIndex ? { ...m, applied:true } : m));
    const n = msg.actions.length;
    setNotice(`Applied ${n} change${n>1?"s":""} from the analyst — see each deal's edit history.`);
  }
  function discardAnalystEdits(msgIndex) {
    setChatHistory(h => h.map((m,i) => i===msgIndex ? { ...m, discarded:true } : m));
  }

  // ── Sale lookup: research whether a (often passed) deal eventually sold. ──
  // Uses the model's web-search tool, then only records a result when it's
  // confirmed with HIGH confidence so we never write a guessed sale price.
  async function lookupSale(deal) {
    const idInfo = {
      property: deal.propertyName, address: deal.address, market: deal.market,
      assetType: deal.assetType, centerType: deal.centerType,
      sellerInOM: deal.seller, brokerInOM: deal.broker, omDate: deal.omDate,
      approxSF: deal.totalSF, askingPriceInOM: deal.askingPrice
    };
    const sys = 'You are a commercial real estate research assistant. Using web search, determine whether the specific property described has SOLD in a closed transaction AFTER the date of its offering memorandum (the "omDate" field). We want the eventual sale that resulted from this offering — typically closing in the months after the OM. CRITICAL: ignore any earlier/prior transaction, such as the current seller\'s own past acquisition of the property. A sale dated before the omDate is NOT relevant — if the only sale you can find predates the omDate, treat it as found=false. Find the confirmed sale price, buyer, seller, sale date, and cap rate where reported by credible sources (brokerage press releases, trade press such as Commercial Observer / Bisnow / REBusinessOnline, local business journals, public records). Be rigorous: report "high" confidence ONLY when an authoritative source, or several credible ones, clearly confirm a post-OM sale of THIS exact property (match address/market). If you cannot confirm it is the same property, the sale predates the OM, or the data is thin or conflicting, use found=false or a lower confidence. Never guess a price or a date. Always include the sale date you found in "soldDate". After researching, output ONLY a single JSON object and nothing else — no markdown, no prose — with exactly this shape: {"found":boolean,"confidence":"high"|"medium"|"low","soldDate":string|null,"price":number|null,"pricePerSF":number|null,"capRate":number|null,"buyer":string|null,"seller":string|null,"summary":string,"sources":[{"title":string,"url":string}]}.';
    const user = `Find the eventual sale of this property:\n${JSON.stringify(idInfo, null, 2)}\n\nReturn ONLY the JSON object.`;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        model:"claude-sonnet-4-6", max_tokens:1500, system: sys,
        tools: [{ type:"web_search_20250305", name:"web_search" }],
        messages: [{ role:"user", content: user }]
      })
    });
    const data = await resp.json();
    const textOut = (data.content || []).filter(b => b.type==="text").map(b => b.text).join("\n").trim();
    try { return robustParseJSON(textOut); } catch { return null; }
  }
  function applySaleResult(id, res) {
    const ts = new Date().toISOString();
    const deal = deals.find(d => d.id === id);
    // Backstop: even if the model returns high confidence, drop a sale that
    // isn't dated after the OM — it's a prior/historical transaction, not the
    // eventual sale we're after.
    const relevant = !(res && res.soldDate) || _saleIsAfterOM(res.soldDate, deal?.omDate);
    const confirmed = !!(res && res.found && res.confidence === "high" && relevant);
    setDeals(prev => prev.map(d => {
      if (d.id !== id) return d;
      if (confirmed) {
        const ms = { soldDate:res.soldDate||null, price:res.price??null, pricePerSF:res.pricePerSF??null, capRate:res.capRate??null,
          buyer:res.buyer||null, seller:res.seller||null, summary:res.summary||"", sources:(res.sources||[]).slice(0,6), confidence:res.confidence, lookedUpAt:ts };
        const to = res.price ? `sold${res.soldDate?` ${res.soldDate}`:""} for $${Number(res.price).toLocaleString()}` : "confirmed sale found";
        return { ...d, marketSale: ms, marketSaleChecked: ts, editHistory:[...(d.editHistory||[]), { ts, by:"AI sale lookup", changes:[{ field:"marketSale", from:"\u2014", to }] }] };
      }
      return { ...d, marketSaleChecked: ts }; // record that we checked, even if nothing confident/relevant
    }));
    return confirmed;
  }
  async function runSaleLookup(idsIterable) {
    const ids = Array.from(idsIterable);
    if (!ids.length) return;
    if (ids.length >= 2 && !(await confirmTokens(`search the web for sales on ${ids.length} deals`, ids.length, true))) return;
    clearSelection();
    stopRef.current = false;
    setLookingUp(prev => new Set([...prev, ...ids]));
    let found = 0, none = 0, failed = 0;
    for (const id of ids) {
      if (stopRef.current) { setLookingUp(p => { const n = new Set(p); ids.forEach(x=>n.delete(x)); return n; }); break; }
      const deal = deals.find(d => d.id === id);
      if (!deal) { setLookingUp(p => { const n = new Set(p); n.delete(id); return n; }); continue; }
      try { if (applySaleResult(id, await lookupSale(deal))) found++; else none++; }
      catch { failed++; }
      setLookingUp(p => { const n = new Set(p); n.delete(id); return n; });
    }
    setNotice(`Sale lookup done — ${found} confirmed sale${found===1?"":"s"} added${none?`, ${none} with no confident match`:""}${failed?`, ${failed} failed`:""}.`);
  }

  // ── Trade-area demographics (1/3/5-mi population & avg HH income) ──
  // Uses web search to pull figures derived from the latest US Census ACS
  // 5-year estimates. Pragmatic (not a precise GIS computation) by design.
  async function lookupDemographics(deal) {
    const idInfo = { property: deal.propertyName, address: deal.address, market: deal.market, submarket: deal.submarket };
    const sys = 'You are a commercial real estate research assistant. Using web search, find the 1-, 3-, and 5-mile RADIUS demographics centered on the given property address: total POPULATION and AVERAGE household income for each ring. Prefer figures derived from the latest US Census American Community Survey (ACS) 5-year estimates (2020-2024 is the newest). Active listing pages (LoopNet, Crexi, broker sites) and demographic tools often publish these exact ring figures — use them when they clearly match this address/market. If precise ring figures are not available, give your best estimate from the most local ACS data you can find and explain that in "note", but lower the confidence accordingly. Average household income is preferred; if only MEDIAN is available, return it and say so in "note". Always state the data source and as-of vintage. Be reasonable and do not leave everything blank — an approximate, clearly-labeled estimate is useful — but never fabricate a precise-looking number you have no basis for. Output ONLY a single JSON object and nothing else — no markdown, no prose — with exactly this shape: {"found":boolean,"confidence":"high"|"medium"|"low","asOf":string|null,"source":string|null,"pop1mi":number|null,"pop3mi":number|null,"pop5mi":number|null,"avgHHI1mi":number|null,"avgHHI3mi":number|null,"avgHHI5mi":number|null,"note":string,"sources":[{"title":string,"url":string}]}.';
    const user = `Find 1/3/5-mile demographics for this property:\n${JSON.stringify(idInfo, null, 2)}\n\nReturn ONLY the JSON object.`;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        model:"claude-sonnet-4-6", max_tokens:1500, system: sys,
        tools: [{ type:"web_search_20250305", name:"web_search" }],
        messages: [{ role:"user", content: user }]
      })
    });
    const data = await resp.json();
    const textOut = (data.content || []).filter(b => b.type==="text").map(b => b.text).join("\n").trim();
    try { return robustParseJSON(textOut); } catch { return null; }
  }
  function applyDemographicsResult(id, res) {
    const ts = new Date().toISOString();
    const num = v => (v==null||v===""||isNaN(Number(v))) ? null : Number(v);
    const md = res ? {
      pop1mi:num(res.pop1mi), pop3mi:num(res.pop3mi), pop5mi:num(res.pop5mi),
      avgHHI1mi:num(res.avgHHI1mi), avgHHI3mi:num(res.avgHHI3mi), avgHHI5mi:num(res.avgHHI5mi),
      source:res.source||null, asOf:res.asOf||null, note:res.note||"", confidence:res.confidence||"low",
      sources:(res.sources||[]).slice(0,6), lookedUpAt:ts
    } : null;
    const has = md && [md.pop1mi,md.pop3mi,md.pop5mi,md.avgHHI1mi,md.avgHHI3mi,md.avgHHI5mi].some(v=>v!=null);
    setDeals(prev => prev.map(d => {
      if (d.id !== id) return d;
      if (has) {
        const to = md.pop3mi!=null ? `${md.pop3mi.toLocaleString()} pop (3mi)` : "demographics pulled";
        return { ...d, marketDemographics: md, demoChecked: ts, editHistory:[...(d.editHistory||[]), { ts, by:"AI demographics", changes:[{ field:"marketDemographics", from:"\u2014", to }] }] };
      }
      return { ...d, demoChecked: ts };
    }));
    return has;
  }
  async function runDemographicsLookup(idsIterable) {
    const ids = Array.from(idsIterable);
    if (!ids.length) return;
    if (ids.length >= 2 && !(await confirmTokens(`pull web demographics for ${ids.length} deals`, ids.length, true))) return;
    clearSelection();
    stopRef.current = false;
    setGettingDemo(prev => new Set([...prev, ...ids]));
    let got = 0, none = 0, failed = 0;
    for (const id of ids) {
      if (stopRef.current) { setGettingDemo(p => { const n = new Set(p); ids.forEach(x=>n.delete(x)); return n; }); break; }
      const deal = deals.find(d => d.id === id);
      if (!deal) { setGettingDemo(p => { const n = new Set(p); n.delete(id); return n; }); continue; }
      try { if (applyDemographicsResult(id, await lookupDemographics(deal))) got++; else none++; }
      catch { failed++; }
      setGettingDemo(p => { const n = new Set(p); n.delete(id); return n; });
    }
    setNotice(`Demographics done — ${got} pulled${none?`, ${none} with no data found`:""}${failed?`, ${failed} failed`:""}.`);
  }

  const filteredDeals = activeDeals.filter(d => {
    const q = search.toLowerCase();
    const matchQ = !q || [d.propertyName,d.address,d.market,d.broker,d.assetType,d.centerType,d.txnSeller,d.txnBuyer,d.debtLender,...(d.tenants||[]).map(t=>t.name)].some(f=>f?.toLowerCase().includes(q));
    const loc = classifyLocation(d);
    const matchDensity = filterDensity==="All" || loc.density?.tier===filterDensity;
    return matchQ
      && (filterAsset==="All"||d.assetType===filterAsset)
      && (filterStatus==="All"||d.status===filterStatus)
      && (filterCenter==="All"||d.centerType===filterCenter)
      && matchDensity;
  }).sort((a,b) => {
    const dir = sortDir==="asc" ? 1 : -1;
    const num = v => (v==null || v==="" || isNaN(Number(v))) ? null : Number(v);
    const gradeRank = { "A+":7,"A":6,"B+":5,"B":4,"C+":3,"C":2,"D":1 };
    let av, bv;
    switch (sortBy) {
      case "name":    av=(a.propertyName||a.fileName||"").toLowerCase(); bv=(b.propertyName||b.fileName||"").toLowerCase(); break;
      case "market":  av=(a.market||"").toLowerCase(); bv=(b.market||"").toLowerCase(); break;
      case "asking":  av=num(a.askingPrice); bv=num(b.askingPrice); break;
      case "cap":     av=num(a.capRate); bv=num(b.capRate); break;
      case "walt":    av=num(a.walt); bv=num(b.walt); break;
      case "occ":     av=num(a.occupancy); bv=num(b.occupancy); break;
      case "sf":      av=num(a.totalSF); bv=num(b.totalSF); break;
      case "score":   av=gradeRank[a.dealScore?.grade]||0; bv=gradeRank[b.dealScore?.grade]||0; break;
      case "status":  av=(a.status||"").toLowerCase(); bv=(b.status||"").toLowerCase(); break;
      case "recency":
      default:        av=new Date(a.omDate||a.uploadedAt||0).getTime(); bv=new Date(b.omDate||b.uploadedAt||0).getTime(); break;
    }
    // Nulls always sort to the bottom regardless of direction
    if (av==null && bv==null) return 0;
    if (av==null) return 1;
    if (bv==null) return -1;
    if (av<bv) return -1*dir;
    if (av>bv) return 1*dir;
    return 0;
  });

  function toggleSort(key) {
    if (sortBy===key) setSortDir(d => d==="asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDir(key==="name"||key==="market"||key==="status" ? "asc" : "desc"); }
  }

  const emerging = getEmergingFields(activeDeals);
  const stats = {
    total: activeDeals.length,
    fresh: activeDeals.filter(d => getRecency(d).tier==="Fresh").length,
    avgCap: (() => { const r = activeDeals.filter(d=>d.capRate&&getRecency(d).tier!=="Historical"); return r.length ? (r.reduce((s,d)=>s+d.capRate,0)/r.length).toFixed(2) : null; })(),
    avgWalt: (() => { const r = activeDeals.filter(d=>d.walt); return r.length ? (r.reduce((s,d)=>s+d.walt,0)/r.length).toFixed(1) : null; })(),
    tenantBrands: [...new Set(activeDeals.flatMap(d=>(d.tenants||[]).map(t=>t.name?.toLowerCase())).filter(Boolean))].length,
    volume: activeDeals.filter(d=>d.status!=="Passed").reduce((s,d)=>s+(d.askingPrice||0),0),
    // Data-volume brag metrics
    leases: activeDeals.reduce((s,d)=>s+((d.tenants||[]).length),0),
    sfAnalyzed: activeDeals.reduce((s,d)=>s+(Number(d.totalSF)||0),0),
    markets: [...new Set(activeDeals.map(d=>(d.market||"").trim().toLowerCase()).filter(Boolean))].length,
    cashflowYears: activeDeals.reduce((s,d)=>s+((d.cashFlowProjection||[]).length),0),
    dataPoints: (() => {
      let n = 0;
      const skip = k => k==="editHistory" || k==="images" || k.startsWith("_");
      const walk = o => { for (const k in o) { if (skip(k)) continue; const v=o[k]; if(v==null||v==="") continue; if(Array.isArray(v)) v.forEach(x=> (x&&typeof x==="object")?walk(x):((x!=null&&x!=="")&&n++)); else if(typeof v==="object") walk(v); else n++; } };
      activeDeals.forEach(walk);
      return n;
    })(),
  };

  // Owned portfolio snapshot (status === "Owned")
  const portfolio = (() => {
    const owned = activeDeals.filter(d=>d.status==="Owned");
    const n = v => (v==null||v===""||isNaN(Number(v))) ? 0 : Number(v);
    const tenants = owned.flatMap(d=>(d.tenants||[]));
    const anchors = [...new Set(tenants.filter(t=>t.isAnchor && t.name).map(t=>t.name.trim()))];
    const topByRent = tenants.filter(t=>t.name && n(t.annualRent)>0)
      .sort((a,b)=>n(b.annualRent)-n(a.annualRent)).slice(0,4);
    return {
      count: owned.length,
      value: owned.reduce((s,d)=>s + (n(d.txnPurchasePrice)||n(d.askingPrice)), 0),
      sf: owned.reduce((s,d)=>s + n(d.totalSF), 0),
      anchors, topByRent,
    };
  })();

  const T = active => ({ background:active?"#2a2c27":"transparent", border:"none", color:active?"#f6f2ea":"#8a8579", padding:"8px 17px", borderRadius:9, cursor:"pointer", fontSize:13.5, fontWeight:active?600:500, letterSpacing:"-0.01em", boxShadow:active?"0 6px 18px -8px rgba(42,44,39,0.6)":"none" });

  return (
    <div
      onDragOver={(e)=>{ e.preventDefault(); if(!dragging) setDragging(true); }}
      onDragLeave={(e)=>{ if(e.currentTarget===e.target) setDragging(false); }}
      onDrop={handleDrop}
      className="app-shell"
      style={{ fontFamily:"'Inter',-apple-system,sans-serif", height:"100vh", overflow:"hidden", color:"#383a37", display:"flex", flexDirection:"column", WebkitFontSmoothing:"antialiased" }}>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {/* STORAGE WARNING */}
      {storageError && (
        <div style={{ position:"fixed", top:78, left:"50%", transform:"translateX(-50%)", background:"#fef2f2", border:"1px solid #f3c6c0", borderRadius:10, padding:"12px 18px", zIndex:400, maxWidth:560, width:"90%", display:"flex", gap:12, alignItems:"flex-start", boxShadow:"0 8px 24px rgba(0,0,0,0.1)" }}>
          <span style={{ color:"#dc2626", fontSize:16 }}>⚠</span>
          <div style={{ flex:1, fontSize:13, color:"#7a2e22", lineHeight:1.5 }}>{storageError}</div>
          <button onClick={()=>setStorageError("")} style={{ background:"transparent", border:"none", color:"#b3766c", cursor:"pointer", fontSize:16, flexShrink:0 }}>✕</button>
        </div>
      )}

      {/* TOKEN-SPEND CONFIRMATION — gates costly Claude API actions */}
      {confirmGate && (
        <div onClick={()=>resolveConfirm(false)} style={{ position:"fixed", inset:0, background:"rgba(38,40,31,0.45)", zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, maxWidth:430, width:"100%", padding:"26px 26px 22px", boxShadow:"0 24px 60px rgba(38,40,31,0.28)", border:"1px solid #ece5d7" }}>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:19, color:"#26281f", fontWeight:600, marginBottom:10 }}>This will use API tokens</div>
            <div style={{ fontSize:13.5, color:"#6f6a5f", lineHeight:1.55, marginBottom:22 }}>{confirmGate.body}</div>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button onClick={()=>resolveConfirm(false)} style={{ background:"transparent", border:"1px solid #e3dccd", color:"#7d766a", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Cancel</button>
              <button onClick={()=>resolveConfirm(true)} style={{ background:"#2a2c27", border:"none", color:"#f6f2ea", padding:"9px 18px", borderRadius:9, cursor:"pointer", fontSize:13, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>Continue</button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div style={{ position:"fixed", top:78, left:"50%", transform:"translateX(-50%)", background:"#f0faf0", border:"1px solid #cfe9c4", borderRadius:10, padding:"12px 18px", zIndex:400, maxWidth:560, width:"90%", display:"flex", gap:12, alignItems:"flex-start", boxShadow:"0 8px 24px rgba(0,0,0,0.1)" }}>
          <span style={{ color:"#0f9d63", fontSize:16 }}>✓</span>
          <div style={{ flex:1, fontSize:13, color:"#1f5130", lineHeight:1.5 }}>{notice}</div>
          <button onClick={()=>setNotice("")} style={{ background:"transparent", border:"none", color:"#5a9a6f", cursor:"pointer", fontSize:16, flexShrink:0 }}>✕</button>
        </div>
      )}

      {/* UNDO TOAST — quick reversal of a soft-delete */}
      {undoBuf && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", zIndex:450, background:"#383a37", color:"#fff", borderRadius:10, padding:"11px 16px", display:"flex", alignItems:"center", gap:14, boxShadow:"0 10px 30px rgba(0,0,0,0.28)" }}>
          <span style={{ fontSize:13 }}>{undoBuf.label}</span>
          <button onClick={undoDelete} style={{ background:"transparent", border:"1px solid #6dba43", color:"#9bdc6f", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>UNDO</button>
          <button onClick={()=>setUndoBuf(null)} style={{ background:"transparent", border:"none", color:"#a69e91", cursor:"pointer", fontSize:15 }}>✕</button>
        </div>
      )}

      {/* TRASH MODAL — recoverable soft-deleted deals */}
      {trashOpen && (
        <div onClick={()=>{ setTrashOpen(false); setPurgeConfirm(null); setEmptyConfirm(false); }} style={{ position:"fixed", inset:0, zIndex:460, background:"rgba(56,58,55,0.5)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:14, width:"100%", maxWidth:560, maxHeight:"80vh", overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:"0 24px 64px rgba(0,0,0,0.3)" }}>
            <div style={{ padding:"16px 20px", borderBottom:"1px solid #ebe4d6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:700, color:"#383a37" }}>Trash · {trashedDeals.length}</div>
              <button onClick={()=>{ setTrashOpen(false); setPurgeConfirm(null); setEmptyConfirm(false); }} style={{ background:"transparent", border:"none", color:"#a69e91", cursor:"pointer", fontSize:18 }}>✕</button>
            </div>
            <div style={{ overflowY:"auto", flex:1 }}>
              {trashedDeals.length===0 ? (
                <div style={{ padding:"32px 20px", textAlign:"center", color:"#a69e91", fontSize:13 }}>Trash is empty.</div>
              ) : trashedDeals.map(d => (
                <div key={d.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 20px", borderBottom:"1px solid #f1eadc" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:"#383a37", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{d.propertyName||d.fileName||"Untitled deal"}</div>
                    <div style={{ fontSize:11, color:"#a69e91" }}>{d.market||d.address||"—"}{d.deletedAt?` · deleted ${d.deletedAt.slice(0,10)}`:""}</div>
                  </div>
                  <button onClick={()=>restoreDeal(d.id)} style={{ background:"transparent", border:"1px solid #6dba43", color:"#3f7a1f", padding:"5px 11px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif", flexShrink:0 }}>Restore</button>
                  {purgeConfirm===d.id
                    ? <button onClick={()=>purgeDeal(d.id)} style={{ background:"#dc2626", border:"none", color:"#fff", padding:"5px 11px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif", flexShrink:0 }}>Delete forever</button>
                    : <button onClick={()=>setPurgeConfirm(d.id)} style={{ background:"transparent", border:"1px solid #e6b3ad", color:"#c0392b", padding:"5px 11px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif", flexShrink:0 }}>Delete</button>}
                </div>
              ))}
            </div>
            {trashedDeals.length>0 && (
              <div style={{ padding:"12px 20px", borderTop:"1px solid #ebe4d6", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:11, color:"#a69e91", lineHeight:1.4 }}>Restored deals return to your portfolio. Permanent deletes can't be undone.</span>
                {emptyConfirm
                  ? <button onClick={emptyTrash} style={{ background:"#dc2626", border:"none", color:"#fff", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"'Inter',sans-serif", flexShrink:0 }}>Confirm empty</button>
                  : <button onClick={()=>setEmptyConfirm(true)} style={{ background:"transparent", border:"1px solid #e6b3ad", color:"#c0392b", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif", flexShrink:0 }}>Empty trash</button>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DRAG OVERLAY */}
      {dragging && (
        <div style={{ position:"fixed", inset:0, zIndex:500, background:"rgba(56,58,55,0.55)", backdropFilter:"blur(2px)", display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
          <div style={{ background:"#ffffff", border:"2px dashed #6dba43", borderRadius:16, padding:"48px 64px", textAlign:"center", boxShadow:"0 24px 64px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize:40, marginBottom:8 }}>📁</div>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:600, color:"#383a37" }}>Drop your OMs to import</div>
            <div style={{ fontSize:13, color:"#8b9aa8", marginTop:6 }}>Folders and multiple PDFs supported</div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{ borderBottom:"1px solid #e7e0d2", background:"rgba(252,250,245,0.86)", backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)", padding:"0 30px", display:"flex", alignItems:"center", justifyContent:"space-between", height:72, flexShrink:0, position:"sticky", top:0, zIndex:100, boxShadow:"0 8px 28px -22px rgba(56,58,55,0.55)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:30 }}>
          <div style={{ display:"flex", alignItems:"center", gap:13 }}>
            <img src="https://kprcenters.com/wp-content/uploads/2018/11/KPR_logo_cmyk.png" alt="KPR Centers"
              style={{ height:30, width:"auto", display:"block" }}
              onError={(e)=>{ e.currentTarget.style.display="none"; e.currentTarget.nextSibling.style.display="flex"; }}/>
            <div style={{ display:"none", alignItems:"center", gap:9 }}>
              <div style={{ width:8, height:8, background:"#6dba43", borderRadius:"50%", boxShadow:"0 0 0 3px #6dba4326" }}/>
              <span style={{ fontFamily:"'Fraunces',serif", fontWeight:600, fontSize:19, color:"#2a2c27", letterSpacing:"-0.01em" }}>KPR Centers</span>
            </div>
            <span style={{ fontSize:9.5, color:"#958d80", letterSpacing:"0.22em", borderLeft:"1px solid #e3dccd", paddingLeft:13, fontWeight:600, textTransform:"uppercase" }}>Deal Intelligence</span>
          </div>
          <div style={{ display:"flex", gap:2 }}>
            <button style={T(tab==="analyst")} onClick={()=>setTab("analyst")}>Analyst</button>
            <button style={T(["database","detail","compare"].includes(tab))} onClick={()=>setTab("database")}>Portfolio {activeDeals.length>0&&`(${activeDeals.length})`}</button>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:13 }}>
          {emerging.length>0 && <span className="hdr-stats" style={{ fontSize:11, color:"#3f6b24", background:"#6dba431f", border:"1px solid #6dba4338", padding:"4px 11px", borderRadius:20, fontWeight:600 }}>↑ {emerging.length} emerging metrics</span>}
          <span className="hdr-stats" style={{ fontSize:11, color:"#a69e91", letterSpacing:"0.02em" }}>{stats.fresh} fresh · {stats.tenantBrands} brands · {stats.total} deals</span>
          <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display:"none" }} onChange={handleFiles}/>
          <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple style={{ display:"none" }} onChange={handleFiles}/>
          <input ref={rerunRef} type="file" accept=".pdf" multiple style={{ display:"none" }} onChange={handleRerunFiles}/>
          <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display:"none" }} onChange={handleRestore}/>
          {trashedDeals.length>0 && (
            <button onClick={()=>setTrashOpen(true)} title="Recently deleted (recoverable)"
              style={{ background:"#ffffff", border:"1px solid #ddd4c2", color:"#52554e", padding:"8px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>
              Trash ({trashedDeals.length})
            </button>
          )}
          <div style={{ position:"relative" }}>
            <button onClick={()=>setBackupMenu(m=>!m)} title="Backup & export"
              style={{ background:"#ffffff", border:"1px solid #ddd4c2", color:"#52554e", padding:"8px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, display:"flex", alignItems:"center", gap:6 }}>
              Backup <span style={{ fontSize:9, color:"#a69e91" }}>▾</span>
            </button>
            {backupMenu && (
              <>
                <div onClick={()=>setBackupMenu(false)} style={{ position:"fixed", inset:0, zIndex:40 }}/>
                <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, zIndex:41, background:"#ffffff", border:"1px solid #e6dfd0", borderRadius:10, boxShadow:"0 8px 28px rgba(56,58,55,0.16)", width:248, overflow:"hidden" }}>
                  <button onClick={exportBackup} style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", borderBottom:"1px solid #f1eadc", padding:"12px 14px", cursor:"pointer", fontSize:13 }}>
                    <div style={{ fontWeight:600, color:"#383a37" }}>Download full backup</div>
                    <div style={{ fontSize:11, color:"#a69e91", marginTop:2 }}>Everything, re-importable (.json)</div>
                  </button>
                  <button onClick={exportCSV} style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", borderBottom:"1px solid #f1eadc", padding:"12px 14px", cursor:"pointer", fontSize:13 }}>
                    <div style={{ fontWeight:600, color:"#383a37" }}>Export spreadsheet</div>
                    <div style={{ fontSize:11, color:"#a69e91", marginTop:2 }}>Key fields for Excel (.csv)</div>
                  </button>
                  <button onClick={()=>{ setBackupMenu(false); restoreRef.current?.click(); }} style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"12px 14px", cursor:"pointer", fontSize:13 }}>
                    <div style={{ fontWeight:600, color:"#383a37" }}>Restore from backup</div>
                    <div style={{ fontSize:11, color:"#a69e91", marginTop:2 }}>Merge a .json backup file</div>
                  </button>
                </div>
              </>
            )}
          </div>
          <span style={{ width:1, height:24, background:"#e3dccd", margin:"0 4px" }}/>
          <div style={{ position:"relative", display:"flex", borderRadius:8, boxShadow:"0 1px 3px rgba(109,186,67,0.4)" }}>
            <button onClick={()=>fileRef.current?.click()} style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"8px 16px", borderRadius:"8px 0 0 8px", cursor:"pointer", fontSize:12, fontWeight:700 }}>
              Upload OMs
            </button>
            <button onClick={()=>setUploadMenu(m=>!m)} title="More upload options" style={{ background:"#6dba43", border:"none", borderLeft:"1px solid rgba(31,43,22,0.22)", color:"#1f2b16", padding:"8px 9px", borderRadius:"0 8px 8px 0", cursor:"pointer", fontSize:10, fontWeight:700 }}>▾</button>
            {uploadMenu && (
              <>
                <div onClick={()=>setUploadMenu(false)} style={{ position:"fixed", inset:0, zIndex:40 }}/>
                <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, zIndex:41, background:"#ffffff", border:"1px solid #e6dfd0", borderRadius:10, boxShadow:"0 8px 28px rgba(56,58,55,0.16)", width:230, overflow:"hidden" }}>
                  <button onClick={()=>{ setUploadMenu(false); fileRef.current?.click(); }} style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", borderBottom:"1px solid #f1eadc", padding:"11px 14px", cursor:"pointer", fontSize:13 }}>
                    <div style={{ fontWeight:600, color:"#383a37" }}>Upload files…</div>
                    <div style={{ fontSize:11, color:"#a69e91", marginTop:2 }}>Pick one or more PDFs</div>
                  </button>
                  <button onClick={()=>{ setUploadMenu(false); folderRef.current?.click(); }} style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"11px 14px", cursor:"pointer", fontSize:13 }}>
                    <div style={{ fontWeight:600, color:"#383a37" }}>Import a folder…</div>
                    <div style={{ fontSize:11, color:"#a69e91", marginTop:2 }}>Scan a whole folder of OMs</div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* BATCH UPLOAD QUEUE */}
      {queueOpen && queue.length > 0 && (() => {
        const done = queue.filter(q=>q.status==="done").length;
        const failed = queue.filter(q=>q.status==="error").length;
        const working = queue.filter(q=>q.status==="pending"||q.status==="processing").length;
        const pct = queue.length ? Math.round(((done+failed)/queue.length)*100) : 0;
        return (
        <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#ffffff", borderTop:"1px solid #ebe4d6", zIndex:200, maxHeight:"60vh", display:"flex", flexDirection:"column", boxShadow:"0 -12px 48px rgba(56,58,55,0.12)" }}>
          <div style={{ padding:"16px 28px 12px", borderBottom:"1px solid #f1eadc" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:14 }}>
                <span style={{ fontFamily:"'Fraunces',serif", fontWeight:600, fontSize:17, color:"#383a37" }}>Importing OMs</span>
                <span style={{ fontSize:12, color:"#a69e91" }}>
                  <span style={{color:"#0f9d63",fontWeight:600}}>{done} done</span>
                  {failed>0 && <> · <span style={{color:"#dc2626",fontWeight:600}}>{failed} failed</span></>}
                  {working>0 && <> · {working} remaining</>}
                </span>
              </div>
              <div style={{ display:"flex", gap:8 }}>
                {working>0 && (
                  <button onClick={stopAll}
                    style={{ background:"#fff5f5", border:"1px solid #f0b9b9", color:"#b91c1c", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                    ■ Stop
                  </button>
                )}
                {failed>0 && working===0 && (
                  <button onClick={retryFailed}
                    style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:700 }}>
                    Retry {failed} failed
                  </button>
                )}
                {(done||failed)>0 && (
                  <button onClick={()=>setQueue(q=>q.filter(it=>it.status==="pending"||it.status==="processing"))}
                    style={{ background:"transparent", border:"1px solid #e3dccd", color:"#837c6e", padding:"6px 12px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:500 }}>
                    Clear completed
                  </button>
                )}
                <button onClick={()=>setQueueOpen(false)}
                  style={{ background:"transparent", border:"1px solid #e3dccd", color:"#837c6e", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:500 }}>
                  Hide
                </button>
              </div>
            </div>
            {/* Aggregate progress bar */}
            <div style={{ height:6, background:"#efe8da", borderRadius:4, overflow:"hidden" }}>
              <div style={{ width:`${pct}%`, height:"100%", background:working>0?"#6dba43":failed>0?"#dc2626":"#0f9d63", borderRadius:4, transition:"width 0.4s ease" }}/>
            </div>
          </div>
          <div style={{ overflowY:"auto", padding:"4px 0" }}>
            {queue.map(item => {
              const color = item.status==="done" ? "#0f9d63" : item.status==="error" ? "#dc2626" : item.status==="processing" ? "#6dba43" : "#b3bac1";
              return (
                <div key={item.id} style={{ padding:"11px 28px", borderBottom:"1px solid #f4f6f7", display:"flex", gap:14, alignItems:"flex-start" }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:color, marginTop:5, flexShrink:0, animation: item.status==="processing"?"pulse 1.2s infinite":"none" }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, color:"#383a37", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.name}</div>
                    <div style={{ fontSize:12, color, marginTop:2, lineHeight:1.5, wordBreak:"break-word" }}>{item.msg}</div>
                    {(item.status==="processing" || (item.status==="pending")) && (
                      <div style={{ marginTop:7, display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ flex:1, height:5, background:"#efe8da", borderRadius:3, overflow:"hidden" }}>
                          <div style={{ width:`${item.progress||0}%`, height:"100%", background:"#6dba43", borderRadius:3, transition:"width 0.4s ease" }}/>
                        </div>
                        <span style={{ fontSize:10, color:"#a69e91", fontWeight:600, minWidth:30, textAlign:"right" }}>{item.progress||0}%</span>
                      </div>
                    )}
                    {item.error && <div style={{ fontSize:11, color:"#c0563b", marginTop:3, lineHeight:1.4, wordBreak:"break-word" }}>{item.error}</div>}
                  </div>
                  {item.status==="done" && item.deal && (
                    <button onClick={()=>{ setSelectedDeal(item.deal); setTab("detail"); setQueueOpen(false); }}
                      style={{ background:"#f3f5f6", border:"none", color:"#52554e", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, flexShrink:0 }}>
                      View
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
        </div>
        );
      })()}

      {/* Show-queue pill when hidden but still working */}
      {!queueOpen && queue.some(q=>q.status==="pending"||q.status==="processing") && (
        <button onClick={()=>setQueueOpen(true)}
          style={{ position:"fixed", bottom:20, right:20, background:"#6dba43", border:"none", color:"#383a37", padding:"10px 16px", borderRadius:8, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"'Inter',sans-serif", zIndex:200, boxShadow:"0 4px 16px rgba(0,0,0,0.2)" }}>
          ⏳ Processing {queue.filter(q=>q.status==="pending"||q.status==="processing").length}…
        </button>
      )}

      {/* LINK MODAL */}
      {linkModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(10,14,23,0.92)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:90 }}>
          <div style={{ background:"#faf7f0", border:"1px solid #383a37", borderRadius:10, padding:26, maxWidth:440, width:"90%" }}>
            <div style={{ fontFamily:"'Fraunces',serif", fontWeight:800, fontSize:14, marginBottom:8 }}>Re-offering Detected</div>
            <p style={{ fontSize:12, color:"#7d766a", lineHeight:1.7, marginBottom:16 }}>
              <strong style={{color:"#383a37"}}>{linkModal.newDeal.propertyName}</strong> may be a new version of an existing deal. Link them for version comparison?
            </p>
            {linkModal.matches.map(m => (
              <div key={m.id} style={{ background:"#ffffff", border:"1px solid #e7e0d2", borderRadius:6, padding:"10px 14px", marginBottom:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:12, color:"#2a2c27", fontWeight:500 }}>{m.propertyName}</div>
                  <RecencyBadge deal={m} compact/>
                </div>
                <button onClick={()=>linkDeals(linkModal.newDeal, m)} style={{ background:"#6dba43", border:"none", color:"#383a37", padding:"5px 12px", borderRadius:4, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>LINK</button>
              </div>
            ))}
            <button onClick={()=>{ setLinkModal(null); setSelectedDeal(linkModal.newDeal); setTab("detail"); }}
              style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 12px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif", marginTop:4 }}>
              Skip — separate deal
            </button>
          </div>
        </div>
      )}

      {/* Duplicate caught on upload — resolve one at a time */}
      {dupQueue.length > 0 && (() => {
        const cur = dupQueue[0];
        const advance = () => setDupQueue(q => q.slice(1));
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(10,14,23,0.92)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:95, padding:16 }}>
            <div style={{ background:"#faf7f0", border:"1px solid #383a37", borderRadius:12, padding:24, maxWidth:480, width:"100%", maxHeight:"86vh", overflowY:"auto" }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontWeight:700, fontSize:15, color:"#26281f", marginBottom:6 }}>Possible duplicate{dupQueue.length>1?` (1 of ${dupQueue.length})`:""}</div>
              <p style={{ fontSize:12.5, color:"#6f6a5f", lineHeight:1.6, margin:"0 0 14px" }}>
                You just uploaded <strong style={{color:"#2a2c27"}}>{cur.newDeal.propertyName||cur.newDeal.fileName}</strong>, which looks like {cur.matches.length>1?"deals":"a deal"} already in your database:
              </p>
              {cur.matches.map(m => (
                <div key={m.id} style={{ background:"#fff", border:"1px solid #e7e0d2", borderRadius:8, padding:"10px 12px", marginBottom:8 }}>
                  <div style={{ fontSize:12.5, color:"#2a2c27", fontWeight:600 }}>{m.propertyName||m.fileName}</div>
                  <div style={{ fontSize:10.5, color:"#a69e91", marginBottom:8 }}>{m.address||""}{m.address?" · ":""}added {m.uploadedAt?new Date(m.uploadedAt).toLocaleDateString():"—"}</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    <button onClick={()=>{ updateExistingFromUpload(cur.newDeal, m.id); advance(); }}
                      style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"5px 11px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>Update this one</button>
                    <button onClick={()=>{ linkAsVersions(cur.newDeal, m); advance(); }}
                      style={{ background:"transparent", border:"1px solid #0d9488", color:"#0d9488", padding:"5px 11px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>Link as versions</button>
                  </div>
                </div>
              ))}
              <div style={{ display:"flex", gap:8, marginTop:12, justifyContent:"flex-end" }}>
                <button onClick={()=>{ discardNewDeal(cur.newDeal.id); advance(); }}
                  style={{ background:"transparent", border:"1px solid #6b4540", color:"#b5675c", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Discard upload</button>
                <button onClick={advance}
                  style={{ background:"#383a37", border:"none", color:"#f6f2ea", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Keep both separate</button>
              </div>
              <p style={{ fontSize:10, color:"#a69e91", margin:"12px 0 0", lineHeight:1.55 }}>
                <strong style={{color:"#7d766a"}}>Update</strong> refreshes the existing deal from this OM (keeps its status, notes & history). <strong style={{color:"#7d766a"}}>Link</strong> keeps both as one property's history (use for different years). <strong style={{color:"#7d766a"}}>Keep both</strong> leaves them as separate deals. <strong style={{color:"#7d766a"}}>Discard</strong> deletes this upload.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Bulk merge — pick the keeper, fold the rest in (extras to Trash) */}
      {mergeModal && (() => {
        const sel = deals.filter(d => mergeModal.ids.includes(d.id));
        return (
          <div style={{ position:"fixed", inset:0, background:"rgba(10,14,23,0.92)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:95, padding:16 }}>
            <div style={{ background:"#faf7f0", border:"1px solid #383a37", borderRadius:12, padding:24, maxWidth:520, width:"100%", maxHeight:"85vh", overflowY:"auto" }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontWeight:700, fontSize:15, color:"#26281f", marginBottom:4 }}>Merge {sel.length} deals into one</div>
              <p style={{ fontSize:11.5, color:"#b45309", lineHeight:1.55, margin:"0 0 14px" }}>
                Use this only for the <strong>same OM uploaded more than once</strong>. For the same property in different years, close this and use “Link as property” instead — merging would lose the year-by-year history.
              </p>
              <div style={{ fontSize:11, color:"#7d766a", marginBottom:8 }}>Choose the deal to keep — the others get folded into it and moved to Trash:</div>
              {sel.map(d => (
                <label key={d.id} style={{ display:"flex", alignItems:"center", gap:10, background:"#fff", border:"1px solid "+(mergeModal.keeperId===d.id?"#6dba43":"#e7e0d2"), borderRadius:8, padding:"10px 12px", marginBottom:8, cursor:"pointer" }}>
                  <input type="radio" name="mergeKeeper" checked={mergeModal.keeperId===d.id} onChange={()=>setMergeModal(m=>({...m, keeperId:d.id}))}/>
                  <div>
                    <div style={{ fontSize:12.5, color:"#2a2c27", fontWeight:600 }}>{d.propertyName||d.fileName}{mergeModal.keeperId===d.id && <span style={{ color:"#0f9d63", fontSize:10, marginLeft:6 }}>KEEP</span>}</div>
                    <div style={{ fontSize:10.5, color:"#a69e91" }}>{d.address||""}{d.address?" · ":""}{d.fileName||""} · added {d.uploadedAt?new Date(d.uploadedAt).toLocaleDateString():"—"}</div>
                  </div>
                </label>
              ))}
              <div style={{ display:"flex", gap:8, marginTop:8, justifyContent:"flex-end" }}>
                <button onClick={()=>setMergeModal(null)} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontFamily:"'Inter',sans-serif" }}>Cancel</button>
                <button onClick={()=>doMerge(mergeModal.keeperId, mergeModal.ids)} style={{ background:"#b45309", border:"none", color:"#fff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>Merge into the keeper</button>
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>

        {/* ── ANALYST ── */}
        {tab==="analyst" && (
          <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ padding:"18px 32px 8px", flexShrink:0 }}>
              {(() => {
                const fmtSF = v => v>=1e6 ? (v/1e6).toFixed(1)+"M" : v>=1e3 ? Math.round(v/1e3)+"K" : String(v);
                const fmtM = v => v>=1e6 ? "$"+(v/1e6).toFixed(1)+"M" : v>0 ? "$"+Math.round(v/1e3)+"K" : "—";
                const box = (l,v,c) => (
                  <div key={l} style={{ flex:"1 1 130px", background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"13px 16px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                    <div style={{ fontSize:10, letterSpacing:"0.06em", color:"#a69e91", marginBottom:6, fontWeight:500, textTransform:"uppercase" }}>{l}</div>
                    <div style={{ fontFamily:"'Fraunces',serif", fontSize:23, fontWeight:600, color:c||"#383a37", lineHeight:1 }}>{v}</div>
                  </div>
                );
                const panelLabel = { fontSize:9.5, letterSpacing:"0.18em", color:"#a89f8f", fontWeight:700, textTransform:"uppercase", marginBottom:9 };
                return (
                  <>
                    <div style={panelLabel}>Intelligence library — everything read into the system</div>
                    <div style={{ display:"flex", gap:11, flexWrap:"wrap", marginBottom:16 }}>
                      {box("OMs Read", stats.total||"—")}
                      {box("Tenant Brands", stats.tenantBrands?stats.tenantBrands.toLocaleString():"—", "#0f9d63")}
                      {box("Leases Analyzed", stats.leases?stats.leases.toLocaleString():"—")}
                      {box("SF Analyzed", stats.sfAnalyzed?fmtSF(stats.sfAnalyzed):"—")}
                      {box("Markets Covered", stats.markets||"—")}
                      {box("Data Points", stats.dataPoints?stats.dataPoints.toLocaleString():"—", "#0f9d63")}
                    </div>

                    <div style={panelLabel}>Owned portfolio</div>
                    {portfolio.count===0 ? (
                      <div style={{ background:"#faf7f0", border:"1px dashed #e3dccd", borderRadius:12, padding:"14px 16px", fontSize:12.5, color:"#9a917f" }}>
                        No owned properties yet — mark a deal as <span style={{ color:"#6dba43", fontWeight:600 }}>Owned</span> to build your portfolio snapshot here.
                      </div>
                    ) : (
                      <div style={{ display:"flex", gap:11, flexWrap:"wrap" }}>
                        {box("Properties", portfolio.count, "#6dba43")}
                        {box("Portfolio Value", fmtM(portfolio.value), "#6dba43")}
                        {box("Square Footage", portfolio.sf?fmtSF(portfolio.sf)+" SF":"—")}
                        <div style={{ flex:"2 1 220px", background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"13px 16px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                          <div style={{ fontSize:10, letterSpacing:"0.06em", color:"#a69e91", marginBottom:7, fontWeight:500, textTransform:"uppercase" }}>Key Anchors{portfolio.anchors.length?` · ${portfolio.anchors.length}`:""}</div>
                          {portfolio.anchors.length ? (
                            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                              {portfolio.anchors.slice(0,8).map(a=>(
                                <span key={a} style={{ fontSize:11, background:"#6dba4317", color:"#1f2b16", border:"1px solid #6dba4333", padding:"2px 8px", borderRadius:20, fontWeight:500 }}>{a}</span>
                              ))}
                              {portfolio.anchors.length>8 && <span style={{ fontSize:11, color:"#a69e91", alignSelf:"center" }}>+{portfolio.anchors.length-8}</span>}
                            </div>
                          ) : <div style={{ fontSize:13, color:"#c2b6a5" }}>—</div>}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", display:"flex", flexDirection:"column", gap:16 }}>
              {chatHistory.length===0 && (
                <>
                  <DealTiles deals={activeDeals} onOpen={(id)=>{ const dd = activeDeals.find(x=>x.id===id); if(dd){ setSelectedDeal(dd); setTab("detail"); } }}/>
                <div style={{ maxWidth:700, margin:"0 auto", width:"100%", animation:"riseIn .55s ease both", padding:"8px 0" }}>
                  <div style={{ fontSize:11, letterSpacing:"0.2em", textTransform:"uppercase", color:"#9a917f", fontWeight:700, marginBottom:18, display:"flex", alignItems:"center", gap:9 }}>
                    <span style={{ width:22, height:1, background:"#c9bfa9", display:"inline-block" }}/> KPR Deal Intelligence
                  </div>
                  <div style={{ fontFamily:"'Fraunces',serif", fontSize:46, fontWeight:500, color:"#26281f", marginBottom:16, lineHeight:1.05, letterSpacing:"-0.02em" }}>Ask anything about <span style={{ fontStyle:"italic", fontWeight:400 }}>your portfolio.</span></div>
                  <p style={{ color:"#6f6a5f", fontSize:15.5, marginBottom:22, lineHeight:1.7, maxWidth:560 }}>
                    {activeDeals.length===0 ? "Upload your offering memoranda to get started — I'll read each one and build your searchable portfolio." : `${activeDeals.length} deals loaded${stats.fresh>0?`, ${stats.fresh} fresh`:""}. I have full access to financials, WALT, rent bumps, demographics, comps, and more — and I can update deals for you on request.`}
                  </p>
                  {emerging.length>0 && (
                    <div style={{ background:"#ffffff", border:"1px solid #ece5d7", borderRadius:12, padding:"13px 16px", marginBottom:20, boxShadow:"0 12px 28px -24px rgba(56,58,55,0.5)" }}>
                      <div style={{ fontSize:9, color:"#a89f8f", letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, marginBottom:9 }}>↑ Emerging metrics — appearing across your deals</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                        {emerging.map(f => (
                          <span key={f.key} onClick={()=>sendMessage(`Tell me about the "${humanizeKey(f.key)}" metric (field "${f.key}") that appears across ${f.count} of my deals. What patterns do you see?`)}
                            style={{ background:"#f3eee3", color:"#6f6a5f", padding:"4px 10px", borderRadius:20, fontSize:10.5, cursor:"pointer", border:"1px solid #e7e0d2" }}
                            onMouseEnter={e=>{e.currentTarget.style.color="#2a2c27";e.currentTarget.style.borderColor="#6dba43"}}
                            onMouseLeave={e=>{e.currentTarget.style.color="#6f6a5f";e.currentTarget.style.borderColor="#e7e0d2"}}>
                            {humanizeKey(f.key)} ({f.count})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                </>
              )}

              {chatHistory.map((msg,i) => (
                <div key={i} style={{ maxWidth:760, width:"100%", margin:msg.role==="user"?"0 0 0 auto":"0 auto 0 0" }}>
                  {msg.role==="user"
                    ? <div style={{ background:"#383a37", borderRadius:"14px 14px 4px 14px", padding:"12px 18px", fontSize:14, color:"#ffffff", lineHeight:1.6, maxWidth:"80%", marginLeft:"auto", width:"fit-content" }}>{msg.content}</div>
                    : <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                        <div style={{ width:28, height:28, background:"#6dba43", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#1f2b16", flexShrink:0, marginTop:2 }}>AI</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:"4px 14px 14px 14px", padding:"16px 20px", boxShadow:"0 1px 3px rgba(56,58,55,0.05)" }}><Md text={msg.content}/></div>
                          {msg.actions && (
                            <div style={{ marginTop:10, background:"#fff", border:`1px solid ${msg.applied?"#cfe9c4":msg.discarded?"#e6dfd0":"#e7c48f"}`, borderRadius:10, padding:"12px 14px" }}>
                              <div style={{ fontSize:9, letterSpacing:"0.1em", fontWeight:700, marginBottom:9, color: msg.applied?"#0f9d63":msg.discarded?"#a69e91":"#b45309" }}>
                                {msg.applied ? "✓ CHANGES APPLIED" : msg.discarded ? "CHANGES DISCARDED" : `PROPOSED CHANGES — ${msg.actions.length}`}
                              </div>
                              {msg.actions.map((a,ai) => {
                                const cur = deals.find(x=>x.id===a.dealId) || {};
                                return (
                                  <div key={ai} style={{ padding:"7px 0", borderTop: ai>0?"1px solid #f1eadc":"none", opacity: msg.discarded?0.55:1 }}>
                                    <div style={{ fontSize:12, fontWeight:600, color:"#383a37" }}>{a.dealName}</div>
                                    {Object.entries(a.changes).map(([k,v]) => (
                                      <div key={k} style={{ fontSize:11, color:"#6f6a5f", marginTop:2 }}>
                                        {k}: <span style={{ color:"#a69e91" }}>{cur[k]!=null&&cur[k]!==""?(typeof cur[k]==="number"?cur[k].toLocaleString():String(cur[k]).slice(0,40)):"—"}</span> → <span style={{ color:"#383a37", fontWeight:600 }}>{typeof v==="number"?v.toLocaleString():String(v)}</span>
                                      </div>
                                    ))}
                                    {a.note && <div style={{ fontSize:10, color:"#a69e91", marginTop:2, fontStyle:"italic" }}>{a.note}</div>}
                                    {a.skipped?.length>0 && <div style={{ fontSize:10, color:"#b45309", marginTop:2 }}>Skipped unrecognized field(s): {a.skipped.join(", ")}</div>}
                                  </div>
                                );
                              })}
                              {!msg.applied && !msg.discarded && (
                                <div style={{ display:"flex", gap:8, marginTop:11 }}>
                                  <button onClick={()=>applyAnalystEdits(i)} style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"7px 16px", borderRadius:7, cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>Apply{msg.actions.length>1?" all":""}</button>
                                  <button onClick={()=>discardAnalystEdits(i)} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"7px 14px", borderRadius:7, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Discard</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                  }
                </div>
              ))}

              {thinking && (
                <div style={{ display:"flex", gap:12, alignItems:"flex-start", maxWidth:760 }}>
                  <div style={{ width:28, height:28, background:"#6dba43", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#1f2b16", flexShrink:0 }}>AI</div>
                  <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:"4px 14px 14px 14px", padding:"16px 20px", boxShadow:"0 1px 3px rgba(56,58,55,0.05)" }}>
                    <div style={{ display:"flex", gap:5 }}>
                      {[0,1,2].map(j=><div key={j} style={{ width:6, height:6, background:"#6dba43", borderRadius:"50%", animation:`pulse 1.1s ${j*0.2}s infinite` }}/>)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            <div style={{ borderTop:"1px solid #e7e0d2", padding:"14px 24px", flexShrink:0 }}>
              <div style={{ display:"flex", gap:8, maxWidth:720, margin:"0 auto" }}>
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); sendMessage(chatInput); }}}
                  disabled={thinking}
                  placeholder={activeDeals.length===0?"Upload OMs first…":"Ask about WALT, rent bumps, debt assumptions, demographics, comps, emerging metrics…"}
                  style={{ flex:1, background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:"13px 16px", color:"#383a37", fontSize:14, outline:"none", opacity:thinking?0.5:1, boxShadow:"0 1px 3px rgba(56,58,55,0.05)" }}/>
                <button onClick={()=>sendMessage(chatInput)} disabled={thinking||!chatInput.trim()}
                  style={{ background:(!thinking&&chatInput.trim())?"#6dba43":"#efe8da", border:"none", color:(!thinking&&chatInput.trim())?"#1f2b16":"#b3aa9b", padding:"13px 22px", borderRadius:10, cursor:(!thinking&&chatInput.trim())?"pointer":"default", fontSize:14, fontWeight:700 }}>
                  Send
                </button>
              </div>
              {chatHistory.length>0 && <div style={{ textAlign:"center", marginTop:8 }}><button onClick={()=>setChatHistory([])} style={{ background:"transparent", border:"none", color:"#958d80", fontSize:10, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>Clear conversation</button></div>}
            </div>
          </div>
        )}

        {/* ── DATABASE ── */}
        {tab==="database" && (
          <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
            <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search property, tenant, market, format…"
                style={{ flex:"1 1 240px", background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:"11px 16px", color:"#383a37", fontSize:14, outline:"none", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}/>
              <select value={filterAsset} onChange={e=>setFilterAsset(e.target.value)} style={{ background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:"11px 14px", color:"#383a37", fontSize:13, outline:"none", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                {ASSET_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
              <select value={filterCenter} onChange={e=>setFilterCenter(e.target.value)} style={{ background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:"11px 14px", color:"#383a37", fontSize:13, outline:"none", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                {CENTER_TYPES.map(t=><option key={t} value={t}>{t==="All"?"All formats":t}</option>)}
              </select>
              <select value={filterDensity} onChange={e=>setFilterDensity(e.target.value)} style={{ background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:"11px 14px", color:"#383a37", fontSize:13, outline:"none", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                {["All","Dense Urban","Urban","Suburban","Light Suburban","Thin / Rural"].map(t=><option key={t} value={t}>{t==="All"?"All densities":t}</option>)}
              </select>
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{ background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:"11px 14px", color:"#383a37", fontSize:13, outline:"none", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                {["All",...STATUS_OPTS].map(s=><option key={s}>{s}</option>)}
              </select>
              <select value={`${sortBy}:${sortDir}`} onChange={e=>{ const [k,dir]=e.target.value.split(":"); setSortBy(k); setSortDir(dir); }}
                style={{ background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:"11px 14px", color:"#383a37", fontSize:13, outline:"none", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                <option value="recency:desc">Sort: Newest data</option>
                <option value="recency:asc">Sort: Oldest data</option>
                <option value="name:asc">Sort: Property A–Z</option>
                <option value="name:desc">Sort: Property Z–A</option>
                <option value="asking:desc">Sort: Asking ↓</option>
                <option value="asking:asc">Sort: Asking ↑</option>
                <option value="cap:desc">Sort: Cap rate ↓</option>
                <option value="cap:asc">Sort: Cap rate ↑</option>
                <option value="walt:desc">Sort: WALT ↓</option>
                <option value="occ:desc">Sort: Occupancy ↓</option>
                <option value="sf:desc">Sort: Size (SF) ↓</option>
                <option value="score:desc">Sort: Score ↓</option>
                <option value="status:asc">Sort: Status</option>
              </select>
            </div>
            {(() => {
              const active = search || filterAsset!=="All" || filterStatus!=="All" || filterCenter!=="All" || filterDensity!=="All";
              return (
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:8 }}>
                  <span style={{ fontSize:12, color:"#a69e91" }}>
                    Showing <span style={{ color:"#383a37", fontWeight:600 }}>{filteredDeals.length}</span>{filteredDeals.length!==activeDeals.length ? ` of ${activeDeals.length}` : ""} {activeDeals.length===1?"property":"properties"}
                  </span>
                  {active && (
                    <button onClick={()=>{ setSearch(""); setFilterAsset("All"); setFilterStatus("All"); setFilterCenter("All"); setFilterDensity("All"); }}
                      style={{ background:"transparent", border:"1px solid #e3dccd", color:"#837c6e", padding:"5px 12px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:500 }}>
                      Clear filters
                    </button>
                  )}
                </div>
              );
            })()}
            {filteredDeals.length===0 ? (
              <div style={{ textAlign:"center", padding:"70px 0", color:"#958d80" }}>
                <div style={{ fontSize:32, marginBottom:10 }}>📁</div>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:14, fontWeight:700, color:"#6f6a5f", marginBottom:4 }}>{activeDeals.length===0?"No OMs yet":"No results"}</div>
                <div style={{ fontSize:11 }}>{activeDeals.length===0?"Upload your first OM to get started":"Try different filters"}</div>
              </div>
            ) : (
              <>
                {/* BULK ACTION BAR */}
                {selectedIds.size > 0 && (
                  <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", background:"#383a37", borderRadius:12, padding:"12px 18px", marginBottom:12, boxShadow:"0 4px 16px rgba(56,58,55,0.18)" }}>
                    <span style={{ color:"#ffffff", fontSize:13, fontWeight:600 }}>{selectedIds.size} selected</span>
                    <div style={{ width:1, height:20, background:"#55574f" }}/>

                    {/* Change status */}
                    <div style={{ position:"relative" }}>
                      <button onClick={()=>setBulkStatusOpen(o=>!o)}
                        style={{ background:"#52554e", border:"none", color:"#ffffff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>
                        Change status ▾
                      </button>
                      {bulkStatusOpen && (
                        <div style={{ position:"absolute", top:"110%", left:0, background:"#ffffff", border:"1px solid #e3dccd", borderRadius:10, padding:6, zIndex:50, boxShadow:"0 8px 24px rgba(0,0,0,0.15)", minWidth:150 }}>
                          {STATUS_OPTS.map(s=>(
                            <button key={s} onClick={()=>bulkChangeStatus(s)}
                              style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"8px 12px", borderRadius:6, cursor:"pointer", fontSize:13, color:STATUS_COLORS[s]||"#383a37", fontWeight:600 }}
                              onMouseEnter={e=>e.currentTarget.style.background="#f3f5f6"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Re-analyze from stored text (no upload) */}
                    <button onClick={reanalyzeSelected}
                      style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}
                      title="Re-run extraction using internally stored OM text — no re-upload needed">
                      Re-analyze
                    </button>

                    {/* Re-run from re-uploaded PDF */}
                    <button onClick={bulkRerun}
                      style={{ background:"#52554e", border:"none", color:"#ffffff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}
                      title="Re-extract from a freshly uploaded PDF (use for deals with no stored text, or an updated OM)">
                      Re-run from PDF
                    </button>

                    {/* Compare (exactly 2) */}
                    <button onClick={bulkCompare} disabled={selectedIds.size!==2}
                      style={{ background:selectedIds.size===2?"#52554e":"#44463f", border:"none", color:selectedIds.size===2?"#ffffff":"#80837a", padding:"7px 14px", borderRadius:8, cursor:selectedIds.size===2?"pointer":"default", fontSize:12, fontWeight:600 }}>
                      Compare
                    </button>

                    {/* Link as one property's version history (keeps every OM) */}
                    <button onClick={linkSelected} disabled={selectedIds.size<2}
                      title="Group the selected deals as ONE property's version history — keeps every OM. Use for the same property offered in different years."
                      style={{ background:selectedIds.size>=2?"#52554e":"#44463f", border:"none", color:selectedIds.size>=2?"#ffffff":"#80837a", padding:"7px 14px", borderRadius:8, cursor:selectedIds.size>=2?"pointer":"default", fontSize:12, fontWeight:600 }}>
                      Link as property
                    </button>

                    {/* Merge true duplicates into one (extras to Trash) */}
                    <button onClick={openMerge} disabled={selectedIds.size<2}
                      title="Combine TRUE duplicate uploads into one deal; the extras move to Trash. Don't use for different-year OMs — that would lose the history."
                      style={{ background:"transparent", border:"1px solid "+(selectedIds.size>=2?"#b45309":"#5a4a2e"), color:selectedIds.size>=2?"#e0a258":"#7a6a4e", padding:"7px 14px", borderRadius:8, cursor:selectedIds.size>=2?"pointer":"default", fontSize:12, fontWeight:600 }}>
                      Merge…
                    </button>

                    {/* Look up eventual sale online */}
                    <button onClick={()=>runSaleLookup(selectedIds)}
                      style={{ background:"#0d9488", border:"none", color:"#ffffff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}
                      title="Search the web for whether these properties have since sold, and record any confirmed sale">
                      Find sale
                    </button>
                    <button onClick={()=>runDemographicsLookup(selectedIds)}
                      style={{ background:"transparent", border:"1px solid #0d9488", color:"#0d9488", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}
                      title="Pull 1/3/5-mile population and average household income from public Census/ACS-based sources">
                      Pull demographics
                    </button>

                    {/* Delete */}
                    {confirmBulkDel ? (
                      <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ color:"#f3c6c0", fontSize:12 }}>Move {selectedIds.size} to trash?</span>
                        <button onClick={bulkDelete} style={{ background:"#dc2626", border:"none", color:"#fff", padding:"7px 12px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700 }}>Move to trash</button>
                        <button onClick={()=>setConfirmBulkDel(false)} style={{ background:"transparent", border:"1px solid #55574f", color:"#cfd1cb", padding:"7px 12px", borderRadius:8, cursor:"pointer", fontSize:12 }}>Cancel</button>
                      </span>
                    ) : (
                      <button onClick={()=>setConfirmBulkDel(true)}
                        style={{ background:"transparent", border:"1px solid #6b4540", color:"#f0a99f", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>
                        Delete
                      </button>
                    )}

                    <button onClick={clearSelection}
                      style={{ marginLeft:"auto", background:"transparent", border:"none", color:"#aeb1a9", cursor:"pointer", fontSize:12, fontWeight:500 }}>
                      Clear selection
                    </button>
                  </div>
                )}

                <div style={{ display:"grid", gridTemplateColumns:"32px 2fr 1fr 0.8fr 0.7fr 0.6fr 0.6fr 0.6fr 0.6fr 0.5fr 0.7fr", gap:8, padding:"4px 10px", fontSize:8, letterSpacing:"0.08em", color:"#958d80", marginBottom:3, alignItems:"center" }}>
                  <input type="checkbox" checked={filteredDeals.length>0 && filteredDeals.every(d=>selectedIds.has(d.id))}
                    onChange={selectAllFiltered} style={{ cursor:"pointer", width:14, height:14, accentColor:"#6dba43" }}/>
                  {[["PROPERTY","name"],["MARKET","market"],["TYPE",null],["ASKING","asking"],["CAP","cap"],["WALT","walt"],["OCC.","occ"],["SCORE","score"],["DATA","recency"],["STATUS","status"]].map(([h,key])=>(
                    <span key={h}
                      onClick={key?()=>toggleSort(key):undefined}
                      style={{ cursor:key?"pointer":"default", userSelect:"none", color: key&&sortBy===key ? "#383a37" : "#958d80", fontWeight: key&&sortBy===key ? 700 : 400, display:"flex", alignItems:"center", gap:2 }}>
                      {h}{key&&sortBy===key ? (sortDir==="asc"?" ↑":" ↓") : ""}
                    </span>
                  ))}
                </div>
                {filteredDeals.map(d => {
                  const r = getRecency(d);
                  const grouped = activeDeals.filter(x=>x.propertyGroupId&&x.propertyGroupId===d.propertyGroupId);
                  const sel = selectedIds.has(d.id);
                  return (
                    <div key={d.id} onClick={()=>{ setSelectedDeal(d); setTab("detail"); }}
                      style={{ display:"grid", gridTemplateColumns:"32px 2fr 1fr 0.8fr 0.7fr 0.6fr 0.6fr 0.6fr 0.6fr 0.5fr 0.7fr", gap:8, padding:"11px 12px", background:sel?"#eef7e8":"#ffffff", border:`1px solid ${sel?"#6dba43":"#ece5d7"}`, borderRadius:9, cursor:"pointer", fontSize:11, alignItems:"center", marginBottom:6, boxShadow: sel?"0 8px 22px -16px rgba(109,186,67,0.7)":"0 1px 2px rgba(56,58,55,0.03)", transition:"border-color .14s ease, box-shadow .14s ease, transform .14s ease" }}
                      onMouseEnter={e=>{ if(!sel){ e.currentTarget.style.borderColor=r.color; e.currentTarget.style.boxShadow="0 12px 26px -18px rgba(56,58,55,0.5)"; e.currentTarget.style.transform="translateY(-1px)"; } }}
                      onMouseLeave={e=>{ if(!sel){ e.currentTarget.style.borderColor="#ece5d7"; e.currentTarget.style.boxShadow="0 1px 2px rgba(56,58,55,0.03)"; e.currentTarget.style.transform="none"; } }}>
                      <input type="checkbox" checked={sel}
                        onClick={e=>e.stopPropagation()}
                        onChange={()=>toggleSelect(d.id)}
                        style={{ cursor:"pointer", width:14, height:14, accentColor:"#6dba43" }}/>
                      <div style={{ display:"flex", gap:11, alignItems:"center", minWidth:0 }}>
                        <RowThumb deal={d}/>
                        <div style={{ minWidth:0 }}>
                          <div style={{ color:"#2a2c27", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:1 }}>
                            {grouped.length>1&&<span style={{ fontSize:8, color:"#383a37", marginRight:4 }}>v{grouped.sort((a,b)=>new Date(a.omDate||a.uploadedAt)-new Date(b.omDate||b.uploadedAt)).findIndex(x=>x.id===d.id)+1}/{grouped.length} </span>}
                            {(() => { const a = assessExtraction(d); if (a.level==="complete") return null; return <span title={`Thin extraction — missing: ${a.missing.map(k=>_coreFieldLabel[k]||k).join(", ")}`} style={{ fontSize:8, fontWeight:700, color:a.level==="sparse"?"#dc2626":"#b45309", background:a.level==="sparse"?"#dc262618":"#b4530918", padding:"1px 4px", borderRadius:3, marginRight:5 }}>{a.level==="sparse"?"THIN":"PARTIAL"}</span>; })()}
                            {d.marketSale && <span title={`Confirmed sold${d.marketSale.soldDate?` ${d.marketSale.soldDate}`:""}${d.marketSale.buyer?` to ${d.marketSale.buyer}`:""}`} style={{ fontSize:8, fontWeight:700, color:"#0d9488", background:"#0d948818", padding:"1px 4px", borderRadius:3, marginRight:5 }}>SOLD{d.marketSale.price?` $${(d.marketSale.price/1e6).toFixed(1)}M`:""}</span>}
                            {d.propertyName||d.fileName}
                          </div>
                          <div style={{ color:"#958d80", fontSize:9, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.address?.split(",").slice(0,2).join(",")}</div>
                        </div>
                      </div>
                      <span style={{ color:"#5c5f57", fontSize:10 }}>
                        {d.market||"—"}
                        {(() => { const loc = classifyLocation(d); return loc.density ? <span style={{ display:"block", color:loc.density.color, fontSize:8, fontWeight:600 }}>{loc.density.tier}</span> : null; })()}
                      </span>
                      <span style={{ background:d.centerType?"#6dba4322":"#e7e0d2", padding:"1px 5px", borderRadius:3, color:d.centerType?"#2f5e1c":"#7d766a", fontSize:9, fontWeight:d.centerType?600:400, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {d.centerType ? d.centerType.replace("-Anchored"," Anch.").replace(" Center","").replace("Super-Regional","Super-Reg.") : (d.assetType||"—")}
                      </span>
                      <span style={{ color:"#6dba43" }}>{d.askingPrice?`$${(d.askingPrice/1e6).toFixed(1)}M`:"—"}</span>
                      <span style={{ color:"#0f9d63" }}>{d.capRate?`${d.capRate}%`:"—"}</span>
                      <span style={{ color:"#6dba43" }}>{d.walt?`${d.walt}yr`:"—"}</span>
                      <span style={{ color:"#383a37" }}>{d.occupancy?`${d.occupancy}%`:"—"}</span>
                      <ScoreBadge score={d.dealScore} size={10}/>
                      <span style={{ color:r.color, fontSize:9 }}>● {r.tier}</span>
                      <span style={{ color:STATUS_COLORS[d.status]||"#7d766a", fontSize:9 }}>{d.status||"—"}{d.autoPassed && <span title="Auto-passed after 4+ months as a prospect" style={{ color:"#b08968", fontSize:8, marginLeft:3, letterSpacing:"0.04em" }}>· AUTO</span>}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {tab==="detail"&&selectedDeal&&(
          <DetailView deal={selectedDeal} allDeals={activeDeals} editor={editor} onEditor={saveEditor} onToggleVerified={toggleVerified} onLookupSale={(id)=>runSaleLookup([id])} saleBusy={lookingUp.has(selectedDeal.id)} onGetDemo={(id)=>runDemographicsLookup([id])} demoBusy={gettingDemo.has(selectedDeal.id)} onBack={()=>setTab("database")} onDelete={deleteDeal} onUpdate={updateDeal}
            onCompare={(d1,d2)=>{ setCompareDeals([d1,d2]); setTab("compare"); }}
            onTenantClick={openTenant}
            onQuery={q=>{ setTab("analyst"); setTimeout(()=>sendMessage(q),100); }}/>
        )}
        {tab==="tenant"&&selectedTenant&&(
          <TenantView tenantName={selectedTenant} deals={activeDeals}
            onBack={()=>setTab(selectedDeal?"detail":"database")}
            onOpenDeal={(deal)=>{ setSelectedDeal(deal); setTab("detail"); }}/>
        )}
        {tab==="compare"&&compareDeals&&(
          <CompareView deals={compareDeals} onBack={()=>setTab("detail")}
            onQuery={q=>{ setTab("analyst"); setTimeout(()=>sendMessage(q),100); }}/>
        )}
      </div>

      <style>{`
        @keyframes pulse{0%,100%{opacity:0.3;transform:scale(0.8)}50%{opacity:1;transform:scale(1)}}
        @keyframes riseIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

        /* Warm, layered editorial background with a faint paper grain */
        .app-shell{
          position:relative;
          background:
            radial-gradient(1200px 600px at 12% -8%, #fbf8f1 0%, rgba(251,248,241,0) 60%),
            radial-gradient(1000px 700px at 100% 0%, #f2ede1 0%, rgba(242,237,225,0) 55%),
            linear-gradient(180deg, #f6f2ea 0%, #f1ece1 100%);
        }
        .app-shell::before{
          content:""; position:fixed; inset:0; z-index:0; pointer-events:none; opacity:0.5;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
        }
        .app-shell > *{ position:relative; z-index:1; }

        /* Header: tuck the context stats away on narrow screens so it stays tidy */
        @media (max-width: 920px){ .hdr-stats{ display:none !important; } }

        /* Typography defaults */
        h1,h2,h3{ letter-spacing:-0.015em; }
        body{ text-rendering:optimizeLegibility; -webkit-font-smoothing:antialiased; }

        /* Refined scrollbars */
        ::-webkit-scrollbar{width:9px;height:9px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#d8cfbd;border-radius:8px;border:2px solid transparent;background-clip:padding-box}
        ::-webkit-scrollbar-thumb:hover{background:#c7bca6;background-clip:padding-box}

        select option{background:#faf7f0;color:#383a37}
        a{ color:inherit; }
        ::selection{ background:#6dba4338; color:#2a2c27; }

        /* Gentle, designed interactions */
        button{ transition:transform .12s ease, box-shadow .15s ease, background-color .15s ease, border-color .15s ease, color .15s ease; }
        button:not(:disabled):active{ transform:translateY(1px); }
        input,select{ transition:border-color .15s ease, box-shadow .15s ease; }
        input:focus,select:focus{ box-shadow:0 0 0 3px #6dba431f; }
      `}</style>
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────
// ── Audit trail (item 4): turn a patch into human-readable change entries. ──
// Scalars are logged with from→to; objects/arrays are summarized so the log
// stays small and readable (we don't dump a 44-tenant array into history).
function _diffChanges(before, patch) {
  const out = [];
  const fmt = v => {
    if (v == null || v === "") return "\u2014";
    if (typeof v === "object") return Array.isArray(v) ? `${v.length} items` : "updated";
    const s = String(v);
    return s.length > 48 ? s.slice(0, 48) + "\u2026" : s;
  };
  for (const k of Object.keys(patch)) {
    if (k === "editHistory") continue;
    const a = before ? before[k] : undefined, b = patch[k];
    const same = (a && typeof a === "object") || (b && typeof b === "object")
      ? JSON.stringify(a) === JSON.stringify(b)
      : a === b;
    if (!same) out.push({ field: k, from: fmt(a), to: fmt(b) });
  }
  return out;
}

// ── Extraction quality (item 6): flag deals that came back thin, so a poor
// extraction doesn't quietly masquerade as a complete-but-sparse deal. Pure,
// deterministic — based on presence of the core fields a real OM should yield.
const _coreFieldLabel = { propertyName:"property name", address:"address", market:"market", capRate:"cap rate", noi:"NOI", totalSF:"total SF", occupancy:"occupancy", tenants:"tenant roster" };
function assessExtraction(d) {
  const core = {
    propertyName: !!d.propertyName,
    address: !!d.address,
    market: !!d.market,
    capRate: d.capRate != null,
    noi: d.noi != null,
    totalSF: d.totalSF != null,
    occupancy: d.occupancy != null,
    tenants: (d.tenants || []).length > 0,
  };
  const keys = Object.keys(core);
  const missing = keys.filter(k => !core[k]);
  const filled = keys.length - missing.length;
  const ratio = filled / keys.length;
  const level = ratio >= 0.78 ? "complete" : ratio >= 0.45 ? "partial" : "sparse";
  return { level, missing, filled, total: keys.length, tenantsTruncated: d._tenantsComplete === false };
}

// Banner shown on a deal when its extraction looks incomplete.
function ExtractionQuality({ deal }) {
  const a = assessExtraction(deal);
  if (a.level === "complete" && !a.tenantsTruncated) return null;
  const sparse = a.level === "sparse";
  const color = sparse ? "#dc2626" : "#b45309";
  const bg = sparse ? "#dc262610" : "#b4530910";
  const labels = a.missing.map(k => _coreFieldLabel[k] || k);
  return (
    <div style={{ background:bg, border:`1px solid ${color}40`, borderRadius:8, padding:"12px 16px", marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:(labels.length||a.tenantsTruncated)?7:0 }}>
        <span style={{ color, fontSize:14 }}>{sparse ? "\u26A0" : "\u25CB"}</span>
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", color }}>
          {sparse ? "THIN EXTRACTION — this deal came back nearly empty" : "PARTIAL EXTRACTION — some key fields are missing"}
        </span>
      </div>
      {labels.length > 0 && <div style={{ fontSize:11, color:"#6f6a5f", lineHeight:1.55 }}>Missing: {labels.join(", ")}.</div>}
      {a.tenantsTruncated && <div style={{ fontSize:11, color:"#6f6a5f", lineHeight:1.55, marginTop:2 }}>The tenant roster may be truncated (the OM was long) — some tenants could be missing.</div>}
      <div style={{ fontSize:10, color:"#a69e91", marginTop:7, lineHeight:1.5 }}>Heads up: this deal still appears in lists as if it were complete. Open the OM to fill the gaps, or re-analyze / re-upload it to try the extraction again.</div>
    </div>
  );
}

// ── Data integrity: deterministic sanity checks on the AI-extracted numbers. ──
// Pure math, no AI — so it runs instantly on every existing deal. It catches the
// classic extraction mistakes: a transposed rent ($5.15 vs $51.50), a cap rate
// that doesn't tie to NOI ÷ price, tenant SF that exceeds the building, etc.
// Each result is {severity:"error"|"warn", label, detail}. "error" = the math is
// impossible/contradictory; "warn" = worth a human glance before trusting it.
function reconcileDeal(d) {
  const checks = [];
  const add = (severity, label, detail) => checks.push({ severity, label, detail });
  const n = v => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const money = v => v == null ? "—" : "$" + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const reldiff = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);

  const price = n(d.askingPrice), noi = n(d.noi), cap = n(d.capRate);
  const sf = n(d.totalSF), ppsf = n(d.pricePerSF), occ = n(d.occupancy);
  const egi = n(d.effectiveGrossIncome), opex = n(d.operatingExpenses), expRatio = n(d.expenseRatio);
  const gpr = n(d.grossPotentialRent);
  const tenants = Array.isArray(d.tenants) ? d.tenants : [];

  // 1. Cap rate should equal NOI / price.
  if (price && noi && cap) {
    const implied = noi / price * 100;
    const diff = Math.abs(implied - cap);
    if (diff > 0.6) add("error", "Cap rate doesn't tie to NOI \u00F7 price",
      `Stated cap rate is ${cap}%, but NOI \u00F7 price implies ${implied.toFixed(2)}%. One of NOI (${money(noi)}), price (${money(price)}), or the cap rate is likely misread.`);
    else if (diff > 0.25) add("warn", "Cap rate slightly off from NOI \u00F7 price",
      `Stated ${cap}% vs. implied ${implied.toFixed(2)}% — a small gap worth a glance.`);
  }
  // 2. Price/SF should equal price / SF.
  if (price && sf && ppsf) {
    const implied = price / sf;
    if (reldiff(implied, ppsf) > 0.05) add("warn", "Price/SF doesn't tie to price \u00F7 SF",
      `Stated $${ppsf.toLocaleString()}/SF, but price \u00F7 SF = $${implied.toFixed(0)}/SF.`);
  }
  // 3. NOI should equal EGI − OpEx.
  if (egi && opex && noi) {
    const implied = egi - opex;
    if (reldiff(implied, noi) > 0.04) add("warn", "NOI doesn't tie to EGI \u2212 OpEx",
      `EGI ${money(egi)} \u2212 OpEx ${money(opex)} = ${money(implied)}, but NOI is stated as ${money(noi)}.`);
  }
  // 5. Occupancy must be a real percentage.
  if (occ != null && (occ < 0 || occ > 100)) add("error", "Occupancy is out of range",
    `Occupancy reads ${occ}% — it should be between 0 and 100.`);
  // 6. Cap rate sanity band (catches decimal/scale slips like 0.06 or 600).
  if (cap != null && (cap < 2 || cap > 15)) add("warn", "Cap rate is unusual",
    `${cap}% sits outside the typical 2–15% range — check for a decimal or scale error.`);

  // 7. Per-tenant rent integrity: annual rent should equal SF × rent/SF.
  const badRent = [];
  for (const t of tenants) {
    const tsf = n(t.sf), tr = n(t.rentPerSF), ta = n(t.annualRent);
    if (tsf && tr && ta) {
      const implied = tsf * tr;
      if (reldiff(implied, ta) > 0.10)
        badRent.push(`${t.name || "Unnamed"}: ${tsf.toLocaleString()} SF \u00D7 $${tr}/SF = ${money(implied)}, but rent shows ${money(ta)}`);
    }
  }
  if (badRent.length) add("error", `${badRent.length} tenant${badRent.length > 1 ? "s" : ""}: rent \u2260 SF \u00D7 rent/SF`,
    badRent.slice(0, 6).join("  \u00B7  ") + (badRent.length > 6 ? `  \u00B7  +${badRent.length - 6} more` : ""));

  // 8. Tenant SF vs. building SF.
  const tsfSum = tenants.reduce((s, t) => s + (n(t.sf) || 0), 0);
  if (sf && tsfSum > 0) {
    if (tsfSum > sf * 1.02) add("error", "Tenant SF exceeds building SF",
      `Tenant square footage sums to ${tsfSum.toLocaleString()} SF, but the building is only ${sf.toLocaleString()} SF.`);
    else if (occ != null && occ > 0 && tenants.length >= 3) {
      const impliedOcc = tsfSum / sf * 100;
      if (Math.abs(impliedOcc - occ) > 12) add("warn", "Tenant SF doesn't match stated occupancy",
        `Leased tenant SF is ${impliedOcc.toFixed(0)}% of the building, but occupancy is stated at ${occ}%.`);
    }
  }
  // 9. Tenant base rents shouldn't exceed gross potential rent.
  const taSum = tenants.reduce((s, t) => s + (n(t.annualRent) || 0), 0);
  if (gpr && taSum > 0 && taSum > gpr * 1.05) add("warn", "Tenant rents exceed gross potential rent",
    `Tenant annual rents sum to ${money(taSum)}, above the stated GPR of ${money(gpr)}.`);

  // 10. Tenant % of NOI should sum to roughly 100%.
  const pcts = tenants.map(t => n(t.percentOfNOI)).filter(v => v != null);
  if (pcts.length >= 3) {
    const sum = pcts.reduce((a, b) => a + b, 0);
    if (sum > 120 || sum < 70) add("warn", "Tenant % of NOI doesn't sum to ~100%",
      `The ${pcts.length} tenants with a % of NOI sum to ${sum.toFixed(0)}%.`);
  }

  const errors = checks.filter(c => c.severity === "error").length;
  const warns = checks.filter(c => c.severity === "warn").length;
  const hadData = !!(price || noi || cap || sf || tenants.length);
  return { checks, errors, warns, hadData };
}

// Collapsible panel that surfaces the reconciliation results on a deal.
function DataIntegrity({ deal }) {
  const [open, setOpen] = useState(false);
  const { checks, errors, warns, hadData } = reconcileDeal(deal);
  const C = { error: "#dc2626", warn: "#b45309", ok: "#0f9d63" };
  if (!hadData) return null;

  if (checks.length === 0) {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, background:"#0f9d6310", border:"1px solid #0f9d6333", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
        <span style={{ color:C.ok, fontSize:13 }}>{"\u2713"}</span>
        <span style={{ fontSize:11, color:"#0f6b46", fontWeight:500 }}>Data checks passed — the extracted numbers are internally consistent.</span>
        <span style={{ fontSize:9, color:"#958d80", marginLeft:"auto" }}>Still verify against the OM before deciding.</span>
      </div>
    );
  }

  const headColor = errors > 0 ? C.error : C.warn;
  const headBg = errors > 0 ? "#dc262610" : "#b4530910";
  const ordered = [...checks].sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
  return (
    <div style={{ background:headBg, border:`1px solid ${headColor}40`, borderRadius:8, padding:"12px 16px", marginBottom:12 }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", background:"transparent", border:"none", cursor:"pointer", padding:0, textAlign:"left" }}>
        <span style={{ color:headColor, fontSize:14 }}>{"\u26A0"}</span>
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", color:headColor }}>
          DATA INTEGRITY — {errors > 0 ? `${errors} error${errors > 1 ? "s" : ""}` : ""}{errors > 0 && warns > 0 ? ", " : ""}{warns > 0 ? `${warns} to verify` : ""}
        </span>
        <span style={{ marginLeft:"auto", fontSize:10, color:"#958d80", fontFamily:"'Inter',sans-serif" }}>{open ? "HIDE \u25B4" : "REVIEW \u25BE"}</span>
      </button>
      {open && (
        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
          {ordered.map((c, i) => (
            <div key={i} style={{ display:"flex", gap:10, padding:"8px 10px", background:"#ffffff", border:`1px solid ${C[c.severity]}33`, borderRadius:6 }}>
              <span style={{ color:C[c.severity], fontSize:9, fontWeight:700, letterSpacing:"0.05em", flexShrink:0, paddingTop:1 }}>{c.severity === "error" ? "ERROR" : "CHECK"}</span>
              <div>
                <div style={{ fontSize:11, color:"#383a37", fontWeight:600, marginBottom:2 }}>{c.label}</div>
                <div style={{ fontSize:11, color:"#6f6a5f", lineHeight:1.55 }}>{c.detail}</div>
              </div>
            </div>
          ))}
          <div style={{ fontSize:9, color:"#958d80", marginTop:2, lineHeight:1.5 }}>These are automated checks on the AI-extracted numbers — they flag likely misreads, not confirmed errors. Open the source OM to confirm before relying on a deal.</div>
        </div>
      )}
    </div>
  );
}

// Small lazily-loaded cover thumbnail for a portfolio list row.
function RowThumb({ deal }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true; setSrc(null);
    if (deal.imageMeta && deal.imageMeta.cover) {
      idbLoadImages(deal.id).then(r => { if (alive && r) setSrc(r.coverThumb || r.cover || null); }).catch(()=>{});
    }
    return () => { alive = false; };
  }, [deal.id]);
  return (
    <div style={{ width:48, height:40, borderRadius:7, overflow:"hidden", flexShrink:0, background:"#f1eadc", border:"1px solid #ece5d7", display:"flex", alignItems:"center", justifyContent:"center" }}>
      {src ? <img src={src} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
           : <span style={{ fontSize:12, color:"#cabfa7" }}>▦</span>}
    </div>
  );
}

// Decorative montage of property cover photos pulled from the portfolio.
function PortfolioMontage({ deals, onOpen }) {
  const withCover = deals.filter(d => d.imageMeta && d.imageMeta.cover).slice(0, 8);
  const [covers, setCovers] = useState([]);
  const key = withCover.map(d => d.id).join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(withCover.map(d => idbLoadImages(d.id)
      .then(r => (r && r.cover) ? { id:d.id, name:d.propertyName||d.fileName, market:d.market, src:r.cover } : null)
      .catch(()=>null)))
      .then(list => { if (alive) setCovers(list.filter(Boolean)); });
    return () => { alive = false; };
  }, [key]);
  if (covers.length < 2) return null;
  return (
    <div style={{ marginTop:36 }}>
      <div style={{ fontSize:10.5, letterSpacing:"0.16em", textTransform:"uppercase", color:"#a89f8f", fontWeight:700, marginBottom:13 }}>From your portfolio</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(148px, 1fr))", gap:12 }}>
        {covers.map(c => (
          <div key={c.id} onClick={()=>onOpen(c.id)}
            style={{ position:"relative", height:112, borderRadius:12, overflow:"hidden", cursor:"pointer", border:"1px solid #ece5d7", boxShadow:"0 10px 24px -20px rgba(56,58,55,0.6)", transition:"transform .25s ease, box-shadow .25s ease" }}
            onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow="0 18px 34px -20px rgba(56,58,55,0.65)"; e.currentTarget.firstChild.style.transform="scale(1.06)"; }}
            onMouseLeave={e=>{ e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="0 10px 24px -20px rgba(56,58,55,0.6)"; e.currentTarget.firstChild.style.transform="none"; }}>
            <img src={c.src} alt={c.name} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block", transition:"transform .45s ease" }}/>
            <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(38,40,31,0) 38%, rgba(38,40,31,0.66) 100%)" }}/>
            <div style={{ position:"absolute", left:11, right:11, bottom:9, color:"#fff" }}>
              <div style={{ fontSize:11.5, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
              {c.market && <div style={{ fontSize:9, opacity:0.82, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.market}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Best-effort "City, ST" from a deal — prefers explicit fields, then parses the
// street address (e.g. "…, Lewis Center, OH 43035" → "Lewis Center, OH"), then
// falls back to the metro market. Doesn't need to be exact.
function cityState(d) {
  if (d.city || d.state) return [d.city, d.state].filter(Boolean).join(", ");
  const a = (d.address || "").trim();
  if (a) {
    const parts = a.split(",").map(s => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const sm = last.match(/\b([A-Z]{2})\b/);
    const state = sm ? sm[1] : "";
    let city = parts.length >= 2 ? parts[parts.length - 2] : "";
    if (/^\d/.test(city) || /\b[A-Z]{2}\b\s*\d{5}/.test(city)) city = "";
    const out = [city, state].filter(Boolean).join(", ");
    if (out) return out;
  }
  return d.market || "";
}

// Combined deal tiles for the home screen: photo-backed cards (cover image when
// available) showing name + City, ST. Under Contract deals first, then Prospects
// to fill out the rows. Replaces the old separate tile grid + photo montage.
function DealTiles({ deals, onOpen }) {
  const recency = d => new Date(d.uploadedAt || 0).getTime();
  const uc = deals.filter(d => d.status === "Under Contract").sort((a,b)=>recency(b)-recency(a));
  const prospects = deals.filter(d => d.status === "Prospect").sort((a,b)=>recency(b)-recency(a));
  const tiles = [...uc, ...prospects].slice(0, 8);
  const [covers, setCovers] = useState({});
  const key = tiles.map(d => d.id).join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(tiles.map(d => idbLoadImages(d.id)
      .then(r => ({ id:d.id, src: r && (r.cover || r.coverThumb) }))
      .catch(() => ({ id:d.id, src:null }))))
      .then(list => { if (alive) { const m = {}; list.forEach(x => { if (x.src) m[x.id] = x.src; }); setCovers(m); } });
    return () => { alive = false; };
  }, [key]);
  if (!tiles.length) return null;
  return (
    <div style={{ marginBottom:26 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))", gap:13 }}>
        {tiles.map(d => {
          const sc = STATUS_COLORS[d.status] || "#7d766a";
          const loc = cityState(d);
          const src = covers[d.id];
          const noi = d.noi != null ? `$${(d.noi/1e6).toFixed(1)}M NOI` : null;
          return (
            <button key={d.id} onClick={()=>onOpen(d.id)}
              style={{ position:"relative", height:150, borderRadius:14, overflow:"hidden", cursor:"pointer", border:"1px solid #ece5d7", textAlign:"left", padding:0, boxShadow:"0 1px 2px rgba(56,58,55,0.05), 0 14px 30px -24px rgba(56,58,55,0.6)", background: src?"#26281f":"linear-gradient(135deg,#43463b,#26281f)", transition:"transform .2s ease" }}
              onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-3px)"; const img=e.currentTarget.querySelector("img"); if(img) img.style.transform="scale(1.06)"; }}
              onMouseLeave={e=>{ e.currentTarget.style.transform="none"; const img=e.currentTarget.querySelector("img"); if(img) img.style.transform="none"; }}>
              {src && <img src={src} alt="" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", transition:"transform .45s ease" }}/>}
              <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(38,40,31,0.10) 0%, rgba(38,40,31,0.32) 42%, rgba(38,40,31,0.84) 100%)" }}/>
              <div style={{ position:"absolute", top:11, left:12, display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.93)", padding:"3px 9px", borderRadius:20 }}>
                <span style={{ width:6, height:6, borderRadius:"50%", background:sc }}/>
                <span style={{ fontSize:9, letterSpacing:"0.05em", textTransform:"uppercase", color:sc, fontWeight:700 }}>{d.status||"\u2014"}</span>
                {d.autoPassed && <span style={{ fontSize:8, color:"#9a7b5a", fontWeight:700 }}>AUTO</span>}
              </div>
              <div style={{ position:"absolute", left:13, right:13, bottom:11, color:"#fff" }}>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:16.5, fontWeight:600, lineHeight:1.18, overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>{d.propertyName || d.fileName || "Untitled deal"}</div>
                {loc && <div style={{ fontSize:11, opacity:0.86, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{loc}</div>}
                {noi && <div style={{ fontSize:11, color:"#9fe08a", fontWeight:600, marginTop:3 }}>{noi}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Key assumptions / footnotes, collapsed to the top few so the section doesn't
// dominate the page. "Show N more" expands the rest.
function KeyAssumptions({ deal }) {
  const [expanded, setExpanded] = useState(false);
  const tenantNotes = (deal.tenants||[]).filter(t=>t.assumptionNote).map(t=>({ name:t.name, text:t.assumptionNote }));
  const dealNotes = Array.isArray(deal.keyAssumptions) ? deal.keyAssumptions.filter(Boolean).map(n=>({ text:n })) : (deal.keyAssumptions ? [{ text:deal.keyAssumptions }] : []);
  const all = [...dealNotes, ...tenantNotes];
  if (all.length === 0) return null;
  const LIMIT = 5;
  const shown = expanded ? all : all.slice(0, LIMIT);
  const hidden = all.length - LIMIT;
  return (
    <div style={{ background:"#fff8ec", border:"1px solid #e7c48f", borderLeft:"3px solid #d9890c", borderRadius:12, padding:"14px 18px", marginBottom:12 }}>
      <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#b45309", marginBottom:9 }}>⚑ Key Assumptions &amp; Footnotes</div>
      {shown.map((n,i)=>(
        <div key={i} style={{ fontSize:12.5, color:"#6b4a16", lineHeight:1.6, marginBottom:4 }}>•&nbsp; {n.name && <span style={{ fontWeight:600 }}>{n.name}: </span>}{n.text}</div>
      ))}
      {hidden > 0 && (
        <button onClick={()=>setExpanded(e=>!e)} style={{ marginTop:7, background:"transparent", border:"none", color:"#b45309", fontWeight:600, fontSize:12, cursor:"pointer", padding:0, fontFamily:"'Inter',sans-serif" }}>
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}

// Editable core metrics — opened from the detail page (handy when verifying that the
// extracted numbers match the OM). Uses the stable TxnField so edits commit on blur and
// route through onUpdate, landing in the deal's edit history (which also feeds the
// extraction "corrections memory" so future deals are extracted with more care).
function MetricsEditor({ deal, onUpdate }) {
  const [open, setOpen] = useState(false);
  const fields = [
    { field:"noi", label:"NOI", prefix:"$" },
    { field:"capRate", label:"Cap Rate", suffix:"%" },
    { field:"askingPrice", label:"Asking Price", prefix:"$" },
    { field:"totalSF", label:"Total SF", numeric:true },
    { field:"occupancy", label:"Occupancy", suffix:"%" },
    { field:"weightedAvgRentPSF", label:"Wtd Avg Rent / SF", prefix:"$" },
    { field:"walt", label:"WALT (yrs)", numeric:true },
    { field:"grossPotentialRent", label:"Gross Potential Rent", prefix:"$" },
    { field:"effectiveGrossIncome", label:"Effective Gross Income", prefix:"$" },
    { field:"operatingExpenses", label:"Operating Expenses", prefix:"$" },
    { field:"nnnRecoveries", label:"NNN Recoveries", prefix:"$" },
    { field:"yearBuilt", label:"Year Built", numeric:true },
    { field:"renovationYear", label:"Renovation Year", numeric:true },
    { field:"numberOfBuildings", label:"# Buildings", numeric:true },
    { field:"lotSizeAcres", label:"Lot Size (acres)", numeric:true },
  ];
  return (
    <div style={{ marginBottom:14 }}>
      <button onClick={()=>setOpen(o=>!o)}
        style={{ background:open?"#383a37":"transparent", color:open?"#f6f2ea":"#5c5f57", border:"1px solid "+(open?"#383a37":"#d8cfbd"), padding:"6px 13px", borderRadius:8, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
        {open ? "✕ Close metric editor" : "✎ Edit metrics"}
      </button>
      {open && (
        <div style={{ marginTop:11, background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"16px 18px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:11, color:"#9a917f", marginBottom:13, lineHeight:1.5 }}>
            Correct any figure that doesn't match the OM. Changes save automatically and are logged in this deal's edit history — and the fields you most often correct get flagged for extra care on future extractions.
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:13 }}>
            {fields.map(f => (
              <TxnField key={f.field} label={f.label} field={f.field} initial={deal[f.field]}
                prefix={f.prefix} suffix={f.suffix} numeric={f.numeric}
                dealId={deal.id} onUpdate={onUpdate}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Import a term sheet / loan term sheet / closing statement PDF on an owned deal and
// auto-fill BLANK acquisition & financing fields (never overwrites values you entered).
function TermSheetImport({ deal, onUpdate }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const SCHEMA = {
    txnPurchasePrice:"purchase price (number)", txnSeller:"seller / counterparty", txnCloseDate:"closing date YYYY-MM-DD",
    acqCapRate:"going-in cap rate %", acqNOIAtClose:"in-place NOI at close (number)", acqEntity:"acquiring entity / borrower",
    acqBroker:"broker", acqDeposit:"earnest money / deposit (number)", acqClosingCosts:"closing costs (number)", acqFee:"acquisition fee (number)",
    acqCounsel:"legal counsel", acqStrategy:"strategy (Core/Core-Plus/Value-Add/Opportunistic)", acqHoldPeriod:"target hold years", acqTargetIRR:"target IRR %",
    debtLender:"lender", debtType:"loan type", debtLoanAmount:"loan amount (number)", debtRate:"interest rate %", debtRateType:"Fixed or Floating",
    debtIndex:"floating index", debtSpread:"spread in bps (number)", debtOriginationDate:"origination date YYYY-MM-DD", debtMaturityDate:"maturity date YYYY-MM-DD",
    debtTermYears:"term years", debtAmortYears:"amortization years", debtIOPeriod:"interest-only months", debtLTV:"LTV %", debtRecourse:"recourse",
    debtPrepay:"prepayment terms", debtExtensions:"extension options", debtEscrows:"escrows / reserves", debtAssumable:"assumable", debtContact:"lender contact",
  };
  async function handle(e) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    setBusy(true); setStatus("Reading term sheet…");
    try {
      const { text } = await extractPdfText(file, null, false);
      setStatus("Extracting deal terms with AI…");
      const sys = `You extract acquisition and financing terms from a commercial real estate term sheet, loan term sheet, or closing statement. Output ONLY a single JSON object with exactly these keys; use null for anything not clearly stated. For money use plain numbers (no $ or commas); for percentages use numbers (6.25 not "6.25%"). Keys and meanings: ${JSON.stringify(SCHEMA)}`;
      const user = `Term sheet / closing document text:\n${(text||"").slice(0,60000)}\n\nReturn ONLY the JSON object, no prose.`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:1500, system: sys, messages:[{ role:"user", content:user }] })
      });
      const data = await resp.json();
      const raw = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
      let out = null; try { out = robustParseJSON(raw); } catch {}
      if (!out) { setStatus("Couldn't read terms from that PDF — try a clearer term sheet."); setBusy(false); return; }
      const patch = {};
      for (const k of Object.keys(SCHEMA)) {
        const v = out[k];
        if (v == null || v === "") continue;
        if (deal[k] != null && deal[k] !== "") continue; // only fill blanks; never overwrite your entries
        patch[k] = (NUMERIC_FIELDS.has(k) || NUMERIC_TXN_FIELDS.has(k)) && !isNaN(Number(v)) ? Number(v) : v;
      }
      const n = Object.keys(patch).length;
      if (n) onUpdate(deal.id, patch);
      setStatus(n ? `✓ Filled ${n} blank field${n>1?"s":""} from the term sheet — review and verify each before relying on it.` : "No new blank fields found to fill (existing entries were left untouched).");
    } catch { setStatus("Couldn't read that PDF — try again."); }
    setBusy(false);
  }
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:14, background:"#fffaf2", border:"1px dashed #e7c48f", borderRadius:10, padding:"10px 14px" }}>
      <input ref={fileRef} type="file" accept="application/pdf" style={{ display:"none" }} onChange={handle}/>
      <button onClick={()=>fileRef.current?.click()} disabled={busy}
        style={{ background: busy?"#efe8da":"#fff", border:"1px solid #e7c48f", color:"#9a6a1e", padding:"8px 14px", borderRadius:8, cursor:busy?"default":"pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
        {busy ? "Importing…" : "⬆ Import term sheet (PDF) to auto-fill blanks"}
      </button>
      <span style={{ fontSize:12, color: status.startsWith("✓")?"#0a7d4f":"#9a6a1e" }}>{status || "Upload a signed term sheet or closing statement — it fills empty fields only."}</span>
    </div>
  );
}

// Floating "ask about this property" assistant on the deal detail page. Scoped to a
// single deal so answers are specific (e.g. "what does Marshalls pay here and what
// are their sales?"). Self-contained: builds context from the deal and calls the AI.
function PropertyChat({ deal }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState([]);
  const [thinking, setThinking] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, thinking, open]);

  const buildContext = () => ({
    property: deal.propertyName, address: deal.address, market: deal.market,
    assetType: deal.assetType, centerType: deal.centerType, status: deal.status,
    totalSF: deal.totalSF, occupancy: deal.occupancy, noi: deal.noi, capRate: deal.capRate,
    askingPrice: deal.askingPrice, walt: deal.walt, weightedAvgRentPSF: deal.weightedAvgRentPSF,
    grossPotentialRent: deal.grossPotentialRent, operatingExpenses: deal.operatingExpenses,
    nnnRecoveries: deal.nnnRecoveries, yearBuilt: deal.yearBuilt,
    highlights: deal.notes, redFlags: deal.redFlags, keyAssumptions: deal.keyAssumptions,
    demographics: deal.marketDemographics, sale: deal.marketSale,
    tenants: (deal.tenants||[]).map(t=>({
      name:t.name, sf:t.sf, rentPSF:t.rentPerSF, annualRent:t.annualRent, start:t.leaseStart,
      expiry:t.leaseExpiry, reimbursement:t.reimbursementMethod, salesPSF:t.salesPSF,
      anchor:t.isAnchor||undefined, options:t.renewalOptions, rentSteps:t.rentSchedule
    })),
  });

  async function ask(text) {
    if (!text.trim() || thinking) return;
    const next = [...msgs, { role:"user", content:text }];
    setMsgs(next); setInput(""); setThinking(true);
    try {
      const sys = `You are a commercial real estate analyst answering questions about ONE specific property. Use ONLY the property data below. If something isn't in the data, say it isn't available rather than guessing. Be concise and specific — cite tenant names, dollar figures, dates, and PSF where relevant. Property data (JSON):\n${JSON.stringify(buildContext())}`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:1200, system: sys, messages: next.map(m=>({ role:m.role, content:m.content })) })
      });
      const data = await resp.json();
      const reply = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim() || "No response.";
      setMsgs(h => [...h, { role:"assistant", content:reply }]);
    } catch { setMsgs(h => [...h, { role:"assistant", content:"Network error. Try again." }]); }
    setThinking(false);
  }

  const suggestions = ["What's the largest near-term rollover risk?", "Which tenants pay below-market rent?", "Summarize the lease and reimbursement profile"];

  return (
    <>
      <button onClick={()=>setOpen(o=>!o)} title="Ask AI about this property"
        style={{ position:"fixed", bottom:24, right:24, zIndex:160, height:52, padding:open?0:"0 20px", width:open?52:"auto", borderRadius:26, background:"#6dba43", color:"#1f2b16", border:"none", boxShadow:"0 8px 24px -6px rgba(56,58,55,0.5)", cursor:"pointer", fontSize:14, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontFamily:"'Inter',sans-serif" }}>
        {open ? "✕" : "✦ Ask about this property"}
      </button>
      {open && (
        <div style={{ position:"fixed", bottom:88, right:24, zIndex:160, width:374, maxWidth:"calc(100vw - 48px)", height:480, maxHeight:"calc(100vh - 130px)", background:"#fff", border:"1px solid #e7e0d2", borderRadius:16, boxShadow:"0 16px 50px -12px rgba(56,58,55,0.4)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"13px 16px", borderBottom:"1px solid #f1eadc", background:"#faf7f0" }}>
            <div style={{ fontFamily:"'Fraunces',serif", fontWeight:600, fontSize:15, color:"#26281f" }}>Property assistant</div>
            <div style={{ fontSize:11, color:"#a69e91", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{deal.propertyName||"This property"}</div>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"14px 16px", display:"flex", flexDirection:"column", gap:11 }}>
            {msgs.length===0 && (
              <div style={{ color:"#9a917f", fontSize:12.5, lineHeight:1.6 }}>
                Ask anything about this property — e.g. what a specific tenant pays and their sales. Try:
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:10 }}>
                  {suggestions.map(s=>(
                    <button key={s} onClick={()=>ask(s)} style={{ textAlign:"left", background:"#f3eee3", border:"1px solid #e7e0d2", borderRadius:9, padding:"7px 11px", fontSize:12, color:"#5c5f57", cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m,i)=>(
              m.role==="user"
                ? <div key={i} style={{ alignSelf:"flex-end", background:"#383a37", color:"#fff", borderRadius:"12px 12px 4px 12px", padding:"8px 12px", fontSize:13, maxWidth:"85%" }}>{m.content}</div>
                : <div key={i} style={{ alignSelf:"flex-start", background:"#f5f1e8", borderRadius:"12px 12px 12px 4px", padding:"10px 13px", fontSize:13, color:"#383a37", maxWidth:"92%", lineHeight:1.55 }}><Md text={m.content}/></div>
            ))}
            {thinking && <div style={{ alignSelf:"flex-start", color:"#a69e91", fontSize:12.5 }}>Thinking…</div>}
            <div ref={endRef}/>
          </div>
          <div style={{ borderTop:"1px solid #f1eadc", padding:"10px 12px", display:"flex", gap:7 }}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); ask(input); } }}
              disabled={thinking} placeholder="Ask about this property…"
              style={{ flex:1, background:"#fff", border:"1px solid #e3dccd", borderRadius:9, padding:"9px 12px", fontSize:13, color:"#383a37", outline:"none" }}/>
            <button onClick={()=>ask(input)} disabled={thinking||!input.trim()}
              style={{ background:(!thinking&&input.trim())?"#6dba43":"#efe8da", color:(!thinking&&input.trim())?"#1f2b16":"#b3aa9b", border:"none", borderRadius:9, padding:"0 15px", fontSize:15, fontWeight:700, cursor:(!thinking&&input.trim())?"pointer":"default" }}>↑</button>
          </div>
        </div>
      )}
    </>
  );
}

// Fields that hold numeric values (stored as numbers, formatted on display).
const NUMERIC_TXN_FIELDS = new Set(["txnPurchasePrice","txnSalePrice","debtLoanAmount","debtRate","debtSpread","debtTermYears","debtAmortYears","debtIOPeriod","debtLTV","debtDSCR","acqCapRate","acqNOIAtClose","acqDeposit","acqClosingCosts","acqFee","acqHoldPeriod","acqTargetIRR","dispExitCap","dispCosts","dispLoanPayoff"]);

// Self-contained transaction/acquisition/debt input. It keeps its OWN local text
// state while you type, so a keystroke never re-renders the parent (the old inline
// version was redefined on every render, which remounted the input and stole focus
// after each character). Commits on blur or Enter, and auto-formats: money fields
// (prefix "$") show "$40,000,000", percent fields (suffix "%") show "7.25%".
function TxnField({ label, field, initial, placeholder, prefix, suffix, options, wide, dealId, onUpdate, numeric }) {
  const isMoney = prefix === "$";
  const isPct = suffix === "%";
  const isNum = numeric || isMoney || isPct || NUMERIC_TXN_FIELDS.has(field);
  const fmt = (v) => {
    if (v == null || v === "") return "";
    if (isMoney) { const n = Number(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n) ? String(v) : n.toLocaleString("en-US"); }
    return String(v);
  };
  const [val, setVal] = useState(() => fmt(initial));
  useEffect(() => { setVal(fmt(initial)); }, [initial, dealId]); // resync if the deal/value changes underneath
  const commit = () => {
    if (val === "" || val == null) { onUpdate(dealId, { [field]: null }); return; }
    if (isNum) {
      const n = Number(String(val).replace(/[^0-9.\-]/g,""));
      if (isNaN(n)) { onUpdate(dealId, { [field]: null }); setVal(""); return; }
      setVal(isMoney ? n.toLocaleString("en-US") : String(n));
      onUpdate(dealId, { [field]: n });
    } else {
      onUpdate(dealId, { [field]: val });
    }
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5, gridColumn: wide?"1 / -1":"auto" }}>
      <label style={{ fontSize:11, color:"#a69e91", fontWeight:600, letterSpacing:"0.03em", textTransform:"uppercase" }}>{label}</label>
      {options ? (
        <select value={val} onChange={e=>{ setVal(e.target.value); onUpdate(dealId, { [field]: e.target.value || null }); }}
          style={{ background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"10px", fontSize:14, color:"#383a37", outline:"none" }}>
          <option value="">—</option>
          {options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <div style={{ display:"flex", alignItems:"center", background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"0 10px" }}>
          {prefix && <span style={{ color:"#a69e91", fontSize:14 }}>{prefix}</span>}
          <input
            value={val}
            onChange={e=>setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={e=>{ if (e.key==="Enter") e.currentTarget.blur(); }}
            placeholder={placeholder}
            style={{ flex:1, background:"transparent", border:"none", outline:"none", padding:"10px 6px", fontSize:14, color:"#383a37" }}/>
          {suffix && <span style={{ color:"#a69e91", fontSize:13 }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}

// Inline editor for asking price / cap rate — often not stated in the OM, so the
// user enters them. Saves through onUpdate (so it lands in the audit trail).
function PriceCapEditor({ deal, onUpdate }) {
  const [price, setPrice] = useState(deal.askingPrice ?? "");
  const [cap, setCap] = useState(deal.capRate ?? "");
  useEffect(() => { setPrice(deal.askingPrice ?? ""); setCap(deal.capRate ?? ""); }, [deal.id]);
  const saveP = () => { const v = price===""?null:Number(price); if (price==="" ? deal.askingPrice!=null : (!isNaN(v) && v!==(deal.askingPrice??null))) onUpdate(deal.id, { askingPrice: v }); };
  const saveC = () => { const v = cap===""?null:Number(cap); if (cap==="" ? deal.capRate!=null : (!isNaN(v) && v!==(deal.capRate??null))) onUpdate(deal.id, { capRate: v }); };
  const inp = { fontSize:12, padding:"5px 9px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", background:"#fff", width:"100%", fontFamily:"'Inter',sans-serif", boxSizing:"border-box" };
  return (
    <div style={{ marginTop:12, paddingTop:12, borderTop:"1px dashed #e7e0d2" }}>
      <div style={{ fontSize:8.5, letterSpacing:"0.12em", color:"#a89f8f", marginBottom:7, textTransform:"uppercase", fontWeight:700 }}>Enter price / cap manually</div>
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"#a69e91", marginBottom:3 }}>ASKING PRICE&nbsp;$</div>
          <input value={price} onChange={e=>setPrice(e.target.value)} onBlur={saveP} onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()} placeholder="—" inputMode="numeric" style={inp}/>
        </div>
        <div style={{ width:92 }}>
          <div style={{ fontSize:9, color:"#a69e91", marginBottom:3 }}>CAP RATE&nbsp;%</div>
          <input value={cap} onChange={e=>setCap(e.target.value)} onBlur={saveC} onKeyDown={e=>e.key==="Enter"&&e.currentTarget.blur()} placeholder="—" inputMode="decimal" style={inp}/>
        </div>
      </div>
    </div>
  );
}

// Dynamic, sortable & filterable tenant roster. Rent steps, recent renewals,
// tenant sales/occupancy cost, and assumption footnotes are folded in as columns.
// Scrolls horizontally to fit everything.
function TenantRoster({ tenants, onTenantClick }) {
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState("all");
  const [sortKey, setSortKey] = useState("sf");
  const [sortDir, setSortDir] = useState("desc");
  const num = v => (v==null||v===""||isNaN(Number(v))) ? null : Number(v);

  let rows = tenants.slice();
  if (quick==="anchors") rows = rows.filter(t=>t.isAnchor);
  else if (quick==="expiring") rows = rows.filter(t=>num(t.remainingTermYears)!=null && num(t.remainingTermYears)<2);
  else if (quick==="footnotes") rows = rows.filter(t=>t.assumptionNote);
  if (q.trim()) { const s=q.toLowerCase(); rows = rows.filter(t=>(t.name||"").toLowerCase().includes(s)); }

  const numKeys = new Set(["sf","rentPerSF","annualRent","salesPSF","occupancyCost"]);
  if (sortKey) {
    rows = rows.slice().sort((a,b)=>{
      if (numKeys.has(sortKey)) {
        let av=num(a[sortKey]), bv=num(b[sortKey]);
        av = av==null?-Infinity:av; bv = bv==null?-Infinity:bv;
        return sortDir==="asc"?av-bv:bv-av;
      }
      const av=(a[sortKey]==null?"":String(a[sortKey])).toLowerCase();
      const bv=(b[sortKey]==null?"":String(b[sortKey])).toLowerCase();
      return sortDir==="asc"?av.localeCompare(bv):bv.localeCompare(av);
    });
  }
  const setSort = k => { if (sortKey===k) setSortDir(x=>x==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir("asc"); } };
  const arrow = k => sortKey===k ? (sortDir==="asc"?" ▲":" ▼") : "";

  const cols = [
    ["name","Tenant",0],["sf","SF",1],["rentPerSF","Rent/SF",1],["annualRent","Ann. Rent",1],
    ["leaseStart","Start",0],["leaseExpiry","Expiry",0],["reimbursementMethod","Reimb.",0],
    ["rentSchedule","Rent Steps",0],["renewalOptions","Options",0],["recentlyExercisedRenewal","Recent Renewal",0],
    ["salesPSF","Sales/SF",1],["occupancyCost","Occ Cost",1],["creditRating","Credit",0],
  ];
  const chip = (key,label) => (
    <button key={key} onClick={()=>setQuick(key)} style={{ background: quick===key?"#2a2c27":"transparent", color: quick===key?"#f6f2ea":"#7d766a", border:"1px solid "+(quick===key?"#2a2c27":"#e3dccd"), padding:"4px 11px", borderRadius:20, fontSize:11, cursor:"pointer", fontWeight:500, fontFamily:"'Inter',sans-serif" }}>{label}</button>
  );

  return (
    <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:13, flexWrap:"wrap" }}>
        <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>Tenant Roster — {rows.length===tenants.length?`${tenants.length} tenants`:`${rows.length} of ${tenants.length}`}</div>
        <div style={{ display:"flex", gap:7, alignItems:"center", flexWrap:"wrap" }}>
          {chip("all","All")}{chip("anchors","Anchors")}{chip("expiring","Expiring ≤2yr")}
          {tenants.some(t=>t.assumptionNote) && chip("footnotes","Has footnote")}
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter tenants…"
            style={{ fontSize:12, padding:"5px 10px", border:"1px solid #e3dccd", borderRadius:7, color:"#383a37", background:"#fff", width:150, fontFamily:"'Inter',sans-serif" }}/>
        </div>
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ borderCollapse:"collapse", fontSize:12, minWidth:1180, width:"100%" }}>
          <thead>
            <tr style={{ fontSize:10, letterSpacing:"0.03em" }}>
              {cols.map(([k,label,right])=>(
                <th key={k} onClick={()=>setSort(k)} style={{ padding:"6px 10px", textAlign:right?"right":"left", cursor:"pointer", whiteSpace:"nowrap", userSelect:"none", color:sortKey===k?"#383a37":"#a69e91", fontWeight:600 }}>{label}{arrow(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t,i)=>(
              <tr key={i} style={{ borderTop:"1px solid #f1eadc" }}>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap" }}>
                  <span onClick={onTenantClick?()=>onTenantClick(t.name):undefined}
                    title={onTenantClick?`View ${t.name} across your portfolio`:undefined}
                    style={{ color:"#383a37", fontWeight:600, cursor:onTenantClick?"pointer":"default", textDecoration:onTenantClick?"underline":"none", textDecorationColor:"#d8cfbd", textUnderlineOffset:"2px" }}>{t.name}</span>
                  {t.isAnchor&&<span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>ANCHOR</span>}
                  {t.assumptionNote&&<span title={t.assumptionNote} style={{ marginLeft:6, color:"#b45309", cursor:"help" }}>⚑</span>}
                </td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{num(t.sf)!=null?num(t.sf).toLocaleString():"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{num(t.rentPerSF)!=null?`$${num(t.rentPerSF).toFixed(2)}`:"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{num(t.annualRent)!=null?`$${num(t.annualRent).toLocaleString()}`:"—"}</td>
                <td style={{ padding:"8px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{t.leaseStart||"—"}</td>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap", color:num(t.remainingTermYears)<2?"#dc2626":num(t.remainingTermYears)<4?"#c97a18":"#5c5f57" }}>{t.leaseExpiry||"—"}</td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap" }}>
                  {(() => {
                    const m = t.reimbursementMethod || t.leaseType || "";
                    const gross = /gross/i.test(m), fixed = /\bfixed\b/i.test(m);
                    const flag = gross ? { t:"GROSS", c:"#b91c1c", bg:"#fdecea", tip:"Gross lease — landlord absorbs expense growth (no recovery)" }
                              : fixed ? { t:"FIXED", c:"#b45309", bg:"#fbe6cf", tip:"Fixed reimbursement — landlord absorbs expense growth above the fixed amount" } : null;
                    return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:6, color: flag?flag.c:"#5c5f57" }}>
                        {flag && <span title={flag.tip} style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.04em", color:flag.c, background:flag.bg, padding:"1px 6px", borderRadius:9, cursor:"help" }}>{flag.t}</span>}
                        {m || "—"}
                      </span>
                    );
                  })()}
                </td>
                <td style={{ padding:"8px 10px", color:"#837c6e", fontSize:11, whiteSpace:"nowrap" }} title={[t.rentBumps,t.rentSchedule].filter(Boolean).join("   ·   ")||""}>
                  {t.rentBumps || (t.rentSchedule ? "Stepped" : "—")}
                </td>
                <td style={{ padding:"8px 10px", color:"#837c6e", fontSize:11, whiteSpace:"nowrap" }}>{t.renewalOptions||"—"}</td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.recentlyExercisedRenewal?"#0f9d63":"#a69e91" }}>{t.recentlyExercisedRenewal||"—"}</td>
                <td title={t.salesNotes||""} style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap", cursor:t.salesNotes?"help":"default" }}>{num(t.salesPSF)!=null?`$${t.salesPSF}`:"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", whiteSpace:"nowrap", color:num(t.occupancyCost)>15?"#dc2626":num(t.occupancyCost)!=null?"#0f9d63":"#a69e91" }}>{num(t.occupancyCost)!=null?`${t.occupancyCost}%`:"—"}</td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.creditRating==="Investment Grade"?"#0f9d63":"#837c6e" }}>{t.creditRating||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize:10, color:"#a69e91", marginTop:9 }}>Click a column to sort · scroll sideways for more · hover ⚑ for a tenant footnote{rows.some(t=>t.salesNotes)?" · hover Sales/SF for the sales note":""}.</div>
    </div>
  );
}

function DetailView({ deal:d, allDeals, editor, onEditor, onToggleVerified, onLookupSale, saleBusy, onGetDemo, demoBusy, onBack, onDelete, onUpdate, onCompare, onQuery, onTenantClick }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [editNotes, setEditNotes] = useState(false);
  const [notesVal, setNotesVal] = useState(d.userNotes||"");
  const r = getRecency(d);
  const versions = d.propertyGroupId ? allDeals.filter(x=>x.propertyGroupId===d.propertyGroupId).sort((a,b)=>new Date(b.omDate||b.uploadedAt)-new Date(a.omDate||a.uploadedAt)) : [];

  // Load this deal's captured images (cover + site plan) from IndexedDB.
  const [imgs, setImgs] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  useEffect(() => {
    let alive = true; setImgs(null);
    if (d.imageMeta && (d.imageMeta.cover || d.imageMeta.sitePlan)) {
      idbLoadImages(d.id).then(res => { if (alive) setImgs(res); }).catch(()=>{});
    }
    return () => { alive = false; };
  }, [d.id]);

  // User picks the site-plan page when auto-detection failed.
  const chooseSitePlan = (page) => {
    if (!imgs || !imgs.pagePicks) return;
    const pick = imgs.pagePicks.find(pk => pk.page === page);
    if (!pick) return;
    const next = { cover: imgs.cover, coverThumb: imgs.coverThumb, sitePlan: [pick.img], pagePicks: [], needsSitePlanPick: false };
    setImgs(next);
    idbSaveImages(d.id, next).catch(()=>{});
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: 1, needsSitePlanPick: false } });
  };

  // Manually set the site plan from a specific PDF page (when auto-detect picked
  // the wrong one). The PDF isn't stored, so we ask the user to re-select it,
  // then render just the page they specify.
  const sitePlanPdfRef = useRef(null);
  const [fixPage, setFixPage] = useState("");
  const [fixingPlan, setFixingPlan] = useState(false);
  const [sitePlanHalf, setSitePlanHalf] = useState("full");
  const [coverHalf, setCoverHalf] = useState("full");
  // Left/Right/Full chooser for two-page-spread OMs.
  const halfToggle = (val, set) => (
    <span style={{ display:"inline-flex", border:"1px solid #e3dccd", borderRadius:6, overflow:"hidden" }}>
      {["full","left","right"].map(h=>(
        <button key={h} onClick={()=>set(h)} title={h==="full"?"Whole page":`${h[0].toUpperCase()+h.slice(1)} half — for two-page spreads`}
          style={{ background: val===h?"#2a2c27":"transparent", color: val===h?"#f6f2ea":"#7d766a", border:"none", borderLeft: h!=="full"?"1px solid #e3dccd":"none", padding:"5px 9px", fontSize:10.5, cursor:"pointer", fontWeight:600, fontFamily:"'Inter',sans-serif", textTransform:"capitalize" }}>{h}</button>
      ))}
    </span>
  );
  const startSitePlanFix = () => { if (parseInt(fixPage,10) >= 1) sitePlanPdfRef.current?.click(); };
  const handleSitePlanPdf = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = "";
    const page = parseInt(fixPage, 10);
    if (!file || !(page >= 1)) return;
    setFixingPlan(true);
    try {
      const pdfjsLib = await loadPdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      if (page > pdf.numPages) { window.alert(`That PDF has only ${pdf.numPages} pages — “${page}” is out of range.`); setFixingPlan(false); return; }
      const img = await _renderPdfPage(pdf, page, 1500, 0.74, sitePlanHalf);
      const current = (await idbLoadImages(d.id)) || {};
      const next = { ...current, sitePlan: img ? [img] : [], pagePicks: [], needsSitePlanPick: false };
      await idbSaveImages(d.id, next);
      setImgs(next);
      onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: next.sitePlan.length, needsSitePlanPick: false } });
      setFixPage("");
    } catch (err) {
      window.alert("Couldn't read that PDF: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      setFixingPlan(false);
    }
  };
  const renderSitePlanFixer = (label) => (
    <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #f1eadc", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <span style={{ fontSize:11, color:"#7d766a" }}>{label}</span>
      <span style={{ fontSize:11, color:"#a69e91" }}>PDF page</span>
      <input value={fixPage} onChange={e=>setFixPage(e.target.value.replace(/[^0-9]/g,""))} placeholder="#" inputMode="numeric"
        style={{ width:56, fontSize:12, padding:"5px 8px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", textAlign:"center", fontFamily:"'Inter',sans-serif" }}/>
      <span style={{ fontSize:11, color:"#a69e91" }}>spread?</span>
      {halfToggle(sitePlanHalf, setSitePlanHalf)}
      <button onClick={startSitePlanFix} disabled={fixingPlan || !(parseInt(fixPage,10)>=1)}
        style={{ background:"transparent", border:"1px solid #0d9488", color:(fixingPlan||!(parseInt(fixPage,10)>=1))?"#a69e91":"#0d9488", padding:"5px 12px", borderRadius:6, cursor:(fixingPlan||!(parseInt(fixPage,10)>=1))?"default":"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
        {fixingPlan?"Rendering…":"Choose PDF & set"}
      </button>
      <input ref={sitePlanPdfRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={handleSitePlanPdf}/>
    </div>
  );

  // Manually set the cover photo from a specific PDF page (same flow as the site
  // plan). Uses the clean-photo extractor so broker logos/text are still stripped.
  const coverPdfRef = useRef(null);
  const [coverFixPage, setCoverFixPage] = useState("");
  const [fixingCover, setFixingCover] = useState(false);
  const startCoverFix = () => { if (parseInt(coverFixPage,10) >= 1) coverPdfRef.current?.click(); };
  const handleCoverPdf = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = "";
    const page = parseInt(coverFixPage, 10);
    if (!file || !(page >= 1)) return;
    setFixingCover(true);
    try {
      const pdfjsLib = await loadPdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      if (page > pdf.numPages) { window.alert(`That PDF has only ${pdf.numPages} pages — “${page}” is out of range.`); setFixingCover(false); return; }
      const c = await _capturePagePhoto(pdf, page, pdfjsLib, coverHalf);
      const current = (await idbLoadImages(d.id)) || {};
      const next = { ...current, cover: c.cover || null, coverThumb: c.thumb || null };
      await idbSaveImages(d.id, next);
      setImgs(next);
      onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), cover: !!c.cover } });
      setCoverFixPage("");
    } catch (err) {
      window.alert("Couldn't read that PDF: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      setFixingCover(false);
    }
  };
  const renderCoverFixer = (label) => (
    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <span style={{ fontSize:11, color:"#7d766a" }}>{label}</span>
      <span style={{ fontSize:11, color:"#a69e91" }}>PDF page</span>
      <input value={coverFixPage} onChange={e=>setCoverFixPage(e.target.value.replace(/[^0-9]/g,""))} placeholder="#" inputMode="numeric"
        style={{ width:56, fontSize:12, padding:"5px 8px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", textAlign:"center", fontFamily:"'Inter',sans-serif" }}/>
      <span style={{ fontSize:11, color:"#a69e91" }}>spread?</span>
      {halfToggle(coverHalf, setCoverHalf)}
      <button onClick={startCoverFix} disabled={fixingCover || !(parseInt(coverFixPage,10)>=1)}
        style={{ background:"transparent", border:"1px solid #0d9488", color:(fixingCover||!(parseInt(coverFixPage,10)>=1))?"#a69e91":"#0d9488", padding:"5px 12px", borderRadius:6, cursor:(fixingCover||!(parseInt(coverFixPage,10)>=1))?"default":"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
        {fixingCover?"Rendering…":"Choose PDF & set"}
      </button>
      <input ref={coverPdfRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={handleCoverPdf}/>
    </div>
  );

  // Headline numbers that can be marked "verified" (locked against re-analyze).
  const LOCKABLE = { askingPrice:1, capRate:1, noi:1, pricePerSF:1, totalSF:1, occupancy:1, grossPotentialRent:1, effectiveGrossIncome:1, operatingExpenses:1, walt:1 };
  const Row = ({l,v,c,field}) => {
    const lockable = field && LOCKABLE[field];
    const ver = lockable ? (d.verified || {})[field] : null;
    const hasVal = v!=null && v!=="";
    return (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #e7e0d2", background: ver?"#0f9d6308":"transparent", margin: ver?"0 -6px":0, paddingLeft: ver?6:0, paddingRight: ver?6:0, borderRadius: ver?4:0 }}>
        <span style={{ fontSize:10, color:"#6f6a5f", letterSpacing:"0.05em" }}>{l}</span>
        <span style={{ display:"flex", alignItems:"center", gap:7 }}>
          <span style={{ fontSize:11, color:c||"#383a37", fontWeight:500 }}>{hasVal?v:<span style={{color:"#958d80"}}>—</span>}</span>
          {lockable && hasVal && (
            <button onClick={()=>onToggleVerified(d.id, field)}
              title={ver ? `Verified${ver.by?` by ${ver.by}`:""}${ver.ts?` · ${new Date(ver.ts).toLocaleDateString()}`:""} — re-analyze won't overwrite this. Click to unlock.` : "Mark verified — locks this value so re-analyze can't overwrite it"}
              style={{ background: ver?"#0f9d63":"transparent", border:`1px solid ${ver?"#0f9d63":"#cfd6dd"}`, color: ver?"#fff":"#b6bcc4", width:17, height:17, borderRadius:4, cursor:"pointer", fontSize:10, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", padding:0, flexShrink:0 }}>
              {ver?"✓":""}
            </button>
          )}
        </span>
      </div>
    );
  };

  const Card = ({title, children, accent}) => (
    <div style={{ background:"#ffffff", border:`1px solid ${accent||"#ece5d7"}`, borderRadius:12, padding:"16px 18px", boxShadow:"0 1px 2px rgba(56,58,55,0.04), 0 12px 28px -22px rgba(56,58,55,0.45)" }}>
      <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:accent||"#a89f8f", marginBottom:12 }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      <PropertyChat deal={d}/>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <button onClick={()=>onQuery(`Full investment analysis on "${d.propertyName}": evaluate cap rate, WALT (${d.walt||"unknown"}yr), tenant credit quality, rent bumps, lease rollover risk (OM date: ${d.omDate||"unknown"}), and give a clear buy/pass/watch recommendation with reasoning.`)}
            style={{ background:"transparent", border:"1px solid #383a37", color:"#383a37", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>ANALYZE</button>
          <button onClick={()=>onQuery(`Find the 3 closest comps to "${d.propertyName}" (${d.assetType}, ${d.market}, ${d.totalSF?d.totalSF+" SF":"unknown size"}). Compare cap rates, WALT, tenant mix, and price/SF.`)}
            style={{ background:"transparent", border:"1px solid #6dba43", color:"#6dba43", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>COMPS</button>
          <button onClick={()=>onLookupSale(d.id)} disabled={saleBusy}
            title="Search the web for whether this property has since sold"
            style={{ background:"transparent", border:"1px solid #0d9488", color:saleBusy?"#a69e91":"#0d9488", padding:"5px 10px", borderRadius:4, cursor:saleBusy?"default":"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>{saleBusy?"SEARCHING…":"FIND SALE"}</button>
          {!confirmDel
            ? <button onClick={()=>setConfirmDel(true)} style={{ background:"transparent", border:"1px solid #dc2626", color:"#dc2626", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>TRASH</button>
            : <><button onClick={()=>onDelete(d.id)} style={{ background:"#dc2626", border:"none", color:"#fff", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>MOVE TO TRASH</button>
               <button onClick={()=>setConfirmDel(false)} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>CANCEL</button></>
          }
        </div>
      </div>

      {/* Cover photo hero (from the OM cover page) */}
      {imgs && imgs.cover && (
        <div onClick={()=>setLightbox(imgs.cover)} title="Click to enlarge"
          style={{ position:"relative", height:228, borderRadius:14, overflow:"hidden", marginBottom:16, cursor:"zoom-in", boxShadow:"0 1px 2px rgba(56,58,55,0.05), 0 20px 40px -28px rgba(56,58,55,0.6)", border:"1px solid #ece5d7" }}>
          <img src={imgs.cover} alt={`${d.propertyName||"Property"} cover`} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(38,40,31,0) 45%, rgba(38,40,31,0.55) 100%)" }}/>
          <div style={{ position:"absolute", left:18, bottom:14, color:"#fff" }}>
            <div style={{ fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", opacity:0.85, fontWeight:600 }}>From the offering memorandum</div>
          </div>
        </div>
      )}

      {/* Cover photo fixer — set/replace it from a specific PDF page */}
      {imgs && (
        <div style={{ background:"#ffffff", border:"1px solid #ece5d7", borderRadius:12, padding:"12px 16px", marginBottom:16, marginTop: imgs.cover?-6:0, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          {!imgs.cover && (
            <>
              <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f", marginBottom:6 }}>Cover Photo — not set</div>
              <p style={{ fontSize:11.5, color:"#6f6a5f", lineHeight:1.55, margin:"0 0 8px 0" }}>No cover photo is saved for this deal. If you know which page has the property photo, set it from the PDF below.</p>
            </>
          )}
          {renderCoverFixer(imgs.cover ? "Wrong cover photo? Set it from a specific" : "Set the cover photo from")}
        </div>
      )}

      {/* Lightbox for enlarging cover / site-plan images */}
      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(26,28,22,0.88)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, cursor:"zoom-out" }}>
          <img src={lightbox} alt="Enlarged" style={{ maxWidth:"94%", maxHeight:"92%", objectFit:"contain", borderRadius:8, boxShadow:"0 30px 80px rgba(0,0,0,0.5)" }}/>
          <button onClick={()=>setLightbox(null)} style={{ position:"fixed", top:20, right:24, background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.3)", color:"#fff", width:36, height:36, borderRadius:"50%", cursor:"pointer", fontSize:18 }}>✕</button>
        </div>
      )}

      {/* Header badges */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:6 }}>
        <span style={{ background:"#e7e0d2", padding:"2px 8px", borderRadius:3, fontSize:9, color:"#7d766a" }}>{d.assetType||"?"}</span>
        {d.centerType && <span style={{ background:"#6dba4322", padding:"2px 8px", borderRadius:3, fontSize:9, color:"#2f5e1c", fontWeight:600 }}>{d.centerType}</span>}
        {(() => { const loc = classifyLocation(d); return <>
          {loc.urbanicity && <span style={{ background:"#383a3712", padding:"2px 8px", borderRadius:3, fontSize:9, color:"#383a37", fontWeight:600 }}>{loc.urbanicity}</span>}
          {loc.density && <span style={{ background:`${loc.density.color}1a`, padding:"2px 8px", borderRadius:3, fontSize:9, color:loc.density.color, fontWeight:600 }}>{loc.density.tier}</span>}
          {loc.income && <span style={{ background:`${loc.income.color}1a`, padding:"2px 8px", borderRadius:3, fontSize:9, color:loc.income.color, fontWeight:600 }}>{loc.income.tier}</span>}
        </>; })()}
        <RecencyBadge deal={d}/>
        <ScoreBadge score={d.dealScore} size={12}/>
        <StatusTag status={d.status} onChange={s=>onUpdate(d.id,{status:s})}/>
        {d.autoPassed && (
          <span title={`Auto-passed after 4+ months as a prospect${d.autoPassedAt?` on ${new Date(d.autoPassedAt).toLocaleDateString()}`:""}. Change the status to clear this.`}
            style={{ fontSize:9, color:"#b08968", background:"#b0896815", border:"1px solid #b0896840", padding:"2px 7px", borderRadius:3, fontWeight:600, letterSpacing:"0.04em" }}>
            AUTO-PASSED{d.autoPassedAt?` · ${new Date(d.autoPassedAt).toLocaleDateString(undefined,{month:"short",year:"2-digit"})}`:""}
          </span>
        )}
        {d.omDate&&<span style={{ fontSize:9, color:"#958d80" }}>OM: {d.omDate}</span>}
        {d.pdfPages&&<span style={{ fontSize:9, color:"#958d80" }}>{d.pdfPages}pp</span>}
        {d.assumableDebt&&<span style={{ fontSize:9, color:"#0f9d63", background:"#0f9d6315", padding:"2px 6px", borderRadius:3 }}>ASSUMABLE DEBT</span>}
      </div>
      <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:500, color:"#26281f", margin:"0 0 4px 0", letterSpacing:"-0.02em", lineHeight:1.08 }}>{d.propertyName||d.fileName}</h1>
      <p style={{ color:"#6f6a5f", fontSize:12, margin:"0 0 18px 0" }}>{d.address}</p>

      {/* Extraction quality — flag thin / partial extractions */}
      <ExtractionQuality deal={d}/>

      {/* Data integrity — automated sanity checks on the extracted numbers */}
      <DataIntegrity deal={d}/>

      {/* Market sale — found online via the sale-lookup feature */}
      {d.marketSale && (
        <div style={{ background:"#0d948810", border:"1px solid #0d948840", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9, gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:9, letterSpacing:"0.1em", color:"#0d9488", fontWeight:700 }}>{"\u2197"} MARKET SALE — FOUND ONLINE</div>
            <button onClick={()=>onLookupSale(d.id)} disabled={saleBusy} style={{ background:"transparent", border:"1px solid #0d9488", color:saleBusy?"#a69e91":"#0d9488", padding:"3px 9px", borderRadius:4, cursor:saleBusy?"default":"pointer", fontSize:9, fontFamily:"'Inter',sans-serif" }}>{saleBusy?"SEARCHING…":"RE-CHECK"}</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:9 }}>
            {[["SALE PRICE", d.marketSale.price!=null?`$${Number(d.marketSale.price).toLocaleString()}`:null],
              ["SALE DATE", d.marketSale.soldDate],
              ["CAP RATE", d.marketSale.capRate!=null?`${d.marketSale.capRate}%`:null],
              ["BUYER", d.marketSale.buyer],
              ["SELLER", d.marketSale.seller],
              ["PRICE / SF", d.marketSale.pricePerSF!=null?`$${d.marketSale.pricePerSF}`:null]].map(([l,v],i)=>(
              <div key={i}>
                <div style={{ fontSize:8, color:"#5f8a86", letterSpacing:"0.05em" }}>{l}</div>
                <div style={{ fontSize:12, color:"#0f5e57", fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v||<span style={{color:"#a69e91"}}>—</span>}</div>
              </div>
            ))}
          </div>
          {d.marketSale.summary && <div style={{ fontSize:11, color:"#6f6a5f", lineHeight:1.55, marginBottom:9 }}>{d.marketSale.summary}</div>}
          {(d.marketSale.sources||[]).length>0 && (
            <div style={{ marginBottom:7 }}>
              <div style={{ fontSize:8, color:"#5f8a86", letterSpacing:"0.05em", marginBottom:3 }}>SOURCES</div>
              {d.marketSale.sources.map((s,i)=>(
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ display:"block", fontSize:11, color:"#0d9488", textDecoration:"none", marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{"\u2197"} {s.title||s.url}</a>
              ))}
            </div>
          )}
          <div style={{ fontSize:9, color:"#a69e91", lineHeight:1.5 }}>AI-gathered from public sources{d.marketSale.lookedUpAt?` on ${d.marketSale.lookedUpAt.slice(0,10)}`:""}. Verify against the linked sources before relying on it.</div>
        </div>
      )}
      {!d.marketSale && d.marketSaleChecked && (
        <div style={{ fontSize:11, color:"#a69e91", marginBottom:12, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span>No confirmed sale found online (checked {d.marketSaleChecked.slice(0,10)}).</span>
          <button onClick={()=>onLookupSale(d.id)} disabled={saleBusy} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"2px 8px", borderRadius:4, cursor:saleBusy?"default":"pointer", fontSize:9, fontFamily:"'Inter',sans-serif" }}>{saleBusy?"…":"Re-check"}</button>
        </div>
      )}

      {/* AI investment highlights — surfaced near the top */}
      {d.notes && (
        <div style={{ background:"linear-gradient(180deg,#ffffff,#fcfbf6)", border:"1px solid #e3dccd", borderLeft:"3px solid #6dba43", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04), 0 12px 28px -22px rgba(56,58,55,0.45)" }}>
          <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#3f6b24", marginBottom:9 }}>AI Investment Highlights</div>
          <p style={{ color:"#5b574d", fontSize:13, lineHeight:1.75, margin:0 }}>{d.notes}</p>
        </div>
      )}

      {/* Edit metrics (useful when verifying extracted numbers) */}
      <MetricsEditor deal={d} onUpdate={onUpdate}/>

      {/* Financial grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:12 }}>
        <Card title="KEY FINANCIALS">
          <Row l="ASKING PRICE" v={d.askingPrice?`$${Number(d.askingPrice).toLocaleString()}`:null} c="#6dba43" field="askingPrice"/>
          <Row l="CAP RATE" v={d.capRate?`${d.capRate}%`:null} c="#0f9d63" field="capRate"/>
          <Row l="NOI" v={d.noi?`$${Number(d.noi).toLocaleString()}`:null} c="#0f9d63" field="noi"/>
          <Row l="PRICE / SF" v={d.pricePerSF?`$${d.pricePerSF}`:null} field="pricePerSF"/>
          <Row l="TOTAL SF" v={d.totalSF?`${Number(d.totalSF).toLocaleString()} SF`:null} field="totalSF"/>
          <Row l="OCCUPANCY" v={d.occupancy?`${d.occupancy}%`:null} c="#383a37" field="occupancy"/>
          <PriceCapEditor deal={d} onUpdate={onUpdate}/>
        </Card>
        <Card title="INCOME & EXPENSES">
          <Row l="GROSS POTENTIAL RENT" v={d.grossPotentialRent?`$${Number(d.grossPotentialRent).toLocaleString()}`:null} field="grossPotentialRent"/>
          <Row l="EFF. GROSS INCOME" v={d.effectiveGrossIncome?`$${Number(d.effectiveGrossIncome).toLocaleString()}`:null} field="effectiveGrossIncome"/>
          <Row l="OPERATING EXPENSES" v={d.operatingExpenses?`$${Number(d.operatingExpenses).toLocaleString()}`:null} field="operatingExpenses"/>
          <Row l="RECOVERY RATIO (Y1)" v={(() => {
            const cf = d.cashFlowProjection || [];
            const y1 = cf.find(r => r && r.reimbursements!=null && r.operatingExpenses);
            let r = y1 ? (Number(y1.reimbursements) / Number(y1.operatingExpenses))
                       : (d.nnnRecoveries!=null && d.operatingExpenses ? Number(d.nnnRecoveries)/Number(d.operatingExpenses) : null);
            return (r!=null && isFinite(r)) ? `${Math.round(r*100)}%` : null;
          })()} c="#0d9488"/>
          <Row l="NNN RECOVERIES" v={d.nnnRecoveries?`$${Number(d.nnnRecoveries).toLocaleString()}`:null}/>
          <Row l="WTAVG RENT/SF" v={d.weightedAvgRentPSF?`$${d.weightedAvgRentPSF}/SF`:null}/>
        </Card>
        <Card title="LEASE METRICS">
          <Row l="WALT" v={d.walt?`${d.walt} yrs`:null} c={d.walt<3?"#dc2626":d.walt<6?"#383a37":"#0f9d63"} field="walt"/>
          <Row l="YEAR BUILT" v={d.yearBuilt}/>
          <Row l="RENOVATION YEAR" v={d.renovationYear}/>
          <Row l="LOT SIZE" v={d.lotSizeAcres?`${d.lotSizeAcres} ac`:null}/>
          <Row l="PARKING RATIO" v={d.parkingRatio?`${d.parkingRatio}/1k SF`:null}/>
          <Row l="# BUILDINGS" v={d.numberOfBuildings}/>
        </Card>
      </div>

      {/* Verify hint / status — discoverability for locked fields */}
      {(() => {
        const vcount = Object.keys(d.verified || {}).length;
        return (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, fontSize:11, color: vcount?"#0f6b46":"#a69e91" }}>
            <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:15, height:15, borderRadius:4, border:`1px solid ${vcount?"#0f9d63":"#cfd6dd"}`, background: vcount?"#0f9d63":"transparent", color:"#fff", fontSize:9, flexShrink:0 }}>{vcount?"✓":""}</span>
            {vcount
              ? `${vcount} figure${vcount>1?"s":""} verified — locked against re-analyze.`
              : "Tip: click the box beside a key figure to mark it verified — re-analyze won't overwrite verified numbers."}
          </div>
        );
      })()}

      {/* Site plan (auto-detected from the OM) */}
      {imgs && imgs.sitePlan && imgs.sitePlan.length>0 && (
        <div style={{ background:"#ffffff", border:"1px solid #ece5d7", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04), 0 12px 28px -22px rgba(56,58,55,0.45)" }}>
          <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f", marginBottom:12 }}>Site Plan</div>
          <div style={{ display:"grid", gap:10 }}>
            {imgs.sitePlan.map((src,i)=>(
              <div key={i} onClick={()=>setLightbox(src)} title="Click to enlarge" style={{ cursor:"zoom-in", borderRadius:9, overflow:"hidden", border:"1px solid #ece5d7", background:"#faf7f0" }}>
                <img src={src} alt={`Site plan ${i+1}`} style={{ width:"100%", display:"block" }}/>
              </div>
            ))}
          </div>
          <div style={{ fontSize:9, color:"#a89f8f", marginTop:9, lineHeight:1.5 }}>Auto-detected from the OM.</div>
          {renderSitePlanFixer("Wrong page? Set the site plan from a specific")}
        </div>
      )}

      {/* Site plan picker — shown when auto-detection couldn't find one */}
      {imgs && (!imgs.sitePlan || imgs.sitePlan.length===0) && imgs.pagePicks && imgs.pagePicks.length>0 && (
        <div style={{ background:"#ffffff", border:"1px solid #e7c48f", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04), 0 12px 28px -22px rgba(56,58,55,0.45)" }}>
          <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#b45309", marginBottom:8 }}>Site Plan — choose the page</div>
          <p style={{ fontSize:11.5, color:"#6f6a5f", lineHeight:1.55, margin:"0 0 12px 0" }}>I couldn't confidently find the site plan in this OM. Tap the page that shows it and I'll save it as the site plan.</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(108px, 1fr))", gap:9 }}>
            {imgs.pagePicks.map(pk => (
              <button key={pk.page} onClick={()=>chooseSitePlan(pk.page)} title={`Use page ${pk.page} as the site plan`}
                style={{ padding:0, border:"1px solid #ece5d7", borderRadius:9, overflow:"hidden", cursor:"pointer", background:"#faf7f0", position:"relative" }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#6dba43";e.currentTarget.style.transform="translateY(-2px)"}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#ece5d7";e.currentTarget.style.transform="none"}}>
                <img src={pk.img} alt={`Page ${pk.page}`} style={{ width:"100%", display:"block", aspectRatio:"3 / 4", objectFit:"cover", objectPosition:"top" }}/>
                <span style={{ position:"absolute", bottom:5, right:5, background:"rgba(38,40,31,0.78)", color:"#fff", fontSize:9, fontWeight:600, padding:"1px 6px", borderRadius:10 }}>p.{pk.page}</span>
              </button>
            ))}
          </div>
          {renderSitePlanFixer("Know the page? Set it directly from")}
        </div>
      )}

      {/* No site plan set (and no picker available) — let the user set one by page */}
      {imgs && (!imgs.sitePlan || imgs.sitePlan.length===0) && (!imgs.pagePicks || imgs.pagePicks.length===0) && (
        <div style={{ background:"#ffffff", border:"1px solid #ece5d7", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f", marginBottom:6 }}>Site Plan — not set</div>
          <p style={{ fontSize:11.5, color:"#6f6a5f", lineHeight:1.55, margin:0 }}>No site plan is saved for this deal. If you know which page it's on, set it directly from the PDF below.</p>
          {renderSitePlanFixer("Set the site plan from")}
        </div>
      )}

      {/* TRANSACTION DETAILS — deal lifecycle (LOI / acquired / sold) */}
      {(() => {
        const owned = d.status === "Owned" || d.status === "Sold";
        const sold = d.status === "Sold";
        const tf = (p) => <TxnField {...p} initial={d[p.field]} dealId={d.id} onUpdate={onUpdate} />;
        const Grp = ({ title }) => <div style={{ gridColumn:"1 / -1", fontSize:13, fontWeight:600, color:"#383a37", marginTop:8, marginBottom:-2, display:"flex", alignItems:"center", gap:8 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#6dba43" }}/>{title}</div>;
        const pp = Number(d.txnPurchasePrice)||0, sp = Number(d.txnSalePrice)||0;
        const gain = pp && sp ? sp - pp : null;
        // Derived acquisition economics
        const closingCosts = Number(d.acqClosingCosts)||0, acqFee = Number(d.acqFee)||0;
        const allInBasis = pp ? pp + closingCosts + acqFee : null;
        const noiClose = Number(d.acqNOIAtClose) || Number(d.noi) || 0;
        const goingInCap = pp && noiClose ? (noiClose/pp*100) : null;
        const pricePerSF = pp && d.totalSF ? (pp/Number(d.totalSF)) : null;
        return (
          <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
              <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>{owned ? "Acquisition Record" : "Transaction Details"}</div>
              <div style={{ fontSize:12, color:"#a69e91" }}>{owned ? "Complete the closing details below" : "Set the status to Owned when acquired to record full closing details"}</div>
            </div>

            {owned && <TermSheetImport deal={d} onUpdate={onUpdate}/>}

            {owned && (() => {
              const req = [
                ["Purchase price", d.txnPurchasePrice], ["Seller", d.txnSeller], ["Close date", d.txnCloseDate],
                ["Going-in cap", d.acqCapRate], ["Acquiring entity", d.acqEntity], ["Strategy", d.acqStrategy],
                ["Lender", d.debtLender], ["Loan amount", d.debtLoanAmount], ["Interest rate", d.debtRate], ["Loan maturity", d.debtMaturityDate],
              ];
              const missing = req.filter(([,v]) => v == null || v === "");
              const filled = req.length - missing.length;
              const pct = Math.round((filled/req.length)*100);
              const done = missing.length === 0;
              return (
                <div style={{ background: done?"#f0faf0":"#fffaf2", border:`1px solid ${done?"#cfe9c4":"#f0d9b5"}`, borderRadius:10, padding:"12px 16px", marginBottom:18 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom: done?0:8 }}>
                    <span style={{ fontSize:13, fontWeight:600, color: done?"#0f7a3d":"#9a6a1e" }}>
                      {done ? "✓ Acquisition record complete" : `Acquisition record ${pct}% complete — ${missing.length} key detail${missing.length===1?"":"s"} still needed`}
                    </span>
                    <div style={{ width:90, height:6, background:"#efe8da", borderRadius:4, overflow:"hidden", flexShrink:0 }}>
                      <div style={{ width:`${pct}%`, height:"100%", background: done?"#0f9d63":"#d9a441", borderRadius:4, transition:"width 0.3s" }}/>
                    </div>
                  </div>
                  {!done && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
                      {missing.map(([label]) => (
                        <span key={label} style={{ fontSize:11, color:"#9a6a1e", background:"#fbeed5", padding:"2px 8px", borderRadius:10 }}>{label}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Acquisition */}
            <div style={{ fontSize:13, fontWeight:600, color:"#383a37", marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#6dba43" }}/> {owned ? "Deal Terms" : "Acquisition"}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14, marginBottom:18 }}>
              {tf({ label:"Purchase Price", field:"txnPurchasePrice", placeholder:"e.g. 42,500,000", prefix:"$" })}
              {tf({ label:"Acquired From (Seller)", field:"txnSeller", placeholder:"Seller entity / name" })}
              {tf({ label:"Close Date", field:"txnCloseDate", placeholder:"YYYY-MM-DD" })}
              {owned && <>
                {tf({ label:"Going-In Cap Rate", field:"acqCapRate", placeholder:"e.g. 6.50", suffix:"%" })}
                {tf({ label:"NOI at Close", field:"acqNOIAtClose", placeholder:"actual in-place NOI", prefix:"$" })}
                {tf({ label:"Acquiring Entity", field:"acqEntity", placeholder:"title-holding LLC / SPV" })}
                {tf({ label:"Acquisition Broker", field:"acqBroker", placeholder:"firm representing buyer/seller" })}

                <Grp title="Closing Economics"/>
                {tf({ label:"Earnest Money / Deposit", field:"acqDeposit", placeholder:"e.g. 1,000,000", prefix:"$" })}
                {tf({ label:"Closing Costs", field:"acqClosingCosts", placeholder:"e.g. 850,000", prefix:"$" })}
                {tf({ label:"Acquisition Fee", field:"acqFee", placeholder:"e.g. 425,000", prefix:"$" })}

                <Grp title="Parties & Advisors"/>
                {tf({ label:"Legal Counsel", field:"acqCounsel", placeholder:"acquisition counsel" })}

                <Grp title="Business Plan"/>
                {tf({ label:"Strategy", field:"acqStrategy", options:["Core","Core-Plus","Value-Add","Opportunistic"] })}
                {tf({ label:"Target Hold", field:"acqHoldPeriod", placeholder:"e.g. 7", suffix:"yrs" })}
                {tf({ label:"Target IRR", field:"acqTargetIRR", placeholder:"e.g. 14", suffix:"%" })}
              </>}
            </div>

            {owned && (allInBasis || goingInCap || pricePerSF) && (
              <div style={{ marginBottom:18, paddingBottom:16, borderBottom:"1px solid #f1eadc", display:"flex", gap:30, flexWrap:"wrap" }}>
                {goingInCap && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Going-In Cap (calc)</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#0f9d63" }}>{goingInCap.toFixed(2)}%</div></div>}
                {pricePerSF && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Price / SF</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${pricePerSF.toFixed(0)}</div></div>}
                {allInBasis && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>All-In Basis</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${allInBasis.toLocaleString()}</div></div>}
              </div>
            )}

            {/* Disposition */}
            <div style={{ fontSize:13, fontWeight:600, color:"#383a37", marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background: sold?"#0d9488":"#383a37" }}/> {sold ? "Disposition Record" : "Disposition"}
            </div>

            {sold && (() => {
              const req = [["Sale price", d.txnSalePrice], ["Buyer", d.txnBuyer], ["Sale date", d.txnSaleDate], ["Exit cap", d.dispExitCap]];
              const missing = req.filter(([,v]) => v == null || v === "");
              const filled = req.length - missing.length, pct = Math.round((filled/req.length)*100), done = missing.length===0;
              return (
                <div style={{ background: done?"#eefcfa":"#fffaf2", border:`1px solid ${done?"#bfe9e3":"#f0d9b5"}`, borderRadius:10, padding:"12px 16px", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:done?0:8 }}>
                    <span style={{ fontSize:13, fontWeight:600, color: done?"#0a7d72":"#9a6a1e" }}>
                      {done ? "✓ Disposition record complete" : `Disposition record ${pct}% complete — ${missing.length} detail${missing.length===1?"":"s"} still needed`}
                    </span>
                    <div style={{ width:90, height:6, background:"#efe8da", borderRadius:4, overflow:"hidden", flexShrink:0 }}>
                      <div style={{ width:`${pct}%`, height:"100%", background: done?"#0d9488":"#d9a441", borderRadius:4, transition:"width 0.3s" }}/>
                    </div>
                  </div>
                  {!done && <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>{missing.map(([l])=><span key={l} style={{ fontSize:11, color:"#9a6a1e", background:"#fbeed5", padding:"2px 8px", borderRadius:10 }}>{l}</span>)}</div>}
                </div>
              );
            })()}

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14 }}>
              {tf({ label:"Sale Price", field:"txnSalePrice", placeholder:"e.g. 54,000,000", prefix:"$" })}
              {tf({ label:"Sold To (Buyer)", field:"txnBuyer", placeholder:"Buyer entity / name" })}
              {tf({ label:"Sale Date", field:"txnSaleDate", placeholder:"YYYY-MM-DD" })}
              {tf({ label:"Disposition Broker", field:"txnBroker", placeholder:"firm representing the sale" })}
              {sold && <>
                {tf({ label:"Exit Cap Rate", field:"dispExitCap", placeholder:"e.g. 5.75", suffix:"%" })}
                {tf({ label:"Selling Costs", field:"dispCosts", placeholder:"commission, legal, transfer", prefix:"$" })}
                {tf({ label:"Loan Payoff at Sale", field:"dispLoanPayoff", placeholder:"outstanding balance repaid", prefix:"$" })}
                {tf({ label:"Disposition Notes", field:"dispNotes", placeholder:"rationale, terms, buyer profile", wide:true })}
              </>}
            </div>

          </div>
        );
      })()}

      {/* FINANCING & DEBT — shown once a deal is owned (status Owned). Manual entry. */}
      {(() => {
        const owned = d.status === "Owned" || d.status === "Sold";
        const f = (p) => <TxnField {...p} initial={d[p.field]} dealId={d.id} onUpdate={onUpdate} />;
        // Derived metrics
        const amt = Number(d.debtLoanAmount)||0, rate = Number(d.debtRate)||0, amortY = Number(d.debtAmortYears)||0;
        let annualDS = null;
        if (amt && rate) {
          if (amortY > 0) { const r = rate/100/12, n = amortY*12; annualDS = (r>0 ? amt*r/(1-Math.pow(1+r,-n)) : amt/n)*12; }
          else annualDS = amt * rate/100;
        }
        const pp = Number(d.txnPurchasePrice)||0;
        const equity = pp && amt ? pp - amt : null;
        const ltvCalc = pp && amt ? (amt/pp*100) : null;
        const noi = Number(d.noi)||0;
        const dscrCalc = annualDS && noi ? noi/annualDS : null;
        const Group = ({ title }) => <div style={{ gridColumn:"1 / -1", fontSize:13, fontWeight:600, color:"#383a37", marginTop:6, marginBottom:-2, display:"flex", alignItems:"center", gap:8 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"#6dba43" }}/>{title}</div>;

        if (!owned) {
          return (
            <div style={{ background:"#ffffff", border:"1px dashed #ddd4c2", borderRadius:12, padding:"16px 20px", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
              <div style={{ fontSize:13, color:"#837c6e" }}>
                <span style={{ fontWeight:600, color:"#383a37" }}>Financing & Debt</span> — set this deal's status to <span style={{ fontWeight:600 }}>Owned</span> to record acquisition financing (lender, rate, amortization, covenants).
              </div>
              <button onClick={()=>onUpdate(d.id,{status:"Owned"})}
                style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
                Mark as Owned
              </button>
            </div>
          );
        }
        return (
          <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:14 }}>Financing & Debt</div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14 }}>
              <Group title="Lender & Loan"/>
              {f({ label:"Lender / Servicer", field:"debtLender", placeholder:"e.g. JPMorgan, Fannie Mae" })}
              {f({ label:"Loan Type", field:"debtType", options:["Senior / Acquisition","Permanent","Bridge","Construction","Mezzanine","CMBS","Agency (Fannie/Freddie)","Life Co","Bank","Other"] })}
              {f({ label:"Original Loan Amount", field:"debtLoanAmount", placeholder:"e.g. 30,000,000", prefix:"$" })}
              {f({ label:"Lender Contact", field:"debtContact", placeholder:"Name / email / phone", wide:true })}

              <Group title="Rate"/>
              {f({ label:"Interest Rate", field:"debtRate", placeholder:"e.g. 6.25", suffix:"%" })}
              {f({ label:"Rate Type", field:"debtRateType", options:["Fixed","Floating"] })}
              {f({ label:"Index (if floating)", field:"debtIndex", placeholder:"e.g. 1-mo SOFR" })}
              {f({ label:"Spread / Margin", field:"debtSpread", placeholder:"e.g. 250", suffix:"bps" })}

              <Group title="Term & Amortization"/>
              {f({ label:"Origination / Close Date", field:"debtOriginationDate", placeholder:"YYYY-MM-DD" })}
              {f({ label:"Maturity Date", field:"debtMaturityDate", placeholder:"YYYY-MM-DD" })}
              {f({ label:"Term", field:"debtTermYears", placeholder:"e.g. 10", suffix:"yrs" })}
              {f({ label:"Amortization", field:"debtAmortYears", placeholder:"e.g. 30 (0 = IO)", suffix:"yrs" })}
              {f({ label:"Interest-Only Period", field:"debtIOPeriod", placeholder:"e.g. 36", suffix:"mo" })}
              {f({ label:"Extension Options", field:"debtExtensions", placeholder:"e.g. 2 × 1-yr" })}

              <Group title="Covenants & Terms"/>
              {f({ label:"LTV at Close", field:"debtLTV", placeholder:"e.g. 60", suffix:"%" })}
              {f({ label:"Recourse", field:"debtRecourse", options:["Non-Recourse","Full Recourse","Partial / Bad-Boy Carveouts"] })}
              {f({ label:"Assumable", field:"debtAssumable", options:["Yes","No","With Lender Approval"] })}
              {f({ label:"Prepayment", field:"debtPrepay", placeholder:"e.g. Yield maintenance, defeasance, 5-4-3-2-1 step-down" })}
              {f({ label:"Escrows / Reserves", field:"debtEscrows", placeholder:"e.g. Tax, insurance, TI/LC, replacement" })}
              {f({ label:"Notes", field:"debtNotes", placeholder:"Anything else worth recording", wide:true })}
            </div>

            {(annualDS || equity != null || ltvCalc || dscrCalc) && (
              <div style={{ marginTop:18, paddingTop:16, borderTop:"1px solid #f1eadc", display:"flex", gap:30, flexWrap:"wrap" }}>
                {annualDS && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Est. Annual Debt Service</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${Math.round(annualDS).toLocaleString()}</div></div>}
                {equity != null && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Equity Invested</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${equity.toLocaleString()}</div></div>}
                {ltvCalc && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Implied LTV</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:ltvCalc>75?"#dc2626":"#0f9d63" }}>{ltvCalc.toFixed(1)}%</div></div>}
                {dscrCalc && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Implied DSCR (NOI)</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:dscrCalc<1.2?"#dc2626":"#0f9d63" }}>{dscrCalc.toFixed(2)}x</div></div>}
              </div>
            )}
            <div style={{ marginTop:12, fontSize:11, color:"#b3aa9b", lineHeight:1.5 }}>Derived figures are estimates from the inputs above (debt service assumes level amortization; LTV/DSCR use your purchase price and the OM NOI). For reference only.</div>
          </div>
        );
      })()}

      {/* Debt + Site */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        <Card title="DEBT NOTED IN OM" accent={d.assumableDebt?"#0f9d6340":null}>
          <Row l="ASSUMABLE" v={d.assumableDebt===true?"YES":d.assumableDebt===false?"NO":null} c={d.assumableDebt?"#0f9d63":null}/>
          <Row l="LOAN BALANCE" v={d.loanBalance?`$${Number(d.loanBalance).toLocaleString()}`:null}/>
          <Row l="INTEREST RATE" v={d.loanRate?`${d.loanRate}%`:null}/>
          <Row l="MATURITY" v={d.loanMaturity}/>
          <Row l="TYPE" v={d.loanType}/>
        </Card>
        <Card title="PROPERTY INFO">
          <Row l="MARKET" v={d.market}/>
          <Row l="SUBMARKET" v={d.submarket}/>
          <Row l="BROKER" v={d.broker}/>
          <Row l="SELLER" v={d.seller}/>
          <Row l="LAST SALE DATE" v={d.lastSaleDate}/>
          <Row l="LAST SALE PRICE" v={d.lastSalePrice?`$${Number(d.lastSalePrice).toLocaleString()}`:null}/>
        </Card>
      </div>

      {/* Demographics */}
      {(d.trafficCountVPD||d.population3mi||d.medianHHIncome3mi) && (
        <Card title="DEMOGRAPHICS & SITE" accent={null}>
          {(() => { const loc = classifyLocation(d); if (!loc.density && !loc.income) return null; return (
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:12, paddingBottom:12, borderBottom:"1px solid #f1eadc" }}>
              {loc.density && (
                <div style={{ flex:"1 1 160px", background:`${loc.density.color}0f`, border:`1px solid ${loc.density.color}33`, borderRadius:10, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, color:"#a69e91", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:4 }}>Trade-Area Density</div>
                  <div style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:600, color:loc.density.color }}>{loc.density.tier}</div>
                  <div style={{ fontSize:11, color:"#837c6e", marginTop:2 }}>{loc.pop?`${Number(loc.pop).toLocaleString()} within 3 mi`:""}</div>
                </div>
              )}
              {loc.income && (
                <div style={{ flex:"1 1 160px", background:`${loc.income.color}0f`, border:`1px solid ${loc.income.color}33`, borderRadius:10, padding:"12px 14px" }}>
                  <div style={{ fontSize:10, color:"#a69e91", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:4 }}>Income Profile</div>
                  <div style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:600, color:loc.income.color }}>{loc.income.tier}</div>
                  <div style={{ fontSize:11, color:"#837c6e", marginTop:2 }}>{loc.inc?`$${Number(loc.inc).toLocaleString()} avg HHI`:""}</div>
                </div>
              )}
            </div>
          ); })()}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
            {[
              ["TRAFFIC/DAY", d.trafficCountVPD?`${Number(d.trafficCountVPD).toLocaleString()} VPD`:null, null],
              ["POP. 3MI", d.population3mi?`${Number(d.population3mi).toLocaleString()}`:null, null],
              ["MED. HHI 3MI", d.medianHHIncome3mi?`$${Number(d.medianHHIncome3mi).toLocaleString()}`:null, "#0f9d63"],
              ["AVG. HHI 3MI", d.avgHHIncome3mi?`$${Number(d.avgHHIncome3mi).toLocaleString()}`:null, "#0f9d63"],
            ].map(([l,v,c]) => (
              <div key={l} style={{ background:"#ffffff", padding:"8px 10px", borderRadius:5 }}>
                <div style={{ fontSize:8, color:"#958d80", marginBottom:3 }}>{l}</div>
                <div style={{ fontSize:12, color:c||"#5c5f57", fontWeight:500 }}>{v||"—"}</div>
              </div>
            ))}
          </div>
          {d.proximityHighways&&<div style={{ marginTop:8, fontSize:11, color:"#7d766a" }}>Highways: {d.proximityHighways}</div>}
          {d.retailCotenants&&<div style={{ marginTop:4, fontSize:11, color:"#7d766a" }}>Co-tenants: {d.retailCotenants}</div>}
        </Card>
      )}
      {(d.trafficCountVPD||d.population3mi||d.medianHHIncome3mi)&&<div style={{height:12}}/>}

      {/* Independently-pulled trade-area demographics (1/3/5-mi) */}
      <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"16px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom: d.marketDemographics?12:9, flexWrap:"wrap" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>Trade Area — 1 / 3 / 5 Mile</div>
          <button onClick={()=>onGetDemo(d.id)} disabled={demoBusy}
            style={{ background:"transparent", border:"1px solid #0d9488", color:demoBusy?"#a69e91":"#0d9488", padding:"5px 11px", borderRadius:5, cursor:demoBusy?"default":"pointer", fontSize:10, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
            {demoBusy?"PULLING…":(d.marketDemographics?"RE-PULL":"PULL DEMOGRAPHICS")}
          </button>
        </div>
        {d.marketDemographics ? (() => {
          const m = d.marketDemographics;
          const fmtN = v => v!=null?Number(v).toLocaleString():"—";
          const fmtD = v => v!=null?`$${Number(v).toLocaleString()}`:"—";
          const cc = m.confidence==="high"?"#0f9d63":m.confidence==="medium"?"#d9890c":"#a69e91";
          return (
            <>
              <div style={{ overflowX:"auto" }}>
                <table style={{ borderCollapse:"collapse", fontSize:12, width:"100%", minWidth:360 }}>
                  <thead><tr style={{ fontSize:10, color:"#a69e91", fontWeight:600 }}>
                    <th style={{ textAlign:"left", padding:"5px 8px" }}></th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>1 MILE</th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>3 MILE</th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>5 MILE</th>
                  </tr></thead>
                  <tbody>
                    <tr style={{ borderTop:"1px solid #f1eadc" }}>
                      <td style={{ padding:"7px 8px", color:"#a69e91" }}>Population</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#383a37" }}>{fmtN(m.pop1mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#383a37" }}>{fmtN(m.pop3mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#383a37" }}>{fmtN(m.pop5mi)}</td>
                    </tr>
                    <tr style={{ borderTop:"1px solid #f1eadc" }}>
                      <td style={{ padding:"7px 8px", color:"#a69e91" }}>Avg HH Income</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#0f9d63", fontWeight:500 }}>{fmtD(m.avgHHI1mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#0f9d63", fontWeight:500 }}>{fmtD(m.avgHHI3mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#0f9d63", fontWeight:500 }}>{fmtD(m.avgHHI5mi)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {(d.population3mi||d.avgHHIncome3mi) && (
                <div style={{ fontSize:10.5, color:"#a69e91", marginTop:8 }}>OM stated (3mi): {d.population3mi?`${Number(d.population3mi).toLocaleString()} pop`:"—"}{d.avgHHIncome3mi?` · $${Number(d.avgHHIncome3mi).toLocaleString()} avg HHI`:""}</div>
              )}
              <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap" }}>
                <span style={{ fontSize:9, fontWeight:700, color:cc, background:`${cc}1a`, padding:"2px 8px", borderRadius:10, textTransform:"uppercase", letterSpacing:"0.04em" }}>{m.confidence} confidence</span>
                {m.source && <span style={{ fontSize:10.5, color:"#837c6e" }}>{m.source}{m.asOf?` · ${m.asOf}`:""}</span>}
              </div>
              {m.note && <div style={{ fontSize:10.5, color:"#7d766a", lineHeight:1.55, marginTop:7 }}>{m.note}</div>}
              {(m.sources||[]).length>0 && (
                <div style={{ marginTop:8, display:"flex", flexWrap:"wrap", gap:10 }}>
                  {m.sources.map((s,i)=>(<a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:"#0d9488", textDecoration:"none" }}>↗ {s.title||"source"}</a>))}
                </div>
              )}
              <div style={{ fontSize:9, color:"#a69e91", marginTop:9, lineHeight:1.5 }}>AI-gathered from public Census/ACS-based sources{m.lookedUpAt?` on ${m.lookedUpAt.slice(0,10)}`:""}. Approximate — verify before relying on it.</div>
            </>
          );
        })() : (
          <div style={{ fontSize:11.5, color:"#a69e91", lineHeight:1.55 }}>{d.demoChecked?`No demographics found online (checked ${d.demoChecked.slice(0,10)}). `:""}Pull 1/3/5-mile population and average household income for this address from public Census/ACS-based sources.</div>
        )}
      </div>

      {/* AI Score */}
      {d.dealScore && (
        <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#958d80" }}>AI DEAL SCORE</div>
            <ScoreBadge score={d.dealScore}/>
          </div>
          <p style={{ fontSize:12, color:"#5c5f57", lineHeight:1.7, margin:"0 0 12px 0" }}>{d.dealScore.rationale}</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <div style={{ fontSize:8, color:"#0f9d63", letterSpacing:"0.08em", marginBottom:5 }}>STRENGTHS</div>
              {(d.dealScore.strengths||[]).map((s,i)=><div key={i} style={{ fontSize:11, color:"#7d766a", marginBottom:2 }}>› {s}</div>)}
            </div>
            <div>
              <div style={{ fontSize:8, color:"#dc2626", letterSpacing:"0.08em", marginBottom:5 }}>RISKS</div>
              {(d.dealScore.risks||[]).map((r,i)=><div key={i} style={{ fontSize:11, color:"#7d766a", marginBottom:2 }}>› {r}</div>)}
            </div>
          </div>
        </div>
      )}

      {/* Red Flags */}
      {(d.redFlags||[]).length>0 && (
        <div style={{ background:"#faf7f0", border:"1px solid #dc262630", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#dc2626", marginBottom:10 }}>⚠ RED FLAGS</div>
          {d.redFlags.map((f,i) => (
            <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom:i<d.redFlags.length-1?"1px solid #e7e0d2":"none", alignItems:"flex-start" }}>
              <span style={{ fontSize:9, padding:"2px 6px", borderRadius:3, background:f.severity==="high"?"#dc262620":f.severity==="medium"?"#383a3720":"#7d766a20", color:f.severity==="high"?"#dc2626":f.severity==="medium"?"#383a37":"#7d766a", flexShrink:0, letterSpacing:"0.05em" }}>{f.severity?.toUpperCase()}</span>
              <span style={{ fontSize:11, color:"#5c5f57" }}>{f.description}</span>
            </div>
          ))}
        </div>
      )}

      {/* Key assumptions & footnotes (deal-level + per-tenant) — high importance */}
      {/* Key assumptions & footnotes (collapsible) */}
      <KeyAssumptions deal={d}/>

      {/* Tenant roster (dynamic) */}
      {(d.tenants||[]).length>0 && <TenantRoster tenants={d.tenants} onTenantClick={onTenantClick}/>}

      {/* Shadow anchors — directly below the tenant roster */}
      {d.shadowAnchors && (
        <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"16px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", marginBottom:8, fontWeight:600, textTransform:"uppercase" }}>Shadow Anchors / Unowned Parcels</div>
          <div style={{ fontSize:13, color:"#5c5f57", lineHeight:1.6 }}>{d.shadowAnchors}</div>
        </div>
      )}

      {/* Multi-year Cash Flow Projection */}
      {(d.cashFlowProjection||[]).length>0 && (
        <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", marginBottom:12, fontWeight:600, textTransform:"uppercase" }}>Cash Flow Projection — {d.cashFlowProjection.length} periods</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", fontSize:12, minWidth: 150 + d.cashFlowProjection.length*108 }}>
              <thead>
                <tr style={{ fontSize:10, color:"#a69e91", fontWeight:600 }}>
                  <th style={{ textAlign:"left", padding:"6px 10px", position:"sticky", left:0, background:"#ffffff", zIndex:1 }}></th>
                  {d.cashFlowProjection.map((r,i)=><th key={i} style={{ textAlign:"right", padding:"6px 10px", whiteSpace:"nowrap", fontWeight:i===0?700:600, color:i===0?"#383a37":"#a69e91" }}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Base Rent","totalBaseRent","#5c5f57"],
                  ["Reimbursements","reimbursements","#5c5f57"],
                  ["Effective Gross Rev.","egr","#383a37"],
                  ["Operating Expenses","operatingExpenses","#837c6e"],
                  ["NOI","noi","#0f9d63"],
                ].map(([label,key,color])=>(
                  <tr key={key} style={{ borderTop:"1px solid #f1eadc", background: key==="noi"?"#0f9d6308":"transparent" }}>
                    <td style={{ textAlign:"left", padding:"8px 10px", color: key==="noi"?"#0f7a4e":"#a69e91", fontWeight: key==="noi"?700:500, whiteSpace:"nowrap", position:"sticky", left:0, background: key==="noi"?"#f2faef":"#ffffff", zIndex:1 }}>{label}</td>
                    {d.cashFlowProjection.map((r,ci)=>(
                      <td key={ci} style={{ textAlign:"right", padding:"8px 10px", color, fontWeight: key==="noi"?700:400, whiteSpace:"nowrap" }}>{r[key]!=null?`$${Number(r[key]).toLocaleString()}`:"—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.cashFlowProjection.length>1 && d.cashFlowProjection[0].noi && d.cashFlowProjection[d.cashFlowProjection.length-1].noi && (
            <div style={{ marginTop:10, fontSize:12, color:"#5c5f57" }}>
              NOI growth: <span style={{ color:"#0f9d63", fontWeight:600 }}>
                {(((d.cashFlowProjection[d.cashFlowProjection.length-1].noi / d.cashFlowProjection[0].noi) - 1) * 100).toFixed(1)}%
              </span> over the projection period
            </div>
          )}
        </div>
      )}

      {/* Income & Expense Breakdown */}
      {(d.incomeBreakdown || d.expenseBreakdown) && (() => {
        const ib = d.incomeBreakdown || {}, eb = d.expenseBreakdown || {};
        const inc = [
          ["Anchor base rent", ib.anchorBaseRent], ["Shop base rent", ib.shopBaseRent],
          ["CAM reimbursements", ib.camReimbursements], ["RE tax reimbursements", ib.realEstateTaxReimbursements],
          ["Insurance reimbursements", ib.insuranceReimbursements], ["Percentage rent", ib.percentageRentIncome],
          ["Vacancy loss", ib.vacancyLoss],
        ].filter(r=>r[1]!=null);
        const exp = [
          ["Common area", eb.commonAreaExpenses], ["Real estate tax", eb.realEstateTax],
          ["Insurance", eb.insurance], ["Management fee", eb.managementFee],
        ].filter(r=>r[1]!=null);
        if (!inc.length && !exp.length) return null;
        return (
          <div style={{ display:"flex", gap:14, marginBottom:14, flexWrap:"wrap" }}>
            {inc.length>0 && (
              <div style={{ flex:"1 1 280px", background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", marginBottom:10, fontWeight:600, textTransform:"uppercase" }}>Income Breakdown</div>
                {inc.map(([k,v],i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"5px 0", borderTop:i>0?"1px solid #f4f6f7":"none" }}>
                    <span style={{ color:"#5c5f57" }}>{k}</span>
                    <span style={{ color:k==="Vacancy loss"?"#dc2626":"#383a37", fontWeight:500 }}>${Number(v).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            {exp.length>0 && (
              <div style={{ flex:"1 1 280px", background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", marginBottom:10, fontWeight:600, textTransform:"uppercase" }}>Expense Breakdown</div>
                {exp.map(([k,v],i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"5px 0", borderTop:i>0?"1px solid #f4f6f7":"none" }}>
                    <span style={{ color:"#5c5f57" }}>{k}</span>
                    <span style={{ color:"#383a37", fontWeight:500 }}>${Number(v).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Roof & Capital — roof ages drive capital reserve decisions */}
      {d.roofData && (d.roofData.summary || d.roofData.concern || (d.roofData.sections||[]).length>0) && (() => {
        const rd = d.roofData;
        const sections = (rd.sections||[]).filter(s=>s && (s.area||s.installedYear!=null||s.ageYears!=null||s.condition));
        return (
          <div style={{ background:"#ffffff", border:`1px solid ${rd.concern?"#e7c48f":"#efe8da"}`, borderLeft: rd.concern?"3px solid #d9890c":"1px solid #efe8da", borderRadius:12, padding:"16px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", marginBottom:10, fontWeight:600, textTransform:"uppercase" }}>Roof &amp; Capital</div>
            {rd.concern && (
              <div style={{ background:"#fff3e0", border:"1px solid #e7c48f", borderRadius:8, padding:"9px 12px", marginBottom:sections.length||rd.summary?11:0, fontSize:12.5, color:"#8a5a12", lineHeight:1.55 }}>
                <span style={{ fontWeight:700 }}>⚠ Capital flag — </span>{rd.concern}
              </div>
            )}
            {rd.summary && <div style={{ fontSize:13, color:"#5c5f57", lineHeight:1.6, marginBottom: sections.length?12:0 }}>{rd.summary}</div>}
            {sections.length>0 && (
              <div style={{ overflowX:"auto" }}>
                <table style={{ borderCollapse:"collapse", fontSize:12, width:"100%", minWidth:420 }}>
                  <thead><tr style={{ fontSize:10, color:"#a69e91", fontWeight:600 }}>
                    <th style={{ textAlign:"left", padding:"5px 8px" }}>AREA</th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>INSTALLED</th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>AGE</th>
                    <th style={{ textAlign:"left", padding:"5px 8px" }}>CONDITION</th>
                  </tr></thead>
                  <tbody>
                    {sections.map((s,i)=>{
                      const age = s.ageYears!=null?Number(s.ageYears):(s.installedYear?(new Date().getFullYear()-Number(s.installedYear)):null);
                      const old = age!=null && age>=18;
                      return (
                        <tr key={i} style={{ borderTop:"1px solid #f1eadc" }}>
                          <td style={{ padding:"7px 8px", color:"#383a37" }}>{s.area||"—"}</td>
                          <td style={{ padding:"7px 8px", textAlign:"right", color:"#5c5f57" }}>{s.installedYear||"—"}</td>
                          <td style={{ padding:"7px 8px", textAlign:"right", fontWeight:old?700:400, color:old?"#dc2626":"#5c5f57" }}>{age!=null?`${age} yr`:"—"}</td>
                          <td style={{ padding:"7px 8px", color:"#5c5f57" }}>{s.condition||"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div style={{ fontSize:10, color:"#a69e91", marginTop:7 }}>Roofs 18+ years are flagged red — likely needing replacement reserves.</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Underwriting Assumptions table hidden from the detail view to save space —
          the data is still extracted and available to the analyst. */}

      {/* Shadow anchors moved to directly below the tenant roster */}

      {/* Comparables */}
      {(d.comparableSales||[]).length>0 && (
        <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#958d80", marginBottom:10 }}>COMPARABLE SALES — {d.comparableSales.length} comps</div>
          <div style={{ display:"grid", gridTemplateColumns:"2fr 0.8fr 1fr 0.7fr 0.8fr", gap:8, fontSize:8, color:"#958d80", marginBottom:6 }}>
            {["ADDRESS","DATE","PRICE","CAP","$/SF"].map(h=><span key={h}>{h}</span>)}
          </div>
          {d.comparableSales.map((c,i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 0.8fr 1fr 0.7fr 0.8fr", gap:8, fontSize:11, padding:"6px 0", borderTop:"1px solid #e7e0d2", alignItems:"center" }}>
              <span style={{ color:"#5c5f57" }}>{c.address}</span>
              <span style={{ color:"#7d766a", fontSize:10 }}>{c.saleDate||"—"}</span>
              <span style={{ color:"#6dba43" }}>{c.salePrice?`$${Number(c.salePrice).toLocaleString()}`:"—"}</span>
              <span style={{ color:"#0f9d63" }}>{c.capRate?`${c.capRate}%`:"—"}</span>
              <span style={{ color:"#5c5f57" }}>{c.pricePerSF?`$${c.pricePerSF}`:"—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* "Additional fields extracted" table hidden from the detail view to save
          space — extraFields are still stored and surfaced to the analyst (and as
          Emerging Metrics on the home screen). */}

      {/* Edit history — audit trail of manual changes */}
      <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, gap:10, flexWrap:"wrap" }}>
          <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#958d80" }}>EDIT HISTORY{(d.editHistory||[]).length>0?` — ${d.editHistory.length}`:""}</div>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontSize:9, color:"#a69e91" }}>edits recorded as</span>
            <input value={editor||""} onChange={e=>onEditor(e.target.value)} placeholder="your name"
              style={{ width:104, fontSize:10, padding:"3px 8px", border:"1px solid #e7e0d2", borderRadius:4, color:"#383a37", background:"#fff", fontFamily:"'Inter',sans-serif" }}/>
          </div>
        </div>
        {(d.editHistory||[]).length===0 ? (
          <div style={{ fontSize:11, color:"#a69e91", lineHeight:1.5 }}>No edits recorded yet. Status changes, notes, and field edits will be logged here with a timestamp and your name.</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {[...d.editHistory].reverse().slice(0,50).map((h,i) => (
              <div key={i} style={{ borderLeft:"2px solid #e7e0d2", paddingLeft:11 }}>
                <div style={{ fontSize:10, color:"#958d80" }}>
                  <span style={{ fontWeight:600, color:"#383a37" }}>{h.by||"Unknown"}</span> · {(()=>{ try { return new Date(h.ts).toLocaleString(); } catch { return h.ts; } })()}
                </div>
                {(h.changes||[]).map((c,j) => (
                  <div key={j} style={{ fontSize:11, color:"#6f6a5f", marginTop:2 }}>
                    <span style={{ color:"#383a37" }}>{c.field}</span>: <span style={{ color:"#a69e91" }}>{c.from}</span> → <span style={{ color:"#383a37", fontWeight:500 }}>{c.to}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Version history */}
      {versions.length>1 && (
        <div style={{ background:"#faf7f0", border:"1px solid #383a3735", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#383a37", marginBottom:10 }}>⟳ VERSION HISTORY — {versions.length} OMs</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 0.6fr 0.7fr 0.6fr 0.6fr 0.5fr", gap:8, fontSize:8, color:"#958d80", marginBottom:6 }}>
            {["OM DATE","CAP RATE","ASKING","OCC.","DATA",""].map(h=><span key={h}>{h}</span>)}
          </div>
          {versions.map((v,i) => (
            <div key={v.id} style={{ display:"grid", gridTemplateColumns:"1fr 0.6fr 0.7fr 0.6fr 0.6fr 0.5fr", gap:8, padding:"6px 0", borderTop:"1px solid #e7e0d2", alignItems:"center", fontSize:11 }}>
              <span style={{ color:v.id===d.id?"#383a37":"#5c5f57", fontWeight:v.id===d.id?600:400 }}>{v.omDate||v.uploadedAt?.slice(0,10)||"?"}{v.id===d.id?" ←":""}</span>
              <span style={{ color:"#0f9d63" }}>{v.capRate?`${v.capRate}%`:"—"}</span>
              <span style={{ color:"#6dba43" }}>{v.askingPrice?`$${(v.askingPrice/1e6).toFixed(1)}M`:"—"}</span>
              <span style={{ color:"#383a37" }}>{v.occupancy?`${v.occupancy}%`:"—"}</span>
              <RecencyBadge deal={v} compact/>
              {v.id!==d.id&&<button onClick={()=>onCompare(d,v)} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"2px 7px", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"'Inter',sans-serif" }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#383a37";e.currentTarget.style.color="#383a37"}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#e7e0d2";e.currentTarget.style.color="#7d766a"}}>COMPARE</button>}
            </div>
          ))}
          <button onClick={()=>onQuery(`Compare all ${versions.length} versions of "${d.propertyName}" chronologically. What changed in cap rate, WALT, asking price, occupancy, tenant roster, and rent? Is the asset trending better or worse? Give a verdict.`)}
            style={{ marginTop:10, background:"transparent", border:"1px solid #383a37", color:"#383a37", padding:"4px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>
            AI: ANALYZE ALL VERSIONS →
          </button>
        </div>
      )}

      {/* Team notes */}
      <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#958d80" }}>TEAM NOTES</div>
          {!editNotes
            ? <button onClick={()=>setEditNotes(true)} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#6f6a5f", padding:"2px 8px", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"'Inter',sans-serif" }}>EDIT</button>
            : <button onClick={()=>{ onUpdate(d.id,{userNotes:notesVal}); setEditNotes(false); }} style={{ background:"#6dba43", border:"none", color:"#383a37", padding:"2px 8px", borderRadius:3, cursor:"pointer", fontSize:9, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>SAVE</button>
          }
        </div>
        {editNotes
          ? <textarea value={notesVal} onChange={e=>setNotesVal(e.target.value)} rows={3}
              style={{ width:"100%", background:"#ffffff", border:"1px solid #e7e0d2", borderRadius:4, padding:"8px 10px", color:"#383a37", fontSize:12, fontFamily:"'Inter',sans-serif", resize:"vertical", outline:"none", boxSizing:"border-box" }}/>
          : <p style={{ color:d.userNotes?"#5c5f57":"#958d80", fontSize:12, lineHeight:1.7, margin:0 }}>{d.userNotes||"No notes yet."}</p>
        }
      </div>
    </div>
  );
}

// ── Compare View ──────────────────────────────────────────────
// Cross-portfolio tenant summary: overview stats up top, then a sortable table of
// every property in the database where this tenant appears. Reached by clicking a
// tenant name in any roster.
function TenantView({ tenantName, deals, onBack, onOpenDeal }) {
  const norm = s => (s||"").trim().toLowerCase();
  const target = norm(tenantName);
  const num = v => (v==null||v===""||isNaN(Number(v))) ? null : Number(v);
  const rows = [];
  (deals||[]).forEach(d => (d.tenants||[]).forEach(t => { if (norm(t.name) === target) rows.push({ deal:d, t }); }));

  const [sortKey, setSortKey] = useState("sf");
  const [sortDir, setSortDir] = useState("desc");
  const setSort = k => { if (sortKey===k) setSortDir(x=>x==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir(["property","market","expiry","reimbursement"].includes(k)?"asc":"desc"); } };
  const val = (r,k) => {
    switch(k){
      case "property": return norm(r.deal.propertyName);
      case "market": return norm(r.deal.market);
      case "sf": return num(r.t.sf);
      case "rentPSF": return num(r.t.rentPerSF);
      case "annualRent": return num(r.t.annualRent);
      case "expiry": return r.t.leaseExpiry||"";
      case "salesPSF": return num(r.t.salesPSF);
      case "reimbursement": return norm(r.t.reimbursementMethod);
      default: return null;
    }
  };
  const sorted = [...rows].sort((a,b)=>{ const av=val(a,sortKey), bv=val(b,sortKey), dir=sortDir==="asc"?1:-1; if(av==null&&bv==null)return 0; if(av==null)return 1; if(bv==null)return -1; if(typeof av==="number"&&typeof bv==="number")return (av-bv)*dir; return String(av).localeCompare(String(bv))*dir; });

  const totalSF = rows.reduce((s,r)=>s+(num(r.t.sf)||0),0);
  const totalRent = rows.reduce((s,r)=>s+(num(r.t.annualRent)||0),0);
  const avgPSF = totalSF ? totalRent/totalSF : null;
  const anchors = rows.filter(r=>r.t.isAnchor).length;
  const credit = rows.map(r=>r.t.creditRating).find(Boolean);
  const salesVals = rows.map(r=>num(r.t.salesPSF)).filter(v=>v!=null);
  const avgSales = salesVals.length ? salesVals.reduce((a,b)=>a+b,0)/salesVals.length : null;
  const arrow = k => sortKey===k ? (sortDir==="asc"?" ▲":" ▼") : "";
  const cols = [["property","Property",0],["market","Market",0],["sf","SF",1],["rentPSF","Rent/SF",1],["annualRent","Ann. Rent",1],["expiry","Expiry",0],["salesPSF","Sales/SF",1],["reimbursement","Reimb.",0]];
  const stat = (l,v) => (
    <div key={l} style={{ flex:"1 1 130px", background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"13px 16px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ fontSize:10, letterSpacing:"0.06em", color:"#a69e91", marginBottom:6, fontWeight:500, textTransform:"uppercase" }}>{l}</div>
      <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:600, color:"#383a37", lineHeight:1 }}>{v}</div>
    </div>
  );

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      <div style={{ marginBottom:16 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4, flexWrap:"wrap" }}>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:600, color:"#26281f", margin:0 }}>{tenantName}</h1>
        {anchors>0 && <span style={{ fontSize:10, color:"#1f2b16", background:"#6dba4322", padding:"2px 9px", borderRadius:12, fontWeight:700 }}>ANCHOR · {anchors}</span>}
        {credit && <span style={{ fontSize:11, color:"#5c5f57", background:"#f3eee3", border:"1px solid #e7e0d2", padding:"2px 9px", borderRadius:12 }}>Credit: {credit}</span>}
      </div>
      <div style={{ fontSize:13, color:"#9a917f", marginBottom:18 }}>Across {rows.length} {rows.length===1?"property":"properties"} in your database</div>

      <div style={{ display:"flex", gap:11, flexWrap:"wrap", marginBottom:22 }}>
        {stat("Locations", rows.length)}
        {stat("Total SF Leased", totalSF?totalSF.toLocaleString():"—")}
        {stat("Total Annual Rent", totalRent?`$${totalRent.toLocaleString()}`:"—")}
        {stat("Avg Rent / SF", avgPSF!=null?`$${avgPSF.toFixed(2)}`:"—")}
        {stat("Avg Sales / SF", avgSales!=null?`$${Math.round(avgSales).toLocaleString()}`:"—")}
      </div>

      <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
        <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:13 }}>Locations — click a row to open the property</div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ borderCollapse:"collapse", fontSize:12.5, minWidth:820, width:"100%" }}>
            <thead><tr style={{ fontSize:10, letterSpacing:"0.03em" }}>
              {cols.map(([k,label,right])=>(
                <th key={k} onClick={()=>setSort(k)} style={{ padding:"6px 10px", textAlign:right?"right":"left", cursor:"pointer", whiteSpace:"nowrap", userSelect:"none", color:sortKey===k?"#383a37":"#a69e91", fontWeight:600 }}>{label}{arrow(k)}</th>
              ))}
            </tr></thead>
            <tbody>
              {sorted.map((r,i)=>(
                <tr key={i} onClick={()=>onOpenDeal(r.deal)} style={{ borderTop:"1px solid #f1eadc", cursor:"pointer" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#faf7f0"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{ padding:"9px 10px", color:"#383a37", fontWeight:600, whiteSpace:"nowrap" }}>{r.deal.propertyName||"Untitled"}{r.t.isAnchor&&<span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>ANCHOR</span>}</td>
                  <td style={{ padding:"9px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{r.deal.market||cityState(r.deal)||"—"}</td>
                  <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{num(r.t.sf)!=null?num(r.t.sf).toLocaleString():"—"}</td>
                  <td style={{ padding:"9px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{num(r.t.rentPerSF)!=null?`$${num(r.t.rentPerSF).toFixed(2)}`:"—"}</td>
                  <td style={{ padding:"9px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{num(r.t.annualRent)!=null?`$${num(r.t.annualRent).toLocaleString()}`:"—"}</td>
                  <td style={{ padding:"9px 10px", color:"#5c5f57", whiteSpace:"nowrap" }}>{r.t.leaseExpiry||"—"}</td>
                  <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{num(r.t.salesPSF)!=null?`$${r.t.salesPSF}`:"—"}</td>
                  <td style={{ padding:"9px 10px", color:"#837c6e", fontSize:11, whiteSpace:"nowrap" }}>{r.t.reimbursementMethod||r.t.leaseType||"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length===0 && <div style={{ fontSize:13, color:"#a69e91", padding:"10px 0" }}>No locations found for this tenant.</div>}
      </div>
    </div>
  );
}

function CompareView({ deals:[a,b], onBack, onQuery }) {
  const older = new Date(a.omDate||a.uploadedAt) < new Date(b.omDate||b.uploadedAt) ? a : b;
  const newer = older.id===a.id ? b : a;

  function delta(nv, ov, fmt) {
    if (nv==null||ov==null) return null;
    const d = nv - ov;
    if (Math.abs(d)<0.001) return <span style={{color:"#7d766a",fontSize:10}}>—</span>;
    const label = fmt ? fmt(Math.abs(d)) : `${d>0?"+":""}${d.toFixed(2)}`;
    return <span style={{ fontSize:10, color:d>0?"#0f9d63":"#dc2626", marginLeft:5 }}>({d>0?"↑":"↓"}{label})</span>;
  }

  const rows = [
    {l:"OM DATE", av:older.omDate||older.uploadedAt?.slice(0,10), bv:newer.omDate||newer.uploadedAt?.slice(0,10)},
    {l:"ASKING PRICE", av:older.askingPrice?`$${Number(older.askingPrice).toLocaleString()}`:null, bv:newer.askingPrice?`$${Number(newer.askingPrice).toLocaleString()}`:null, dx:delta(newer.askingPrice,older.askingPrice,v=>`$${(v/1000).toFixed(0)}K`)},
    {l:"CAP RATE", av:older.capRate?`${older.capRate}%`:null, bv:newer.capRate?`${newer.capRate}%`:null, dx:delta(newer.capRate,older.capRate,v=>`${v.toFixed(2)}%`)},
    {l:"NOI", av:older.noi?`$${Number(older.noi).toLocaleString()}`:null, bv:newer.noi?`$${Number(newer.noi).toLocaleString()}`:null, dx:delta(newer.noi,older.noi,v=>`$${(v/1000).toFixed(0)}K`)},
    {l:"WALT", av:older.walt?`${older.walt}yr`:null, bv:newer.walt?`${newer.walt}yr`:null, dx:delta(newer.walt,older.walt,v=>`${v.toFixed(1)}yr`)},
    {l:"OCCUPANCY", av:older.occupancy?`${older.occupancy}%`:null, bv:newer.occupancy?`${newer.occupancy}%`:null, dx:delta(newer.occupancy,older.occupancy,v=>`${v.toFixed(1)}%`)},
    {l:"PRICE / SF", av:older.pricePerSF?`$${older.pricePerSF}`:null, bv:newer.pricePerSF?`$${newer.pricePerSF}`:null, dx:delta(newer.pricePerSF,older.pricePerSF,v=>`$${v.toFixed(2)}`)},
    {l:"WTAVG RENT/SF", av:older.weightedAvgRentPSF?`$${older.weightedAvgRentPSF}`:null, bv:newer.weightedAvgRentPSF?`$${newer.weightedAvgRentPSF}`:null, dx:delta(newer.weightedAvgRentPSF,older.weightedAvgRentPSF,v=>`$${v.toFixed(2)}`)},
    {l:"BROKER", av:older.broker, bv:newer.broker},
    {l:"AI SCORE", av:<ScoreBadge score={older.dealScore} size={11}/>, bv:<ScoreBadge score={newer.dealScore} size={11}/>},
  ];

  const oldT = new Set((older.tenants||[]).map(t=>t.name?.toLowerCase()));
  const newT = new Set((newer.tenants||[]).map(t=>t.name?.toLowerCase()));
  const added = [...newT].filter(n=>!oldT.has(n));
  const removed = [...oldT].filter(n=>!newT.has(n));

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
        <button onClick={()=>onQuery(`Deep analysis: compare the ${older.omDate||"older"} and ${newer.omDate||"newer"} versions of "${newer.propertyName}". What changed financially, operationally, and in tenant composition? Is this trending better or worse? What does it signal about the asset quality?`)}
          style={{ background:"transparent", border:"1px solid #383a37", color:"#383a37", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>
          AI: DEEP CHANGE ANALYSIS →
        </button>
      </div>

      <div style={{ fontSize:8, color:"#958d80", letterSpacing:"0.1em", marginBottom:5 }}>VERSION COMPARISON</div>
      <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:19, fontWeight:800, color:"#2a2c27", margin:"0 0 14px 0" }}>{newer.propertyName}</h1>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:12 }}>
        <div/>
        <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:6, padding:"9px 12px", textAlign:"center" }}>
          <div style={{ fontSize:8, color:"#958d80", marginBottom:4 }}>OLDER</div><RecencyBadge deal={older}/>
        </div>
        <div style={{ background:"#faf7f0", border:"1px solid #0f9d6340", borderRadius:6, padding:"9px 12px", textAlign:"center" }}>
          <div style={{ fontSize:8, color:"#383a37", marginBottom:4 }}>NEWER</div><RecencyBadge deal={newer}/>
        </div>
      </div>

      <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, overflow:"hidden", marginBottom:12 }}>
        {rows.map((row,i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", borderBottom:i<rows.length-1?"1px solid #e7e0d2":"none" }}>
            <div style={{ padding:"9px 14px", fontSize:9, color:"#6f6a5f", background:"#ffffff", display:"flex", alignItems:"center" }}>{row.l}</div>
            <div style={{ padding:"9px 14px", fontSize:11, color:"#7d766a", borderLeft:"1px solid #e7e0d2", display:"flex", alignItems:"center" }}>{row.av||<span style={{color:"#958d80"}}>—</span>}</div>
            <div style={{ padding:"9px 14px", fontSize:11, color:"#383a37", borderLeft:"1px solid #e7e0d2", display:"flex", alignItems:"center", fontWeight:500 }}>{row.bv||<span style={{color:"#958d80"}}>—</span>}{row.dx}</div>
          </div>
        ))}
      </div>

      {(added.length>0||removed.length>0) && (
        <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"12px 16px", marginBottom:12 }}>
          <div style={{ fontSize:8, color:"#958d80", marginBottom:8 }}>TENANT CHANGES</div>
          {added.length>0&&<><div style={{ fontSize:9, color:"#0f9d63", marginBottom:4 }}>ADDED ({added.length})</div>{added.map(n=><div key={n} style={{ fontSize:11, color:"#7d766a", marginBottom:2 }}>+ {n}</div>)}</>}
          {removed.length>0&&<><div style={{ fontSize:9, color:"#dc2626", marginTop:8, marginBottom:4 }}>REMOVED ({removed.length})</div>{removed.map(n=><div key={n} style={{ fontSize:11, color:"#7d766a", marginBottom:2 }}>- {n}</div>)}</>}
        </div>
      )}

      {(older.dealScore||newer.dealScore) && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {[older,newer].map((d,i) => d.dealScore&&(
            <div key={i} style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"12px 14px" }}>
              <div style={{ fontSize:8, color:"#958d80", marginBottom:6 }}>{i===0?"OLDER":"NEWER"} SCORE</div>
              <div style={{ marginBottom:6 }}><ScoreBadge score={d.dealScore}/></div>
              <p style={{ fontSize:11, color:"#7d766a", lineHeight:1.7, margin:"0 0 8px 0" }}>{d.dealScore.rationale}</p>
              {(d.dealScore.risks||[]).map((r,j)=><div key={j} style={{ fontSize:10, color:"#6f6a5f", marginBottom:2 }}>› {r}</div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}