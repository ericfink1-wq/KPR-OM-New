// Which below-market rows Mark-to-Market may COUNT in dollars (Eric, 10/17/26). Rockaway's
// Target ($5.09 vs a $16.00 median, n=3, 50k+ US) sat at the 67th percentile — it pays MORE
// than two of its three peers — yet was counted as $1.67M/yr of capturable upside, because
// a recency-weighted median off three stores can land anywhere.
//  • A store at or above the 50th percentile of its peers is never "below market".
//  • With fewer than MIN_PEERS_FOR_DOLLARS peers the row is shown (as a percentile) but its
//    dollars are left out of the deal and portfolio upside totals.
export const MIN_PEERS_FOR_DOLLARS = 5;

export interface MtmRowLike { gapPct: number; percentile: number; locations: number }

export function isBelowMarket(r: MtmRowLike, thresholdPct: number): boolean {
  return r.gapPct >= thresholdPct && r.percentile < 50;
}
export function countsInUpside(r: MtmRowLike): boolean {
  return r.locations >= MIN_PEERS_FOR_DOLLARS;
}
