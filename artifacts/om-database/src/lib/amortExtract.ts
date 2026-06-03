import type { AmortRow } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON } from "./utils";

// Extract a lender amortization schedule (PDF or spreadsheet text) into rows.
// We mainly need each payment's DATE and ending BALANCE; payment/interest/
// principal are captured when present.
export async function extractAmortSchedule(text: string): Promise<AmortRow[]> {
  const prompt = `Extract the amortization schedule from this document into JSON. Return ONLY:
{"rows":[{"date":"YYYY-MM-DD","payment":number|null,"interest":number|null,"principal":number|null,"balance":number}]}

Rules:
- One object PER scheduled payment / period, in chronological order.
- date: the payment date in ISO YYYY-MM-DD. If only a period number is shown (no dates), use "M1","M2",… in order.
- balance: the ENDING / remaining principal balance after that payment (REQUIRED for every row). Plain number, no $ or commas.
- payment / interest / principal: capture when the schedule shows them, else null.
- Include EVERY period row. Skip header, total, and summary rows.

${await lessonGuidanceClient("loan")}
AMORTIZATION SCHEDULE TEXT:
${text.slice(0, 60000)}`;

  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content?.[0]?.text ?? "";
  let parsed: { rows?: unknown[] };
  try { parsed = robustParseJSON(raw) as typeof parsed; }
  catch { throw new Error("Couldn't read the amortization schedule. Try a clearer file."); }

  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const rows: AmortRow[] = (Array.isArray(parsed.rows) ? parsed.rows : [])
    .map(r => {
      const o = r as Record<string, unknown>;
      const balance = n(o.balance);
      if (balance == null) return null;
      return {
        date: typeof o.date === "string" && o.date.trim() ? o.date.trim() : "",
        payment: n(o.payment), interest: n(o.interest), principal: n(o.principal),
        balance,
      } as AmortRow;
    })
    .filter((r): r is AmortRow => r != null && !!r.date);

  if (rows.length === 0) throw new Error("No amortization rows found in that file.");
  return rows;
}
