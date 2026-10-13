// The dictionary judge as pure functions over the word data. The browser
// (js/judge.js) and the server (supabase/functions/finish-climb) both judge
// with this file, so a word scores the same everywhere.
//
// data: { assoc: data/assoc.json, freq: data/freq.json, words: Set of data/words.txt }
import { sharesRoot, linkStrength, associationStrength } from "./rules.js";

// Plurals count as the same word: SPOTS links where SPOT does.
export function forms(word) {
  const out = [word];
  if (word.length > 3 && word.endsWith("S")) out.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("ES")) out.push(word.slice(0, -2));
  return out;
}

export const isKnown = (data, word) => forms(word).some((w) => data.words.has(w));

// The best link type between a guess (or its singular) and one clue.
export function linkType(assoc, word, clue) {
  const table = assoc.links?.[clue];
  if (!table) return null;
  let best = null;
  for (const w of forms(word)) {
    const t = table[w];
    if (t && (!best || linkStrength(t) > linkStrength(best))) best = t;
  }
  return best;
}

// How common a word is (wordfreq Zipf), or undefined when we don't know.
// Unknown words get no rarity bonus, so missing data can't inflate a score.
export function zipfOf(freq, word) {
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

// "Close to the best word": it associates with the best word in any way
// (MOON for LIGHT, moonlight) or shares a root with any word that fits.
export function isNear(word, assoc, freq, clues, answer) {
  if (linkType(assoc, word, answer)) return true;
  const fits = new Set([answer, ...fitsFor(assoc, freq, clues)]);
  for (const fit of fits) if (sharesRoot(word, fit)) return true;
  return false;
}

// A link pitch guess, by the dictionary alone. Returns
//   { linked, types, strength, zipf, near }  or  { unknown: true }
// extraTypes: links decided elsewhere (the optional AI judge), { clue: "j" }.
export function judgeLinkData(data, word, clues, answer, extraTypes = {}) {
  const zipf = zipfOf(data.freq, word);
  const types = {};
  // The puzzle's own answer always fits every clue fully.
  if (word === answer) {
    for (const c of clues) types[c] = linkType(data.assoc, word, c) || "i";
    return { linked: [...clues], types, strength: 1, zipf, near: true, intended: true };
  }
  for (const c of clues) {
    const t = linkType(data.assoc, word, c) || extraTypes[c];
    if (t) types[c] = t;
  }
  const linked = clues.filter((c) => types[c]);
  if (!linked.length && !isKnown(data, word)) return { unknown: true };
  return {
    linked, types, strength: associationStrength(types, clues), zipf,
    near: isNear(word, data.assoc, data.freq, clues, answer),
  };
}

// The words a link pitch leaves undecided, for the optional AI judge.
export function unlinkedClues(data, word, clues) {
  return clues.filter((c) => c !== word && !linkType(data.assoc, word, c));
}

// A summit guess. Returns { exact, near, close } or { unknown: true }.
// Close: shares a root (EPHEMERA) or a WordNet sense (TERSE for LACONIC).
export function judgeSummitData(data, word, answer) {
  if (word === answer || forms(word).includes(answer)) return { exact: true, near: true, close: 1 };
  if (!isKnown(data, word)) return { unknown: true };
  const senses = data.assoc.summit?.[answer] || [];
  const near = sharesRoot(word, answer) || forms(word).some((w) => senses.includes(w));
  return { exact: false, near, close: 0 };
}
