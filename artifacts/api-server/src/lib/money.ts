// THE money formatter (Eric, 10/19/26): a unit ROLLS to the next one at 4 digits — never
// "$1098.76M" (→ $1.10B) or "$1,250K" (→ $1.25M). The roll-over is decided on the ROUNDED
// figure, so $999,995 at 2-dp M doesn't print "$1000.00K". Mirrored verbatim in om-database lib/money.ts (a test fails if they drift).
export interface MoneyOpts {
  /** Decimals for M and B (default 2). */
  dp?: number;
  /** Decimals for K (default 0). */
  dpK?: number;
  /** Below $1M: "k" = $930K (default), "full" = $930,000. Below $1K is always full dollars. */
  below?: "k" | "full";
  /** "K" (default) or "k". */
  kSuffix?: "K" | "k";
  /** Trim trailing zeros ("$2.0M" → "$2M"). Default false. */
  trim?: boolean;
  /** Text for null / non-finite (default "—"). */
  empty?: string;
}
const fix = (x: number, d: number, trim: boolean) => { const t = x.toFixed(d); return trim && t.includes(".") ? t.replace(/\.?0+$/, "") : t; };
const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function fmtMoney(v: number | null | undefined, o: MoneyOpts = {}): string {
  if (v == null || !Number.isFinite(Number(v))) return o.empty ?? "—";
  const n = Number(v), sign = n < 0 ? "-" : "", a = Math.abs(n);
  const dp = o.dp ?? 2, dpK = o.dpK ?? 0, trim = o.trim ?? false, k = o.kSuffix ?? "K";
  const unit = (scale: number, suf: string, d: number) => `${sign}$${fix(r(a / scale, d), d, trim)}${suf}`;
  // A unit is used only while its ROUNDED figure stays under 1,000; at 1,000 it moves up.
  if (a >= 1e9 || r(a / 1e6, dp) >= 1000) return unit(1e9, "B", dp);
  if (a >= 1e6 || r(a / 1e3, dpK) >= 1000) return unit(1e6, "M", dp);
  if (o.below === "full") return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
  if (a >= 1e3 || Math.round(a) >= 1000) return unit(1e3, k, dpK);
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}
/** Same roll-over rule for plain quantities (SF): 1,250K SF → 1.25M SF. */
export function fmtCompact(v: number | null | undefined, o: { dp?: number; dpK?: number; kSuffix?: "K" | "k"; empty?: string } = {}): string {
  if (v == null || !Number.isFinite(Number(v))) return o.empty ?? "—";
  const n = Number(v), sign = n < 0 ? "-" : "", a = Math.abs(n), dp = o.dp ?? 2, dpK = o.dpK ?? 0;
  if (a >= 1e9 || r(a / 1e6, dp) >= 1000) return `${sign}${r(a / 1e9, dp).toFixed(dp)}B`;
  if (a >= 1e6 || r(a / 1e3, dpK) >= 1000) return `${sign}${r(a / 1e6, dp).toFixed(dp)}M`;
  if (a >= 1e3 || Math.round(a) >= 1000) return `${sign}${r(a / 1e3, dpK).toFixed(dpK)}${o.kSuffix ?? "K"}`;
  return `${sign}${Math.round(a).toLocaleString("en-US")}`;
}
