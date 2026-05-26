import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
  "centerType": "For retail, the center FORMAT: Grocery-Anchored|Power Center|Neighborhood Center|Community Center|Lifestyle Center|Regional Mall|Super-Regional Mall|Outlet Center|Strip/Unanchored|Single-Tenant NNN|Mixed-Use|Other. Infer from anchors and description. null if not retail.",
  "urbanicity": "Urban|Suburban|Exurban|Rural or null",
  "omDate": "YYYY-MM-DD or null",
  "askingPrice": "number or null — ONLY if explicitly stated",
  "capRate": "number or null — ONLY if explicitly stated",
  "noi": "number or null",
  "grossPotentialRent": "number or null",
  "effectiveGrossIncome": "number or null",
  "operatingExpenses": "number or null",
  "expenseRatio": "number or null",
  "nnnRecoveries": "number or null",
  "occupancy": "number or null",
  "totalSF": "number or null",
  "pricePerSF": "number or null",
  "walt": "number or null",
  "weightedAvgRentPSF": "number or null",
  "yearBuilt": "number or null",
  "renovationYear": "number or null",
  "numberOfBuildings": "number or null",
  "numberOfUnits": "number or null",
  "lotSizeAcres": "number or null",
  "parkingSpaces": "number or null",
  "parkingRatio": "number or null",
  "constructionType": "string or null",
  "zoning": "string or null",
  "roofData": {
    "summary": "string or null",
    "sections": [{"area": "string", "installedYear": "number or null", "ageYears": "number or null", "condition": "string or null"}],
    "concern": "string or null — flag only if large share of roof area is old/near end-of-life"
  },
  "lastSaleDate": "YYYY-MM-DD or null",
  "lastSalePrice": "number or null",
  "assumableDebt": "true|false|null",
  "loanBalance": "number or null",
  "loanRate": "number or null",
  "loanMaturity": "string or null",
  "loanType": "Fixed|Floating|null",
  "broker": "string",
  "seller": "string or null",
  "trafficCountVPD": "number or null",
  "population1mi": "number or null",
  "population3mi": "number or null",
  "population5mi": "number or null",
  "medianHHIncome3mi": "number or null",
  "avgHHIncome3mi": "number or null",
  "proximityHighways": "string or null",
  "retailCotenants": "string or null",
  "tenants": [
    {
      "name": "string",
      "suite": "string or null",
      "sf": "number or null",
      "rentPerSF": "number or null",
      "annualRent": "number or null",
      "leaseStart": "string or null",
      "leaseExpiry": "string",
      "leaseType": "NNN|Gross|Modified Gross|null",
      "reimbursementMethod": "string or null",
      "percentOfNOI": "number or null",
      "rentBumps": "string — summarize pattern, e.g. '3%/yr'",
      "rentSchedule": "string or null",
      "renewalOptions": "string or null",
      "recentlyExercisedRenewal": "string or null",
      "percentageRent": "string or null",
      "creditRating": "Investment Grade|Non-Investment Grade|null",
      "salesPSF": "number or null",
      "salesNotes": "string or null",
      "occupancyCost": "number or null",
      "assumptionNote": "string or null — any footnote/assumption for this tenant",
      "isAnchor": "true|false",
      "originalLeaseDate": "string or null",
      "remainingTermYears": "number or null"
    }
  ],
  "cashFlowProjection": [{"label": "string", "noi": "number or null", "egr": "number or null", "totalBaseRent": "number or null", "reimbursements": "number or null", "operatingExpenses": "number or null", "netCashFlow": "number or null"}],
  "incomeBreakdown": {"anchorBaseRent": "number or null", "shopBaseRent": "number or null", "camReimbursements": "number or null", "realEstateTaxReimbursements": "number or null", "insuranceReimbursements": "number or null", "percentageRentIncome": "number or null", "vacancyLoss": "number or null"},
  "expenseBreakdown": {"commonAreaExpenses": "number or null", "realEstateTax": "number or null", "insurance": "number or null", "managementFee": "number or null"},
  "underwritingAssumptions": {"analysisPeriodYears": "number or null", "analysisStartDate": "string or null", "expenseInflation": "string or null", "marketRentInflation": "string or null", "capitalReserves": "string or null", "managementFeePct": "string or null", "generalVacancyLoss": "string or null", "renewalProbability": "string or null", "tiAllowance": "string or null", "leasingCommissions": "string or null", "marketRentsBySpaceType": "string or null"},
  "shadowAnchors": "string or null — ONLY on-site parcels NOT part of this sale (NAP/unowned). Most centers have none.",
  "keyAssumptions": ["array of deal-level footnotes affecting underwriting — empty array if none"],
  "comparableSales": [{"address": "string", "saleDate": "string", "salePrice": "number or null", "capRate": "number or null", "pricePerSF": "number or null", "sf": "number or null"}],
  "dealScore": {"grade": "A+|A|B+|B|C+|C|D", "rationale": "one precise sentence", "strengths": ["string"], "risks": ["string"]},
  "redFlags": [{"severity": "high|medium|low", "description": "string — high only for substantial roof end-of-life or anchor with weak credit/closure history. NEVER flag absent asking price or non-reassessed RE taxes."}],
  "notes": "2-3 sentence investment summary",
  "extraFields": {"any_other_notable_metric": "value"}
}

PRIORITIES: Capture all footnotes/assumptions (assumptionNote, keyAssumptions). Capture roof ages. Only fill askingPrice/capRate when explicitly stated. shadowAnchors = null unless OM explicitly marks on-site parcel as NAP/unowned.

