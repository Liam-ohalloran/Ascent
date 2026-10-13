// Scores guesses.
//
// 1. Dictionary (data/links.json, data/freq.json): deterministic, instant,
//    works offline. It knows real compound words and a hand-checked list of
//    two-word phrases, and how common each word is.
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

export async function ready() {
  await Promise.all([loadJson("links"), loadJson("freq")]);
}

// Plurals count as the same word: SPOTS links where SPOT does.
function forms(word) {
  const out = [word];
  if (word.length > 3 && word.endsWith("S")) out.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("ES")) out.push(word.slice(0, -2));
  return out;
}

const UNKNOWN_ZIPF = 3.6; // words the dictionary doesn't know count as fairly rare

async function zipfOf(word) {
  const freq = await loadJson("freq");
  for (const w of forms(word)) if (Number.isFinite(freq[w])) return freq[w];
  return UNKNOWN_ZIPF;
}

// The rarest words that link every clue, for the reveal after a pitch.
export async function rarestLinks(clues, limit = 3) {
  try {
    const [links, freq] = await Promise.all([loadJson("links"), loadJson("freq")]);
    const sets = clues.map((c) => new Set(links[c] || []));
    const all = [...sets[0]].filter((w) =>
      sets.every((s) => s.has(w)) && !clues.includes(w) &&
      !forms(w).slice(1).some((single) => sets[0].has(single))); // skip plurals of listed words
    return all.sort((a, b) => (freq[a] ?? 9) - (freq[b] ?? 9)).slice(0, limit);
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

// Returns { linked: [clue...], zipf } or { error } if the guess couldn't be
// judged (dictionary files or the AI judge unreachable).
export async function judgeLink(word, clues, answer) {
  let links;
  try {
    links = await loadJson("links");
  } catch {
    return { error: navigator.onLine === false ? "offline" : "data" };
  }
  const zipf = await zipfOf(word).catch(() => UNKNOWN_ZIPF);
  if (word === answer) return { linked: [...clues], zipf };

  const linked = clues.filter((c) => forms(word).some((w) => links[c]?.includes(w)));
  const unsure = clues.filter((c) => !linked.includes(c) && c !== word);
  if (!unsure.length || !JUDGE_ENABLED) return { linked, zipf };

  const res = await callApi({ kind: "link", word, clues: unsure });
  if (res.error) return { error: res.error };
  // Treat the reply as untrusted: only explicit true counts.
  for (const c of unsure) if (res.links && res.links[c] === true) linked.push(c);
  return { linked: clues.filter((c) => linked.includes(c)), zipf };
}

// Returns { exact, close } (close 0 to 1) or { error }.
export async function judgeSummit(word, answer, definition) {
  if (word === answer || forms(word).includes(answer)) return { exact: true, close: 1 };
  if (!JUDGE_ENABLED) return { exact: false, close: 0 };
  const res = await callApi({ kind: "summit", word, answer, definition });
  if (res.error) return { error: res.error };
  const close = Number(res.close);
  return { exact: false, close: Number.isFinite(close) ? Math.max(0, Math.min(1, close)) : 0 };
}

export const ERROR_TEXT = {
  offline: "You're offline. Reconnect and press Enter again. Your try wasn't used.",
  slow: "The judge took too long. Press Enter to try again. Your try wasn't used.",
  busy: "Lots of climbers right now. Wait a few seconds and press Enter again. Your try wasn't used.",
  down: "The judge couldn't be reached. Press Enter to try again. Your try wasn't used.",
  data: "The word list didn't load. Check your connection and press Enter again. Your try wasn't used.",
};
