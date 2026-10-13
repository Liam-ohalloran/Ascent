// The rules of Ascent in one place. Pure functions only, so they can be
// unit tested and nothing else in the game does its own maths.

export const PITCHES = 4;            // link pitches before the summit
export const PITCH_MAX = 1000;       // metres available on each link pitch
export const PITCH_TRIES = 2;
export const SECOND_TRY = 0.7;       // the second try is worth 70%
export const MIN_LINK_POINTS = 50;   // any genuine link earns at least this

// Rarity, on the Zipf frequency scale (about 7 for "the", 3 for rare words).
// A word as common as LIGHT keeps 60% of its height, one as rare as LIME
// keeps all of it, with a straight line in between.
export const COMMON_ZIPF = 5.6;
export const RARE_ZIPF = 3.6;
export const MIN_RARITY = 0.6;

export const SUMMIT_POINTS = [1000, 700, 400]; // exact word on clue 1, 2, 3
export const SUMMIT_TRIES = SUMMIT_POINTS.length;
export const NEAR_MISS_MAX = 300;    // closest near-miss if the summit is never found
export const NEAR_MISS_MIN = 0.4;    // closeness below this earns nothing
export const CLOSE = 0.6;            // closeness at which a guess is called "close"

export const MAX_TOTAL = PITCHES * PITCH_MAX + SUMMIT_POINTS[0]; // 5,000 m
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

// Height for one try on a link pitch.
// fit = share of clues linked, then rarity, then the second-try discount.
export function linkPoints(linkedCount, totalClues, tryIndex, zipf) {
  const linked = clamp(Math.floor(finite(linkedCount)), 0, totalClues);
  if (!linked || totalClues <= 0) return 0;
  const fit = linked / totalClues;
  const tryFactor = tryIndex === 0 ? 1 : SECOND_TRY;
  const raw = PITCH_MAX * fit * rarity(zipf) * tryFactor;
  return clamp(round10(raw), MIN_LINK_POINTS, PITCH_MAX);
}

// Height for the summit. guessesUsed counts the winning guess.
export function summitPoints(solved, guessesUsed, closeness = []) {
  if (solved) return SUMMIT_POINTS[clamp(guessesUsed - 1, 0, SUMMIT_TRIES - 1)];
  const best = Math.max(0, ...closeness.map((c) => finite(c)));
  return best >= NEAR_MISS_MIN ? round10(NEAR_MISS_MAX * clamp(best, 0, 1)) : 0;
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

export const TIERS = ["Base camp", "Treeline", "Snowline", "Ridge", "High camp", "Summit"];

// Tiers follow height, every 1,000 m. "Summit" needs both the summit word
// and at least 4,000 m, so it is never claimed for a low climb.
export function tierFor(metres, summitReached) {
  const m = finite(metres);
  if (summitReached && m >= 4000) return "Summit";
  return TIERS[clamp(Math.floor(m / 1000), 0, 4)];
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

// Result category for a finished pitch, used by the mountain, results and share card.
export function pitchResult(step, clueCount) {
  if (!step?.done) return null;
  const b = bestGuess(step.guesses);
  if (!b || !b.linked?.length) return "slip";
  return b.linked.length === clueCount ? "clean" : "part";
}
