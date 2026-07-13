import { describe, it, expect } from "vitest";
import { assessNews, parseGoogleNews, brandNorm, type NewsArticle } from "../watchlistNews";

const NOW = new Date("2026-07-13T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const art = (title: string, ageDays = 5): NewsArticle => ({ title, link: "https://x.test/a", source: "Src", publishedAt: daysAgo(ageDays) });

describe("assessNews", () => {
  it("escalates a 'watch' brand when recent headlines show a Chapter 11 filing", () => {
    const s = assessNews([art("Acme Retail files for Chapter 11 bankruptcy")], "watch", NOW);
    expect(s?.suggestedStatus).toBe("bankruptcy");
    expect(s?.exceedsCurrent).toBe(true);
  });

  it("does NOT escalate on a negation headline ('avoids bankruptcy')", () => {
    const s = assessNews([art("Acme Retail avoids bankruptcy after refinancing")], "watch", NOW);
    expect(s).toBeNull();
  });

  it("does NOT escalate on stale headlines outside the ~5-month window", () => {
    const s = assessNews([art("Acme files for bankruptcy", 200)], "watch", NOW);
    expect(s).toBeNull();
  });

  it("reports the signal but not an escalation when it matches the current status", () => {
    const s = assessNews([art("Acme announces mass store closures")], "distressed", NOW);
    expect(s?.suggestedStatus).toBe("distressed");
    expect(s?.exceedsCurrent).toBe(false);
  });

  it("picks the most-severe signal present (liquidation beats closures)", () => {
    const s = assessNews([art("Acme begins liquidation, going out of business"), art("Acme store closures mount")], "watch", NOW);
    expect(s?.suggestedStatus).toBe("liquidating");
  });

  it("returns null on benign headlines", () => {
    const s = assessNews([art("Acme reports record holiday sales")], "watch", NOW);
    expect(s).toBeNull();
  });
});

describe("parseGoogleNews", () => {
  it("parses item title/link and strips the trailing source", () => {
    const xml = `<rss><channel><item><title>Big News - Retail Dive</title><link>https://retaildive.test/x</link><source url="u">Retail Dive</source><pubDate>Mon, 06 Jul 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
    const [a] = parseGoogleNews(xml);
    expect(a.title).toBe("Big News");
    expect(a.link).toBe("https://retaildive.test/x");
    expect(a.source).toBe("Retail Dive");
  });
});

describe("brandNorm", () => {
  it("normalizes to lowercase alphanumerics", () => {
    expect(brandNorm("T.J. Maxx")).toBe("tjmaxx");
    expect(brandNorm("Saks OFF 5th")).toBe("saksoff5th");
  });
});
