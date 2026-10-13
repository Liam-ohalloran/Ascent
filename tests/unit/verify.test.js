// The server's re-check of a finished climb (js/verify.js), with the real
// word data. An honest climb scores exactly as in the browser; anything a
// player edits into a save is ignored or rejected.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as rules from "../../js/rules.js";
import { puzzleFor } from "../../js/daily.js";
import { judgeLinkData, judgeSummitData } from "../../js/judge-core.js";
import { verifyClimb } from "../../js/verify.js";

const read = (f) => fs.readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf8");
const data = {
  assoc: JSON.parse(read("assoc.json")),
  freq: JSON.parse(read("freq.json")),
  words: new Set(read("words.txt").split("\n").filter(Boolean)),
};
const puzzle = puzzleFor(1);
const T0 = Date.parse("2026-10-13T04:00:00Z");

// Plays a climb the way the browser does: words per pitch, then summit words.
function play(pitchWords, summitWords) {
  const game = { current: 5, done: true, endReason: "finished", startedAt: T0, rejected: 1, metres: 0,
    pitchStarts: [0, 1, 2, 3, 4].map((i) => T0 + i * 25_000), pitches: [], summit: null };
  pitchWords.forEach((words, i) => {
    const t = puzzle.pitches[i];
    const guesses = words.map((w, k) => {
      const v = judgeLinkData(data, w, t.clues, t.answer);
      const points = rules.guessPoints({ linked: v.linked.length, total: t.clues.length, tryIndex: k, zipf: v.zipf, near: v.near, strength: v.strength });
      const g = { word: w, linked: v.linked, types: v.types, strength: v.strength, near: Boolean(v.near), points };
      if (Number.isFinite(v.zipf)) g.zipf = v.zipf;
      return g;
    });
    game.pitches.push({ guesses, done: true, points: rules.bestGuess(guesses).points, solved: false, endedAt: T0 + i * 25_000 + 5_000 });
  });
  const sg = summitWords.map((w) => ({ word: w, ...judgeSummitData(data, w, puzzle.summit.answer) }));
  const solved = sg.some((g) => g.exact);
  game.summit = { guesses: sg, done: true, solved, points: rules.summitPoints(solved, sg.length, sg.filter((g) => !g.exact)), endedAt: T0 + 105_000 };
  game.metres = rules.totalMetres(game);
  return game;
}
const copy = (x) => JSON.parse(JSON.stringify(x));

test("an honest climb verifies with the same scores the browser gave", () => {
  const game = play([["LIGHT"], ["GREEN"], ["ROOM"], ["MATE"]], ["PETRICHOR"]);
  const v = verifyClimb(copy(game), puzzle, data);
  assert.ok(!v.error, v.detail);
  assert.equal(v.result.metres, game.metres);
  assert.equal(v.result.verified, true);
  assert.equal(v.result.summitWord, true);
  assert.equal(v.result.fits, 4);
  assert.equal(v.result.time, 25);
  assert.deepEqual(v.game.pitches.map((p) => p.points), game.pitches.map((p) => p.points));
});

test("two tries, partial links and summit misses verify too", () => {
  const game = play([["SPOT", "STONE"], ["PENCIL"], ["PAPER"], ["MATE"]], ["RAIN", "SMELL", "PETRICHOR"]);
  const v = verifyClimb(copy(game), puzzle, data);
  assert.ok(!v.error, v.detail);
  assert.equal(v.result.metres, game.metres);
});

test("edited points, heights and results in a save are ignored", () => {
  const game = play([["PENCIL"], ["PENCIL"], ["PENCIL"], ["MATE"]], ["RAIN"]);
  const honest = verifyClimb(copy(game), puzzle, data).result.metres;
  const forged = copy(game);
  forged.pitches.forEach((p) => { p.points = 1000; p.guesses.forEach((g) => { g.points = 1000; }); });
  forged.summit.solved = true; forged.summit.points = 1000;
  forged.metres = 5000;
  const v = verifyClimb(forged, puzzle, data);
  assert.ok(!v.error, v.detail);
  assert.equal(v.result.metres, honest);
  assert.ok(honest < 1500, `nonsense words stay low (${honest})`);
  assert.equal(v.result.summitWord, false);
});

test("a save that contradicts itself is rejected", () => {
  const game = play([["PENCIL"], ["GREEN"], ["ROOM"], ["MATE"]], ["RAIN"]);
  game.pitches[3].guesses[0].linked = ["ROOM"]; // claims types for clues it says it didn't link
  assert.equal(verifyClimb(game, puzzle, data).error, "invalid");
});

test("made-up words reject the climb", () => {
  const game = play([["LIGHT"], ["GREEN"], ["ROOM"], ["MATE"]], ["PETRICHOR"]);
  game.pitches[1].guesses[0].word = "QZXWVQ";
  assert.equal(verifyClimb(game, puzzle, data).error, "invalid");
});

test("impossible orders reject the climb", () => {
  const afterFit = play([["LIGHT", "STONE"], ["GREEN"], ["ROOM"], ["MATE"]], ["PETRICHOR"]);
  assert.equal(verifyClimb(afterFit, puzzle, data).error, "invalid", "a second word after a full fit");
  const twice = play([["SPOT", "SPOT"], ["GREEN"], ["ROOM"], ["MATE"]], ["PETRICHOR"]);
  assert.equal(verifyClimb(twice, puzzle, data).error, "invalid", "the same word twice");
  const clue = play([["SUN"], ["GREEN"], ["ROOM"], ["MATE"]], ["PETRICHOR"]);
  assert.equal(verifyClimb(clue, puzzle, data).error, "invalid", "a clue as a guess");
  const afterSummit = play([["LIGHT"], ["GREEN"], ["ROOM"], ["MATE"]], ["PETRICHOR", "RAIN"]);
  assert.equal(verifyClimb(afterSummit, puzzle, data).error, "invalid", "a word after the summit word");
});

test("unfinished or damaged climbs aren't verified", () => {
  const game = play([["LIGHT"], ["GREEN"], ["ROOM"], ["MATE"]], ["PETRICHOR"]);
  const open = copy(game); open.summit.done = false; open.done = false; open.endReason = null;
  assert.equal(verifyClimb(open, puzzle, data).error, "unfinished");
  assert.equal(verifyClimb({ nonsense: true }, puzzle, data).error, "invalid");
});

test("the server function imports the game's own code, pinned to a commit", () => {
  const fn = fs.readFileSync(new URL("../../supabase/functions/finish-climb/index.ts", import.meta.url), "utf8");
  assert.match(fn, /cdn\.jsdelivr\.net\/gh\/Liam-ohalloran\/ascent@[0-9a-f]{40}\/js\/verify\.js/);
  assert.match(fn, /cdn\.jsdelivr\.net\/gh\/Liam-ohalloran\/ascent@[0-9a-f]{40}\/js\/daily\.js/);
});
