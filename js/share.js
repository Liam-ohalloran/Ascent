// Builds the spoiler-free share text.
const PITCH_MARK = ["🟩", "🟨", "🟧"]; // solved on guess 1, 2, 3

export function shareText(n, game, tier) {
  const marks = game.pitches.map((p) => {
    if (!p.solved) return "🟥";
    return PITCH_MARK[p.guesses.length - 1] || "🟧";
  });

  const s = game.summit;
  const summitLine = s.solved
    ? `🏔️ summit on clue ${s.guesses.length}`
    : "🌫️ summit in the clouds";

  const hints = [...game.pitches, s].filter((p) => p.hint).length;
  const hintLine = hints ? `\n🔦 ${hints} hint${hints > 1 ? "s" : ""}` : "";

  const url = location.origin + location.pathname;
  return (
    `Ascent No. ${n} ⛰️\n` +
    `${game.metres.toLocaleString()} m, ${tier}\n` +
    `${marks.join("")} ${summitLine}` +
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
