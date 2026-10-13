// Scores guesses. The local dictionary (data/links.json) settles most
// words instantly. Anything it doesn't link goes to the Vercel scoring
// function, which asks an AI model about real two-word phrases.
// If the function can't be reached, the dictionary result stands.

const API = location.hostname.endsWith("vercel.app")
  ? "/api/score"
  : "https://ascent-ruddy-pi.vercel.app/api/score";

let linksPromise;
function loadLinks() {
  linksPromise ||= fetch("data/links.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return linksPromise;
}
loadLinks();

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

// Returns { linked: [clue, ...], checked: boolean }.
// checked is false when the AI judge couldn't be reached for some clues.
export async function judgeLink(word, clues, answer) {
  if (word === answer) return { linked: [...clues], checked: true };
  const links = await loadLinks();
  const linked = clues.filter((c) => forms(word).some((w) => links[c]?.includes(w)));
  const unsure = clues.filter((c) => !linked.includes(c) && c !== word);
  if (!unsure.length) return { linked, checked: true };

  const res = await callApi({ kind: "link", word, clues: unsure });
  if (!res) return { linked, checked: false };
  for (const c of unsure) if (res.links?.[c]) linked.push(c);
  return { linked: clues.filter((c) => linked.includes(c)), checked: true };
}

// Returns { exact, close } where close is 0 to 1.
export async function judgeSummit(word, answer, definition) {
  if (word === answer) return { exact: true, close: 1 };
  const res = await callApi({ kind: "summit", word, answer, definition });
  return { exact: false, close: res ? res.close : 0, checked: Boolean(res) };
}
