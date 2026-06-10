import type { Request, Response, NextFunction } from "express";

// Lightweight in-memory rate limiter for the token-spending (LLM) endpoints, so a
// stuck client retry loop or a single user can't run up the Anthropic bill or
// starve others. Single-process deploy, so a Map is enough; buckets self-expire.
//
// Keyed per signed-in user (falls back to IP) per named bucket. Two windows are
// enforced together: a short burst window and a longer hourly cap.

interface Hit { times: number[] }

const store = new Map<string, Hit>();

// Periodic cleanup so the Map can't grow unbounded for one-off users.
let lastSweep = 0;
function sweep(now: number, maxAgeMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, h] of store) {
    h.times = h.times.filter(t => now - t < maxAgeMs);
    if (h.times.length === 0) store.delete(k);
  }
}

export interface RateLimitOptions {
  bucket: string;       // namespace so different endpoints don't share a budget
  perMinute: number;    // max requests in any rolling 60s
  perHour: number;      // max requests in any rolling 60m
}

export function rateLimit(opts: RateLimitOptions) {
  const { bucket, perMinute, perHour } = opts;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    sweep(now, 3_600_000);
    const who = req.session?.userId || req.session?.userEmail || req.ip || "anon";
    const key = `${bucket}:${who}`;
    const hit = store.get(key) || { times: [] };
    hit.times = hit.times.filter(t => now - t < 3_600_000); // keep last hour

    const inMinute = hit.times.filter(t => now - t < 60_000).length;
    if (inMinute >= perMinute) {
      res.setHeader("Retry-After", "30");
      res.status(429).json({ error: "You're going a bit fast — please wait a moment and try again." });
      return;
    }
    if (hit.times.length >= perHour) {
      res.setHeader("Retry-After", "600");
      res.status(429).json({ error: "Hourly AI limit reached. Please wait a while before running more analyses." });
      return;
    }

    hit.times.push(now);
    store.set(key, hit);
    next();
  };
}
