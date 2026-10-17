// Sale stage on an OWNED property (Eric, 10/16/26): "a property is Sold only once the
// sale has officially closed. Until closing it stays Owned, counts in every owned
// total, and gets a sale-stage flag on top."
import type { Deal } from "./idb";

export const SALE_STAGES = ["Marketed", "Under Contract"] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortMoney(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

function shortMonth(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) return s || null;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} '${m[1].slice(2)}`;
}

/** "Under contract · Wharton · $39M · closing Jan '27" — or null when not being sold. */
export function saleStageLabel(d: Pick<Deal, "status" | "saleStage" | "txnBuyer" | "txnSalePrice" | "saleExpectedClosing">): string | null {
  if (d.status !== "Owned" || !d.saleStage) return null;
  const parts = [d.saleStage === "Under Contract" ? "Under contract" : "Marketed"];
  if (d.txnBuyer) parts.push(String(d.txnBuyer));
  const p = shortMoney(d.txnSalePrice);
  if (p) parts.push(p);
  const c = shortMonth(d.saleExpectedClosing);
  if (c) parts.push(`closing ${c}`);
  return parts.join(" · ");
}

/** A real calendar closing date (mirrors the server's rule). */
export function isClosingDate(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  return Number.isFinite(Date.parse(v.trim())) && /\d{4}/.test(v);
}
