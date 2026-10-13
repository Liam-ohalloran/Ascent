// Vercel Function: judges guesses the dictionary can't settle.
//
// POST /api/score
//   { "kind": "link", "word": "YARD", "clues": ["GREEN", "BACK"] }
//     -> { "links": { "GREEN": false, "BACK": true } }
//   { "kind": "summit", "word": "GEOSMIN", "answer": "PETRICHOR", "definition": "..." }
//     -> { "close": 0.7 }
//
// The game checks data/links.json first and only asks this function
// about clues that the dictionary didn't link, so calls stay rare.
// Authenticates to AI Gateway with the deployment's OIDC token, so no
// API key is stored anywhere.

const MODEL = process.env.ASCENT_MODEL || "anthropic/claude-haiku-5.5";
const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";
const cache = new Map();

const WORD = /^[A-Z]{2,20}$/;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function ask(req, system, user) {
  const token = req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN || process.env.AI_GATEWAY_API_KEY;
  if (!token) throw new Error("No AI Gateway credentials");
  const r = await fetch(GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 120,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 160).replace(/\s+/g, " ");
    throw new Error(`Gateway ${r.status}: ${detail}`);
  }
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || "";
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) throw new Error("No JSON in model reply");
  return JSON.parse(json[0]);
}

const LINK_SYSTEM =
  "You judge a word-association puzzle. A guess LINKS to a clue only if the two words, " +
  "in either order, form a real compound word or a common, well-known two-word phrase " +
  "(e.g. QUEEN+SIZE, BEAUTY+SLEEP, BACK+YARD). Loose associations, rhymes or themes do NOT count. " +
  'Reply with JSON only: {"links": {"CLUE": true|false, ...}}.';

const SUMMIT_SYSTEM =
  "You judge a vocabulary puzzle. Rate how close a guess is in MEANING to the target word, " +
  "from 0 (unrelated) to 1 (a true synonym). Spelling similarity does not count. " +
  'Reply with JSON only: {"close": number}.';

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const word = String(body.word || "").toUpperCase();
  if (!WORD.test(word)) return res.status(400).json({ error: "Word must be 2 to 20 letters" });

  try {
    if (body.kind === "link") {
      const clues = (Array.isArray(body.clues) ? body.clues : [])
        .map((c) => String(c).toUpperCase())
        .filter((c) => WORD.test(c))
        .slice(0, 3);
      if (!clues.length) return res.status(400).json({ error: "No clues given" });
      const key = `L:${word}:${clues.join(",")}`;
      if (!cache.has(key)) {
        const out = await ask(req, LINK_SYSTEM, `Guess: ${word}\nClues: ${clues.join(", ")}`);
        const links = Object.fromEntries(clues.map((c) => [c, out.links?.[c] === true]));
        cache.set(key, { links });
      }
      res.setHeader("Cache-Control", "public, s-maxage=86400");
      return res.status(200).json(cache.get(key));
    }

    if (body.kind === "summit") {
      const answer = String(body.answer || "").toUpperCase();
      const definition = String(body.definition || "").slice(0, 200);
      if (!WORD.test(answer)) return res.status(400).json({ error: "Bad answer" });
      const key = `S:${word}:${answer}`;
      if (!cache.has(key)) {
        const out = await ask(req, SUMMIT_SYSTEM, `Target: ${answer} (${definition})\nGuess: ${word}`);
        const close = Math.max(0, Math.min(1, Number(out.close) || 0));
        cache.set(key, { close: Math.round(close * 100) / 100 });
      }
      res.setHeader("Cache-Control", "public, s-maxage=86400");
      return res.status(200).json(cache.get(key));
    }

    return res.status(400).json({ error: "kind must be link or summit" });
  } catch (err) {
    console.error("score failed:", err.message);
    // The reason is a status message, never a credential.
    return res.status(503).json({ error: "Judge unavailable", reason: err.message.slice(0, 200) });
  }
}
