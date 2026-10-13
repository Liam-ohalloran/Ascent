// Builds the spoiler-free share text.
// 🟩 linked every clue, 🟨 linked some, 🟥 no hold.
const MARK = { clean: "🟩", part: "🟨", slip: "🟥" };

export function shareText(n, game, tier, results) {
  const marks = results.slice(0, 4).map((r) => MARK[r] || "⬜").join("");
  const s = game.summit;
  const summitLine = s.solved ? `🏔️ summit on clue ${s.guesses.length}` : "🌫️ summit in the clouds";
  const hints = [...game.pitches, s].filter((p) => p.hint).length;
  const hintLine = hints ? `\n🔦 ${hints} hint${hints > 1 ? "s" : ""}` : "";
  const url = location.origin + location.pathname;
  return (
    `Ascent No. ${n} ⛰️\n` +
    `${game.metres.toLocaleString()} m, ${tier}\n` +
    `${marks} ${summitLine}` +
    hintLine +
    `\n${url}`
  );
}

export async function share(text) {
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch {
      /* cancelled, fall back to copying */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
