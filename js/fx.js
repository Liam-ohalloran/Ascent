// Guess feedback: the short sequence after a word is sent.
//   1. checking   the word sits on the rope as a pending card (instant)
//   2. reveal     the card settles into its result colour        (~0.3 s)
//   3. score      the height counts up on the card               (~0.55 s)
//   4. climb      climber, rope, altitude and summit meter move   (~0.8 s)
//   5. next       the next pitch slides in with a fresh clock     (after rules.TRANSITION_MS)
// A refused word gets a quick shake instead (~0.2 s).
//
// Everything here is visual. The game saves a guess and its score BEFORE any
// of this runs, and nothing here writes game state, so a skipped, repeated or
// interrupted animation can never change a score, the altitude or a timer.
// With reduced motion, every step shows its end state at once.

export const FX = { reveal: 320, countDelay: 150, count: 550, climbDelay: 250, climb: 800, invalid: 180 };
export const ZONES = ["foothills", "forest", "ridge", "storm", "summit"];

export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Pending work, so tests and the next render can tell when the screen has settled.
let busy = 0;
const timers = new Set();
function mark(delta) {
  busy = Math.max(0, busy + delta);
  document.body.dataset.fx = busy ? "busy" : "idle";
}

// Runs fn after ms, unless cancelled by the next screen. Immediate with reduced motion.
export function later(fn, ms) {
  if (reduced() || ms <= 0) return fn();
  mark(1);
  const id = setTimeout(() => { timers.delete(id); mark(-1); fn(); }, ms);
  timers.add(id);
}

// A new screen replaces the old one: drop anything still waiting to run.
export function cancelAll() {
  for (const id of timers) clearTimeout(id);
  if (timers.size) mark(-timers.size);
  timers.clear();
}

// Counts a number up on an element. The final value is always written last.
// A newer count on the same element replaces an older one.
export function countUp(el, to, { from = 0, ms = FX.count, delay = 0, format = String } = {}) {
  if (!el) return;
  const run = (el._fxRun = (el._fxRun || 0) + 1);
  if (reduced() || ms <= 0 || from === to) {
    el.textContent = format(to);
    return;
  }
  el.textContent = format(from);
  mark(1);
  const start = performance.now() + delay;
  const step = (t) => {
    if (!el.isConnected || el._fxRun !== run) return mark(-1);
    const k = Math.max(0, Math.min(1, (t - start) / ms));
    el.textContent = format(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
    else mark(-1);
  };
  requestAnimationFrame(step);
}

// The environment follows the pitch you're on.
export function setZone(i) {
  document.body.dataset.zone = ZONES[Math.max(0, Math.min(ZONES.length - 1, i))];
}

// The summit meter: how far up the 5,000 m the climb is, with the summit mark.
export function setMeter(meter, metres, max) {
  if (!meter) return;
  const pct = Math.max(0, Math.min(100, (metres / max) * 100));
  meter.style.setProperty("--pct", `${pct}%`);
  meter.setAttribute("aria-valuenow", String(metres));
}
