import { sharesRoot, linkStrength, associationStrength } from "./rules.js";

// Scores guesses.
//
// 1. Dictionary (data/assoc.json, data/freq.json): deterministic, instant,
//    the same for every player. It knows typed associations (compound,
//    phrase, synonym, opposite, related meaning, definition, shared context)
//    and how common each word is in written English.
// 2. AI judge (Vercel function api/score.js): only asked about clues the
//    dictionary didn't link, and only when JUDGE_ENABLED is true.
//
// The judge is switched off until AI Gateway is active on the Vercel
// account. While it's off the dictionary is the whole rule book, so results
// are consistent for every player. When it's on and can't be reached, the
// guess is NOT scored: the caller gets { error } and the player can retry
// without losing a try.
export const JUDGE_ENABLED = false;

const API = location.hostname.endsWith("vercel.app")
  ? "/api/score"
  : "https://ascent-ruddy-pi.vercel.app/api/score";

const cache = {};
function loadJson(name) {
  cache[name] ||= fetch(`data/${name}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`${name}.json ${r.status}`);
      return r.json();
    })
    .catch((err) => {
      delete cache[name]; // let a later call try again
      throw err;
    });
  return cache[name];
}

// Every real word a player might type (data/words.txt, one per line).
let wordsPromise;
function loadWords() {
  wordsPromise ||= fetch("data/words.txt")
    .then((r) => {
      if (!r.ok) throw new Error(`words.txt ${r.status}`);
      return r.text();
    })
    .then((text) => new Set(text.split("\n").filter(Boolean)))
    .catch((err) => {
      wordsPromise = null;
      throw err;
    });
  return wordsPromise;
}

export async function ready() {
  await Promise.all([loadJson("assoc"), loadJson("freq"), loadWords()]);
}

// The best link type between a guess (or its singular) and one clue.
function linkType(assoc, word, clue) {
  const table = assoc.links?.[clue];
  if (!table) return null;
  let best = null;
  for (const w of forms(word)) {
    const t = table[w];
    if (t && (!best || linkStrength(t) > linkStrength(best))) best = t;
  }
  return best;
}

// Plurals count as the same word: SPOTS links where SPOT does.
function forms(word) {
  const out = [word];
  if (word.length > 3 && word.endsWith("S")) out.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("ES")) out.push(word.slice(0, -2));
  return out;
}

// How common a word is (wordfreq Zipf), or undefined when we don't know.
// Unknown words get no rarity bonus, so missing data can't inflate a score.
function zipfOf(freq, word) {
  for (const w of forms(word)) if (Number.isFinite(freq[w])) return freq[w];
  return undefined;
}

// Every word that links all the clues, rarest first, without plural
// duplicates. strongOnly keeps words whose every link is strong.
export function fitsFor(assoc, freq, clues, { strongOnly = false } = {}) {
  const tables = clues.map((c) => assoc.links?.[c] || {});
  const ok = (t) => t && (!strongOnly || linkStrength(t) === 1);
  return Object.keys(tables[0])
    .filter((w) => tables.every((t) => ok(t[w])) && !clues.includes(w) &&
      !forms(w).slice(1).some((single) => tables[0][single]))
    .sort((a, b) => (freq[a] ?? 9) - (freq[b] ?? 9));
}

// The rarest strong fits, for the reveal after a pitch.
export async function rarestLinks(clues, limit = 3) {
  try {
    const [assoc, freq] = await Promise.all([loadJson("assoc"), loadJson("freq")]);
    return fitsFor(assoc, freq, clues, { strongOnly: true }).slice(0, limit);
  } catch {
    return [];
  }
}

async function callApi(body) {
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    if (r.status === 429) return { error: "busy" };
    if (!r.ok) return { error: "down" };
    return await r.json();
  } catch (err) {
    return { error: err?.name === "TimeoutError" ? "slow" : navigator.onLine === false ? "offline" : "down" };
  }
}

const dataError = () => ({ error: navigator.onLine === false ? "offline" : "data" });

// "Close to the best word": it associates with the best word in any way
// (MOON for LIGHT, moonlight) or shares a root with any word that fits
// (LIGHTER, STONY).
function isNear(word, assoc, freq, clues, answer) {
  if (linkType(assoc, word, answer)) return true;
  const fits = new Set([answer, ...fitsFor(assoc, freq, clues)]);
  for (const fit of fits) if (sharesRoot(word, fit)) return true;
  return false;
}

// Returns one of:
//   { linked: [clue...], types: { clue: code }, strength, zipf, near }
//                                       a judged guess (always earns height)
//   { unknown: true }                   not a word we know: refused, no try used
//   { error }                           couldn't judge right now: no try used
export async function judgeLink(word, clues, answer) {
  let assoc, freq, words;
  try {
    [assoc, freq, words] = await Promise.all([loadJson("assoc"), loadJson("freq"), loadWords()]);
  } catch {
    return dataError();
  }
  const zipf = zipfOf(freq, word);
  const types = {};
  // The puzzle's own answer always fits every clue fully.
  if (word === answer) {
    for (const c of clues) types[c] = linkType(assoc, word, c) || "i";
    return { linked: [...clues], types, strength: 1, zipf, near: true, intended: true };
  }
  for (const c of clues) {
    const t = linkType(assoc, word, c);
    if (t) types[c] = t;
  }
  const unsure = clues.filter((c) => !types[c] && c !== word);
  if (unsure.length && JUDGE_ENABLED) {
    const res = await callApi({ kind: "link", word, clues: unsure });
    if (res.error) return { error: res.error };
    // Treat the reply as untrusted: only explicit true counts.
    for (const c of unsure) if (res.links && res.links[c] === true) types[c] = "j";
  }
  const linked = clues.filter((c) => types[c]);
  const known = linked.length > 0 || forms(word).some((w) => words.has(w));
  if (!known) return { unknown: true };
  return {
    linked, types, strength: associationStrength(types, clues), zipf,
    near: isNear(word, assoc, freq, clues, answer),
  };
}

// Returns { exact, near, close } (close 0 to 1), { unknown } or { error }.
export async function judgeSummit(word, answer, definition) {
  if (word === answer || forms(word).includes(answer)) return { exact: true, near: true, close: 1 };
  let words, assoc;
  try {
    [words, assoc] = await Promise.all([loadWords(), loadJson("assoc")]);
  } catch {
    return dataError();
  }
  if (!forms(word).some((w) => words.has(w))) return { unknown: true };
  // Close: shares a root (EPHEMERA) or a WordNet sense (TERSE for LACONIC).
  const senses = assoc.summit?.[answer] || [];
  const near = sharesRoot(word, answer) || forms(word).some((w) => senses.includes(w));
  if (!JUDGE_ENABLED) return { exact: false, near, close: 0 };
  const res = await callApi({ kind: "summit", word, answer, definition });
  if (res.error) return { error: res.error };
  const close = Number(res.close);
  return { exact: false, near, close: Number.isFinite(close) ? Math.max(0, Math.min(1, close)) : 0 };
}

export const ERROR_TEXT = {
  offline: "You're offline. Reconnect and press Enter again. Your try wasn't used.",
  slow: "The judge took too long. Press Enter to try again. Your try wasn't used.",
  busy: "Lots of climbers right now. Wait a few seconds and press Enter again. Your try wasn't used.",
  down: "The judge couldn't be reached. Press Enter to try again. Your try wasn't used.",
  data: "The word list didn't load. Check your connection and press Enter again. Your try wasn't used.",
};
