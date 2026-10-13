// Builds the spoiler-free share text: no words, just how the climb went.
// 🟩 fit every clue, 🟨 linked some, 🟧 a foothold or near miss, ⬛ not reached.
import { formatClock, summitReached, MAX_TOTAL, climbSeconds } from "./rules.js";

const MARK = { fit: "🟩", partial: "🟨", near: "🟧", foothold: "🟧", none: "⬛" };

export function shareText(n, name, game, results, streak) {
  const marks = results.map((r) => MARK[r] || "⬛").join("");
  const pitches = [...game.pitches, game.summit].filter((s) => s.done && s.guesses.length).length;
  const time = climbSeconds(game);
  const url = location.origin + location.pathname;
  return [
    `Ascent #${n}, ${name} ⛰️`,
    `Height: ${game.metres.toLocaleString("en-AU")} m / ${MAX_TOTAL.toLocaleString("en-AU")} m`,
    `Pitches: ${pitches} / 5  ${marks}`,
    `Time: ${formatClock(time)}`,
    `Summit: ${summitReached(game.metres) ? "Reached 🏔️" : "Not reached"}`,
    `Streak: ${streak} day${streak === 1 ? "" : "s"}`,
    url,
  ].join("\n");
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
