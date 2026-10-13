// The rules of Ascent in one place. Pure functions only, so they can be
// unit tested and nothing else in the game does its own maths.
//
// One climb a day. It has five themed pitches and a time limit. Every real
// word earns height; the closer it gets to the best word, and the rarer it
// is, the higher it climbs. Gibberish earns nothing and doesn't use a try.

export const THEMES = ["The Foothills", "The Forest", "The Frozen Ridge", "The Storm Wall", "The Summit"];

export const CLIMB_SECONDS = 360;    // six minutes from "Begin climb"
export const PITCHES = 4;            // link pitches before the summit word
export const PITCH_MAX = 1000;       // metres available on each link pitch
export const PITCH_TRIES = 2;
export const SECOND_TRY = 0.7;       // the second try is worth 70%

// The height ladder for a link pitch (first try, before rarity):
//   fits every clue        600 to 1,000 m (rarity decides)
//   links some clues       a share of that (e.g. 300 to 500 m for one of two)
//   close to the best word 200 m  (forms a compound with it, or shares its root)
//   any other real word    100 m  (a foothold)
//   not a real word        refused, no try used
export const NEAR_BEST = 200;
export const FOOTHOLD = 100;

// Rarity, on the Zipf frequency scale (about 7 for "the", 3 for rare words).
// A word as common as LIGHT keeps 60% of its height, one as rare as LIME
// keeps all of it, with a straight line in between.
export const COMMON_ZIPF = 5.6;
export const RARE_ZIPF = 3.6;
export const MIN_RARITY = 0.6;

export const SUMMIT_POINTS = [1000, 700, 400]; // summit word found on clue 1, 2, 3
export const SUMMIT_TRIES = SUMMIT_POINTS.length;
export const SUMMIT_NEAR = 200;      // a miss that's close to the summit word
export const SUMMIT_MISS = 100;      // any other real word
export const NEAR_MISS_MAX = 300;    // AI-judged closeness, when the judge is on
export const CLOSE = 0.6;

export const MAX_TOTAL = PITCHES * PITCH_MAX + SUMMIT_POINTS[0]; // 5,000 m
// Reaching the summit means an exceptional climb, not just finishing.
export const SUMMIT_HEIGHT = 4500;
export const MIN_WORD = 2;
export const MAX_WORD = 16;

const round10 = (x) => Math.round(x / 10) * 10;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const finite = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);

export function rarity(zipf) {
  const z = finite(zipf, RARE_ZIPF);
  const k = (COMMON_ZIPF - z) / (COMMON_ZIPF - RARE_ZIPF);
  return MIN_RARITY + (1 - MIN_RARITY) * clamp(k, 0, 1);
}

export function rarityLabel(zipf) {
  const z = finite(zipf, RARE_ZIPF);
  if (z >= 5) return "Common word";
  if (z >= 4.3) return "Familiar word";
  if (z >= 3.7) return "Uncommon word";
  return "Rare word";
}

// What kind of hold a guess found, from best to weakest.
export function holdKind(linkedCount, totalClues, near) {
  if (linkedCount >= totalClues && totalClues > 0) return "fit";
  if (linkedCount > 0) return "partial";
  return near ? "near" : "foothold";
}

// Height for one try on a link pitch. Any judged guess earns something.
export function guessPoints({ linked = 0, total = 2, tryIndex = 0, zipf, near = false }) {
  const count = clamp(Math.floor(finite(linked)), 0, total);
  const tryFactor = tryIndex === 0 ? 1 : SECOND_TRY;
  let raw;
  if (count > 0 && total > 0) raw = PITCH_MAX * (count / total) * rarity(zipf);
  else raw = near ? NEAR_BEST : FOOTHOLD;
  return clamp(round10(raw * tryFactor), 10, PITCH_MAX);
}

// Height for the summit pitch. misses: [{ near, close }] for wrong guesses.
export function summitPoints(solved, guessesUsed, misses = []) {
  if (solved) return SUMMIT_POINTS[clamp(guessesUsed - 1, 0, SUMMIT_TRIES - 1)];
  if (!misses.length) return 0; // time ran out before a guess
  return Math.max(...misses.map((m) => Math.max(
    m.near ? SUMMIT_NEAR : SUMMIT_MISS,
    finite(m.close) >= CLOSE ? round10(NEAR_MISS_MAX * clamp(finite(m.close), 0, 1)) : 0,
  )));
}

// A pitch keeps its best try, never a later worse one.
export function bestGuess(guesses) {
  let best = null;
  for (const g of guesses || []) if (!best || finite(g.points) > finite(best.points)) best = g;
  return best;
}

export function totalMetres(game) {
  const steps = [...(game.pitches || []), game.summit].filter(Boolean);
  return clamp(steps.reduce((sum, s) => sum + finite(s.points), 0), 0, MAX_TOTAL);
}

export const summitReached = (metres) => finite(metres) >= SUMMIT_HEIGHT;

// The zone of the mountain your height reaches.
export const TIERS = THEMES;
export function tierFor(metres) {
  const m = finite(metres);
  if (m >= SUMMIT_HEIGHT) return THEMES[4];
  return THEMES[clamp(Math.floor(m / 1000), 0, 3)];
}

// Turn what the player typed into a guess, or explain why it can't be one.
// Accents are folded (CAFÉ -> CAFE). Spaces, hyphens and apostrophes inside a
// word are dropped so SUN-LIGHT and SUN LIGHT both read as SUNLIGHT.
// Digits and other symbols are refused rather than silently removed.
export function normaliseGuess(input) {
  const text = String(input ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
  if (!text) return { error: "Type a word first." };
  if (/[^A-Z\s'’-]/.test(text)) return { error: "Use letters only." };
  const word = text.replace(/[\s'’-]+/g, "");
  if (word.length < MIN_WORD) return { error: "That's too short to be a word." };
  if (word.length > MAX_WORD) return { error: `Keep it under ${MAX_WORD + 1} letters.` };
  return { word };
}

// Two words share a root when one starts with the other (LIGHT, LIGHTER) or
// they agree on all but their last letter or two (STONE, STONY).
export function sharesRoot(a, b) {
  if (!a || !b || a === b) return false;
  const min = Math.min(a.length, b.length);
  if (min < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  let k = 0;
  while (k < min && a[k] === b[k]) k++;
  return k >= Math.max(4, min - 1);
}

// Result category for a finished pitch, used by the mountain, results and share card.
export function pitchResult(step, clueCount) {
  if (!step?.done) return null;
  const b = bestGuess(step.guesses);
  if (!b) return "none";
  return holdKind(b.linked?.length || 0, clueCount, b.near);
}

// Seconds left on a climb at time `now` (ms).
export function secondsLeft(game, now) {
  if (!game?.deadline) return CLIMB_SECONDS;
  return Math.max(0, Math.ceil((game.deadline - now) / 1000));
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.round(finite(seconds)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