Return ONLY raw JSON. No markdown, no code fences, no explanation.`;

async function callAnthropicOnce(body: object, retryCount = 0): Promise<Response> {
  const resp = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if ((resp.status === 429 || resp.status === 529 || resp.status === 503) && retryCount < 5) {
    const retryAfter = parseFloat(resp.headers.get("retry-after") ?? "");
    const waitMs = isNaN(retryAfter)
      ? Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 500, 30000)
      : Math.min(retryAfter * 1000, 60000);
    await new Promise((r) => setTimeout(r, waitMs));
    return callAnthropicOnce(body, retryCount + 1);
  }

  return resp;
}

function robustParseJSON(raw: string): unknown {
  if (!raw?.trim()) throw new Error("Empty response");
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try { return JSON.parse(s); } catch {}

  try { return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1")); } catch {}

  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)); } catch {}
  }

  if (first !== -1) {
    try { return repairTruncatedJSON(s.slice(first)); } catch {}
  }

  throw new Error("All parse strategies failed");
}

function repairTruncatedJSON(s: string): unknown {
  let inStr = false, esc = false;
  const stack: string[] = [];
  let safeLen = -1, safeClosers = "";
  const closersFor = () => stack.map((b) => (b === "{" ? "}" : "]")).reverse().join("");

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
    else if (c === "}" || c === "]") { stack.pop(); safeLen = i + 1; safeClosers = closersFor(); }
    else if (c === ",") { safeLen = i; safeClosers = closersFor(); }
  }

  if (safeLen <= 0) throw new Error("Could not repair truncated JSON");
  const repaired = s.slice(0, safeLen).replace(/,\s*$/, "") + safeClosers;
  return JSON.parse(repaired);
}

// POST /api/ai/messages — generic Claude proxy
router.post("/ai/messages", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  const { model, max_tokens, system, messages, tools } = req.body;

  if (!max_tokens || !Array.isArray(messages)) {
    res.status(400).json({ error: "max_tokens and messages are required" });
    return;
  }

  try {
    const resolvedModel = model || "claude-sonnet-4-5";
    const body: Record<string, unknown> = { model: resolvedModel, max_tokens, messages };
    if (system) body.system = system;
    if (tools) body.tools = tools;

    const upstream = await callAnthropicOnce(body);
    const data = await upstream.json() as Record<string, unknown>;

    if (!upstream.ok) {
      const errMsg = typeof data.error === "object" && data.error !== null
        ? (data.error as Record<string, unknown>).message ?? JSON.stringify(data.error)
        : String(data.error ?? "Unknown upstream error");
      req.log.error({ status: upstream.status, errMsg }, "Anthropic API error");
      res.status(upstream.status >= 500 ? 502 : 400).json({ error: String(errMsg) });
      return;
    }

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to proxy AI message");
    res.status(500).json({ error: "Failed to reach AI service" });
  }
});

// POST /api/ai/extract — OM extraction with auto-recovery for large tenant lists
router.post("/ai/extract", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  const { text } = req.body;
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }

  try {
    const truncatedText = text.length > 180000
      ? text.slice(0, 120000) + "\n...[middle truncated]...\n" + text.slice(-40000)
      : text;

    const callExtract = async (content: string) => {
      const upstream = await callAnthropicOnce({
        model: "claude-sonnet-4-6",
        max_tokens: 32000,
        messages: [{ role: "user", content }],
      });
      const data = await upstream.json() as Record<string, unknown>;
      if (!upstream.ok) {
        const errMsg = typeof data.error === "object" && data.error !== null
          ? (data.error as Record<string, unknown>).message ?? JSON.stringify(data.error)
          : String(data.error ?? "Unknown error");
        throw new Error(String(errMsg));
      }
      const content_blocks = data.content as Array<{ type: string; text?: string }>;
      const raw = content_blocks?.find((b) => b.type === "text")?.text ?? "";
      if (!raw) throw new Error(`AI returned empty content. stop_reason=${data.stop_reason}`);
      return { raw, stopReason: data.stop_reason as string };
    };

    // Initial extraction
    const first = await callExtract(EXTRACTION_PROMPT + "\n\nOM TEXT:\n" + truncatedText);
    let extracted = robustParseJSON(first.raw) as Record<string, unknown>;
    if (!extracted.tenants) extracted.tenants = [];

    // Auto-recover truncated tenant lists
    let stopReason = first.stopReason;
    let rounds = 0;
    while (stopReason === "max_tokens" && rounds < 8) {
      rounds++;
      const tenants = extracted.tenants as Array<{ name?: string }>;
      const haveNames = tenants.map((t) => t.name).filter(Boolean);
      const contPrompt =
        "From the Offering Memorandum text below, extract ONLY the tenants NOT already in this list:\n" +
        haveNames.join(", ") +
        "\n\nReturn ONLY a JSON object: {\"tenants\":[...]} using this schema per tenant: " +
        "{name, suite, sf, rentPerSF, annualRent, leaseStart, leaseExpiry, leaseType, reimbursementMethod, rentBumps, rentSchedule, renewalOptions, percentageRent, creditRating, salesPSF, isAnchor, remainingTermYears}. " +
        "If there are no more tenants, return {\"tenants\":[]}. Output must start with { and end with }.\n\nOM TEXT:\n" + truncatedText;

      try {
        const cont = await callExtract(contPrompt);
        const contParsed = robustParseJSON(cont.raw) as Record<string, unknown>;
        const newOnes = ((contParsed.tenants as Array<{ name?: string }>) || [])
          .filter((t) => t?.name && !haveNames.includes(t.name));
        if (newOnes.length === 0) break;
        extracted.tenants = (extracted.tenants as unknown[]).concat(newOnes);
        stopReason = cont.stopReason;
      } catch {
        break;
      }
    }

    const tenantsComplete = stopReason !== "max_tokens";
    res.json({ data: extracted, tenantsComplete });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "OM extraction failed");
    res.status(500).json({ error: message });
  }
});

export default router;
