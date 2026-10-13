// Builds the spoiler-free share text: no words, just how each pitch went.
// 🟩 fit every clue, 🟨 linked some, 🟥 no hold.
const MARK = { clean: "🟩", part: "🟨", slip: "🟥" };

export function shareText(n, name, game, tier, results) {
  const marks = results.slice(0, 4).map((r) => MARK[r] || "⬜").join("");
  const s = game.summit;
  const summitLine = s.solved ? `🏔️ summit on clue ${s.guesses.length}` : "🌫️ summit in the clouds";
  const url = location.origin + location.pathname;
  return `Ascent No. ${n}, ${name} ⛰️\n${game.metres.toLocaleString("en-AU")} m, ${tier}\n${marks} ${summitLine}\n${url}`;
}

// Native share sheet on phones, clipboard elsewhere.
// Returns "shared", "copied", "cancelled" or "failed".
export async function share(text) {
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
