// Scores guesses. The local dictionary (data/links.json) settles most
// words instantly. Anything it doesn't link goes to the Vercel scoring
// function, which asks an AI model about real two-word phrases.
// If the function can't be reached, the dictionary result stands.

const API = location.hostname.endsWith("vercel.app")
  ? "/api/score"
  : "https://ascent-ruddy-pi.vercel.app/api/score";

const cache = {};
function loadJson(name) {
  cache[name] ||= fetch(`data/${name}.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return cache[name];
}
const loadLinks = () => loadJson("links");
const loadFreq = () => loadJson("freq");
loadLinks();
loadFreq();

// How common a word is, on the Zipf scale (about 7 for "the", 3 for rare).
// Words the dictionary doesn't know are treated as fairly rare.
const UNKNOWN_ZIPF = 3.6;
async function zipfOf(word) {
  const freq = await loadFreq();
  for (const w of forms(word)) if (freq[w] != null) return freq[w];
  return UNKNOWN_ZIPF;
}

// The rarest words that link every clue, for the reveal after a pitch.
export async function rarestLinks(clues, limit = 3) {
  const [links, freq] = await Promise.all([loadLinks(), loadFreq()]);
  const sets = clues.map((c) => new Set(links[c] || []));
  const all = [...sets[0]].filter((w) => sets.every((s) => s.has(w)) && !clues.includes(w));
  return all.sort((a, b) => (freq[a] ?? 9) - (freq[b] ?? 9)).slice(0, limit);
}

async function callApi(body) {
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function forms(word) {
  const out = [word];
  if (word.length > 3 && word.endsWith("S")) out.push(word.slice(0, -1));
  return out;
}

// Returns { linked: [clue, ...], zipf, checked }.
// checked is false when the AI judge couldn't be reached for some clues.
export async function judgeLink(word, clues, answer) {
  const zipf = await zipfOf(word);
  if (word === answer) return { linked: [...clues], zipf, checked: true };
  const links = await loadLinks();
  const linked = clues.filter((c) => forms(word).some((w) => links[c]?.includes(w)));
  const unsure = clues.filter((c) => !linked.includes(c) && c !== word);
  if (!unsure.length) return { linked, zipf, checked: true };

  const res = await callApi({ kind: "link", word, clues: unsure });
  if (!res) return { linked, zipf, checked: false };
  for (const c of unsure) if (res.links?.[c]) linked.push(c);
  return { linked: clues.filter((c) => linked.includes(c)), zipf, checked: true };
}

// Returns { exact, close } where close is 0 to 1.
export async function judgeSummit(word, answer, definition) {
  if (word === answer) return { exact: true, close: 1 };
  const res = await callApi({ kind: "summit", word, answer, definition });
  return { exact: false, close: res ? res.close : 0, checked: Boolean(res) };
}
