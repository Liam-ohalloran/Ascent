import { fitsFor, judgeLinkData, judgeSummitData, unlinkedClues } from "./judge-core.js";

export { fitsFor };

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
  await loadData();
}

const loadData = async () => {
  const [assoc, freq, words] = await Promise.all([loadJson("assoc"), loadJson("freq"), loadWords()]);
  return { assoc, freq, words };
};

// The rarest strong fits, for the reveal after a pitch.
export async function rarestLinks(clues, limit = 3) {
  try {
    const { assoc, freq } = await loadData();
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

// Returns one of:
//   { linked: [clue...], types: { clue: code }, strength, zipf, near }
//                                       a judged guess (always earns height)
//   { unknown: true }                   not a word we know: refused, no try used
//   { error }                           couldn't judge right now: no try used
export async function judgeLink(word, clues, answer) {
  let data;
  try {
    data = await loadData();
  } catch {
    return dataError();
  }
  const extra = {};
  const unsure = word === answer ? [] : unlinkedClues(data, word, clues);
  if (unsure.length && JUDGE_ENABLED) {
    const res = await callApi({ kind: "link", word, clues: unsure });
    if (res.error) return { error: res.error };
    // Treat the reply as untrusted: only explicit true counts.
    for (const c of unsure) if (res.links && res.links[c] === true) extra[c] = "j";
  }
  return judgeLinkData(data, word, clues, answer, extra);
}

// Returns { exact, near, close } (close 0 to 1), { unknown } or { error }.
export async function judgeSummit(word, answer, definition) {
  let data;
  try {
    data = await loadData();
  } catch {
    return dataError();
  }
  const verdict = judgeSummitData(data, word, answer);
  if (verdict.unknown || verdict.exact || !JUDGE_ENABLED) return verdict;
  const res = await callApi({ kind: "summit", word, answer, definition });
  if (res.error) return { error: res.error };
  const close = Number(res.close);
  return { ...verdict, close: Number.isFinite(close) ? Math.max(0, Math.min(1, close)) : 0 };
}

export const ERROR_TEXT = {
  offline: "You're offline. Reconnect and press Enter again. Your try wasn't used.",
  slow: "The judge took too long. Press Enter to try again. Your try wasn't used.",
  busy: "Lots of climbers right now. Wait a few seconds and press Enter again. Your try wasn't used.",
  down: "The judge couldn't be reached. Press Enter to try again. Your try wasn't used.",
  data: "The word list didn't load. Check your connection and press Enter again. Your try wasn't used.",
};
