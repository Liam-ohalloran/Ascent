// The rules of Ascent in one place. Pure functions only, so they can be
// unit tested and nothing else in the game does its own maths.
//
// One climb a day. It has five themed pitches, each with its own short
// timer. Every real
// word earns height; the closer it gets to the best word, and the rarer it
// is, the higher it climbs. Gibberish earns nothing and doesn't use a try.

export const THEMES = ["The Foothills", "The Forest", "The Frozen Ridge", "The Storm Wall", "The Summit"];

// THE TIMER. Each of the five pitches gets exactly this many seconds, from
// the moment its clues are on screen. Unused time never carries over.
export const PITCH_SECONDS = 20;
// The pause between pitches, while the result shows. No clock runs during it.
export const TRANSITION_MS = 1600;
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

// A link pitch scores three separate things:
//   1. validity     is it a real word? (no: refused, no try used)
//   2. association  how strongly it links each clue, by link type (below)
//   3. rarity       how uncommon the word is in written English
// Height = PITCH_MAX x association x rarity, never below the foothold.
// Rarity only multiplies the associated part, so a rare word with no real
// link can never climb high.

// Association types (data/assoc.json, built by scripts/build_links.py).
// Strong links are clear to any fair-minded player; moderate ones are real
// but looser, so they earn less.
export const MODERATE = 0.6;
export const LINK_TYPES = {
  i: { label: "the intended link", strength: 1 },
  x: { label: "shared context", strength: 1 },
  p: { label: "common phrase", strength: 1 },
  c: { label: "compound word", strength: 1 },
  s: { label: "synonym", strength: 1 },
  a: { label: "opposite", strength: 1 },
  r: { label: "related meaning", strength: MODERATE },
  g: { label: "in its definition", strength: MODERATE },
  u: { label: "compound word", strength: MODERATE },
  j: { label: "judged link", strength: MODERATE },
};
export const linkStrength = (code) => LINK_TYPES[code]?.strength ?? 0;
export const linkLabel = (code) => LINK_TYPES[code]?.label ?? "link";

// Association for a whole pitch: the average strength over all its clues.
export function associationStrength(types, clues) {
  if (!clues?.length) return 0;
  return clamp(clues.reduce((sum, c) => sum + linkStrength(types?.[c]), 0) / clues.length, 0, 1);
}

// Rarity, on the Zipf frequency scale (about 7 for "the", 3 for rare words),
// from the wordfreq corpus, not from player answers. A word as common as
// LIGHT keeps 60% of its height, one as rare as LIME keeps all of it, with a
// straight line in between. A word with no frequency data gets no bonus.
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
  const z = finite(zipf, COMMON_ZIPF);
  const k = (COMMON_ZIPF - z) / (COMMON_ZIPF - RARE_ZIPF);
  return MIN_RARITY + (1 - MIN_RARITY) * clamp(k, 0, 1);
}

export function rarityLabel(zipf) {
  if (!Number.isFinite(zipf)) return "Frequency unknown";
  const z = zipf;
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
// strength is the pitch's association (0 to 1); without it every linked clue
// counts as a strong link.
export function guessPoints({ linked = 0, total = 2, tryIndex = 0, zipf, near = false, strength }) {
  const count = clamp(Math.floor(finite(linked)), 0, total);
  const tryFactor = tryIndex === 0 ? 1 : SECOND_TRY;
  const floor = near ? NEAR_BEST : FOOTHOLD;
  let raw = floor;
  if (count > 0 && total > 0) {
    const assoc = clamp(finite(strength, count / total), 0, count / total);
    raw = Math.max(floor, PITCH_MAX * assoc * rarity(zipf));
  }
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

// When pitch i's time runs out, or null if its timer hasn't started.
// Always computed from the saved start, never from a saved deadline.
export function pitchDeadline(game, i = game?.current) {
  const start = game?.pitchStarts?.[i];
  return Number.isFinite(start) ? start + PITCH_SECONDS * 1000 : null;
}

// A clock more than this far behind a pitch's saved start has been set
// backwards (offline, so the server time couldn't correct it). That pitch
// ends rather than getting its time back. Small clock corrections pass.
export const CLOCK_SLACK_MS = 2000;

// Has the current pitch's time run out at `now` (ms)?
export function pitchExpired(game, now) {
  const deadline = pitchDeadline(game);
  if (deadline === null) return false;
  return now >= deadline || now < game.pitchStarts[game.current] - CLOCK_SLACK_MS;
}

// Seconds left on the current pitch at time `now` (ms).
export function secondsLeft(game, now) {
  const deadline = pitchDeadline(game);
  if (deadline === null) return PITCH_SECONDS;
  if (pitchExpired(game, now)) return 0;
  return clamp(Math.ceil((deadline - now) / 1000), 0, PITCH_SECONDS);
}

// Seconds the climb has used: the time spent on each pitch, at most
// PITCH_SECONDS each. Transitions between pitches don't count.
export function climbSeconds(game) {
  const steps = [...(game?.pitches || []), game?.summit].filter(Boolean);
  let total = 0;
  steps.forEach((s, i) => {
    const start = game.pitchStarts?.[i];
    if (!s.done || !Number.isFinite(start)) return;
    const end = Number.isFinite(s.endedAt) ? s.endedAt : start + PITCH_SECONDS * 1000;
    total += clamp((end - start) / 1000, 0, PITCH_SECONDS);
  });
  return Math.round(total);
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.round(finite(seconds)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
