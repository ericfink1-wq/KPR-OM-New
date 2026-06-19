import { describe, it, expect } from "vitest";
import { buildReviewQuestions, openAuditCount } from "../utils";
import type { Deal } from "../idb";

// The server computes a rich arithmetic audit (audit-*) and stores it on the deal.
// These tests lock in that the per-deal review surfaces those checks, carries their
// resolution, dedupes the overlapping client calc-* checks, and ignores stored copies
// of the locally-managed checks.

const storedAudit = (over: Partial<Deal>): Deal => ({ id: "d", propertyName: "Test", ...over } as Deal);

describe("buildReviewQuestions — surfacing the server audit on the deal page", () => {
  it("surfaces a stored audit-* check (it used to be silently dropped)", () => {
    const deal = storedAudit({ reviewQuestions: [
      { id: "audit-rentroll-incomplete", source: "check", severity: "high", field: "Rent roll completeness", question: "Did the rent roll extract?", detail: null, suggestedValue: null, target: null },
    ] });
    const out = buildReviewQuestions(deal);
    expect(out.some(q => q.id === "audit-rentroll-incomplete" && !q.resolvedAt)).toBe(true);
    expect(openAuditCount(deal)).toBeGreaterThan(0);
  });

  it("carries a prior resolution so a confirmed/dismissed audit stays quiet", () => {
    const deal = storedAudit({ reviewQuestions: [
      { id: "audit-rentroll-incomplete", source: "check", severity: "high", field: "x", question: "q", detail: null, suggestedValue: null, target: null, resolvedAt: "2026-06-19T00:00:00Z", resolution: "dismissed" },
    ] });
    expect(openAuditCount(deal)).toBe(0);
  });

  it("also surfaces the scanned-PDF source check (src-*)", () => {
    const deal = storedAudit({ reviewQuestions: [
      { id: "src-scanned-pdf", source: "check", severity: "high", field: "scanned", question: "This OM looks scanned", detail: null, suggestedValue: null, target: null },
    ] });
    expect(buildReviewQuestions(deal).some(q => q.id === "src-scanned-pdf")).toBe(true);
  });

  // The NOI/cap/price contradiction exists in BOTH reconcileDeal (calc-) and the audit
  // (audit-noi-cap-price). When the audit version is present it should win — one issue,
  // shown once.
  const mismatchDeal = (extra: Partial<Deal>): Deal =>
    storedAudit({ noi: 1_000_000, capRate: 5, askingPrice: 10_000_000, ...extra });

  it("suppresses the calc-* twin when the richer audit-* version is surfaced", () => {
    const deal = mismatchDeal({ reviewQuestions: [
      { id: "audit-noi-cap-price", source: "check", severity: "high", field: "NOI / cap / price", question: "These don't tie out", detail: null, suggestedValue: null, target: null },
    ] });
    const out = buildReviewQuestions(deal);
    expect(out.some(q => q.id === "audit-noi-cap-price")).toBe(true);
    expect(out.some(q => q.id === "calc-cap-rate-price-mismatch")).toBe(false);
  });

  it("still shows the calc-* check when no audit twin is stored (older deals)", () => {
    const out = buildReviewQuestions(mismatchDeal({}));
    expect(out.some(q => q.id === "calc-cap-rate-price-mismatch")).toBe(true);
  });

  it("ignores stored copies of locally-managed checks (anomaly-/refresh-/merge-)", () => {
    const deal = storedAudit({ reviewQuestions: [
      { id: "anomaly-caprate", source: "check", severity: "medium", field: "x", question: "stale anomaly", detail: null, suggestedValue: null, target: null },
      { id: "refresh-foo", source: "check", severity: "low", field: "x", question: "stale refresh", detail: null, suggestedValue: null, target: null },
      { id: "merge-bar", source: "check", severity: "low", field: "x", question: "stale merge", detail: null, suggestedValue: null, target: null },
    ] });
    const out = buildReviewQuestions(deal);
    expect(out.some(q => ["anomaly-caprate", "refresh-foo", "merge-bar"].includes(q.id))).toBe(false);
  });
});
