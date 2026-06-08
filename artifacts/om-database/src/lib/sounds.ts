// Tiny upload notification sounds — generated with the Web Audio API (no audio
// files to ship, offline-safe, instant). Best-effort: never throws, silently
// no-ops if audio isn't available or is blocked.
//
// success = a quick bright two-note ding; error = a soft low two-note ping.

let ctx: AudioContext | null = null;
let lastPlay = 0;

function audio(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(ac: AudioContext, freq: number, startOffset: number, dur: number, type: OscillatorType, peak: number) {
  const t0 = ac.currentTime + startOffset;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// Collapse near-simultaneous calls into one sound (insurance against rapid patches).
function debounced(): boolean {
  const now = Date.now();
  if (now - lastPlay < 250) return true;
  lastPlay = now;
  return false;
}

/** Bright ascending ding (A5 → E6) on a completed upload. */
export function playUploadSuccess(): void {
  if (debounced()) return;
  const ac = audio();
  if (!ac) return;
  try {
    tone(ac, 880, 0, 0.14, "sine", 0.2);
    tone(ac, 1318.5, 0.1, 0.2, "sine", 0.2);
  } catch { /* never throw */ }
}

/** Soft descending low ping (G4 → D4) on a failed upload. */
export function playUploadError(): void {
  if (debounced()) return;
  const ac = audio();
  if (!ac) return;
  try {
    tone(ac, 392, 0, 0.17, "triangle", 0.16);
    tone(ac, 294, 0.13, 0.26, "triangle", 0.16);
  } catch { /* never throw */ }
}
