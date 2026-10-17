import { describe, it, expect } from "vitest";
import pino from "pino";
import { runStartupSequence, startupComplete } from "../startup";

describe("ordered startup (10/17/26 failed publish)", () => {
  it("runs steps one at a time, retries a lost connection once, and keeps going past a failure", async () => {
    const order: string[] = [];
    let active = 0, maxActive = 0, flaky = 0;
    const step = (name: string, fn?: () => void) => ({ name, run: async () => {
      active++; maxActive = Math.max(maxActive, active); order.push(name);
      await new Promise(r => setTimeout(r, 5));
      active--; fn?.();
    } });
    expect(startupComplete()).toBe(false);
    const r = await runStartupSequence([
      step("a"),
      step("flaky", () => { if (flaky++ === 0) throw new Error("timeout exceeded when trying to connect"); }),
      step("broken", () => { throw new Error("syntax error"); }),
      step("b"),
    ], pino({ level: "silent" }), 1);
    expect(maxActive).toBe(1);                                  // never two at once
    expect(order).toEqual(["a", "flaky", "flaky", "broken", "b"]);
    expect(r.ok).toEqual(["a", "flaky", "b"]);
    expect(r.failed).toEqual(["broken"]);                       // a real error isn't retried
    expect(startupComplete()).toBe(true);
  });
});
