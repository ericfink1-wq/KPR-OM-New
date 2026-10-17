import type { Logger } from "pino";

// ORDERED STARTUP (10/17/26: a publish "built but failed to start" — ~25 startup jobs hit
// Postgres in the same second, the 10-connection pool ran dry, and the healthcheck and the
// refresh tick timed out waiting for a connection). Jobs now run ONE AT A TIME after the
// server is listening; a job that loses its connection is retried once; nothing waits on
// another job's failure. Anything that would compete (the background re-analysis tick)
// checks `startupComplete()` first.

export interface StartupStep { name: string; run: () => Promise<unknown> }

let done = false;
let current: string | null = null;
export const startupComplete = () => done;
export const startupStepRunning = () => current;

const isConnectionError = (err: unknown) =>
  /timeout exceeded when trying to connect|Connection terminated|ECONNRESET|ECONNREFUSED|connection timeout/i.test(String((err as Error)?.message ?? err));

export async function runStartupSequence(steps: StartupStep[], log: Logger, retryDelayMs = 3000): Promise<{ ok: string[]; failed: string[] }> {
  const ok: string[] = [], failed: string[] = [];
  const t0 = Date.now();
  for (const s of steps) {
    current = s.name;
    for (let attempt = 1; ; attempt++) {
      try { await s.run(); ok.push(s.name); break; }
      catch (err) {
        if (attempt === 1 && isConnectionError(err)) { await new Promise(r => setTimeout(r, retryDelayMs)); continue; }
        failed.push(s.name);
        log.error({ err, step: s.name }, "Startup step failed (non-fatal)");
        break;
      }
    }
  }
  current = null;
  done = true;
  log.info({ ms: Date.now() - t0, ok: ok.length, failed }, "Startup sequence complete");
  return { ok, failed };
}
