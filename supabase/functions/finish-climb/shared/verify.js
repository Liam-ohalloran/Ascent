// The server's check of a finished climb (supabase/functions/finish-climb).
// It takes only the WORDS from the player's save and judges them again with
// the same dictionary and rules as the game, so any scores, heights or
// results written into a save are ignored. A word the dictionary doesn't
// know, a repeated word, or an impossible order of guesses rejects the climb.
//
// What it can't check: when each word was typed. Per-pitch timing is kept by
// the player's browser (see README, "What the server can and can't check").
import * as rules from "./rules.js";
import { validateGame } from "./stats.js";
import { judgeLinkData, judgeSummitData } from "./judge-core.js";

const fail = (error, detail) => ({ error, detail });

// raw: the saved game; puzzle: daily.puzzleFor(day); data: { assoc, freq, words }
// Returns { game, result } with every score recomputed, or { error, detail }.
export function verifyClimb(raw, puzzle, data) {
  const game = validateGame(raw);
  if (!game) return fail("invalid", "the save doesn't have the shape of a climb");
  if (!game.done || game.endReason !== "finished") return fail("unfinished", "the climb isn't finished");

  for (const [i, step] of game.pitches.entries()) {
    const t = puzzle.pitches[i];
    const seen = new Set();
    const guesses = [];
    for (const [k, g] of step.guesses.entries()) {
      if (seen.has(g.word) || t.clues.includes(g.word)) return fail("invalid", `pitch ${i + 1}: ${g.word} can't be played here`);
      seen.add(g.word);
      const v = judgeLinkData(data, g.word, t.clues, t.answer);
      if (v.unknown) return fail("invalid", `pitch ${i + 1}: ${g.word} isn't a known word`);
      const points = rules.guessPoints({ linked: v.linked.length, total: t.clues.length, tryIndex: k, zipf: v.zipf, near: v.near, strength: v.strength });
      const fit = rules.holdKind(v.linked.length, t.clues.length, v.near) === "fit";
      if (fit && k < step.guesses.length - 1) return fail("invalid", `pitch ${i + 1}: a word was played after a full fit`);
      const clean = { word: g.word, linked: v.linked, types: v.types, strength: v.strength, near: Boolean(v.near), points };
      if (Number.isFinite(v.zipf)) clean.zipf = v.zipf;
      guesses.push(clean);
    }
    step.guesses = guesses;
    step.points = rules.bestGuess(guesses)?.points || 0;
  }

  const s = game.summit;
  const answer = puzzle.summit.answer;
  const seen = new Set();
  const guesses = [];
  for (const [k, g] of s.guesses.entries()) {
    if (seen.has(g.word)) return fail("invalid", `summit: ${g.word} was played twice`);
    seen.add(g.word);
    const v = judgeSummitData(data, g.word, answer);
    if (v.unknown) return fail("invalid", `summit: ${g.word} isn't a known word`);
    if (v.exact && k < s.guesses.length - 1) return fail("invalid", "summit: a word was played after the answer");
    guesses.push({ word: g.word, exact: v.exact, near: Boolean(v.near), close: 0 });
  }
  s.guesses = guesses;
  s.solved = guesses.some((g) => g.exact);
  s.points = rules.summitPoints(s.solved, guesses.length, guesses.filter((g) => !g.exact));

  game.metres = rules.totalMetres(game);
  const res = game.pitches.map((p, i) => rules.pitchResult(p, puzzle.pitches[i].clues.length));
  const result = {
    metres: game.metres,
    summitWord: s.solved,
    pitches: [...game.pitches, s].filter((x) => x.done && x.guesses.length).length,
    time: rules.climbSeconds(game),
    accepted: [...game.pitches, s].reduce((sum, x) => sum + x.guesses.length, 0),
    rejected: game.rejected || 0,
    fits: res.filter((r) => r === "fit").length,
    partials: res.filter((r) => r === "partial").length,
    endReason: "finished",
    verified: true,
  };
  return { game, result };
}
