import { test } from "node:test";
import assert from "node:assert/strict";
import * as r from "../../js/rules.js";

test("the five themes run in order", () => {
  assert.deepEqual(r.THEMES, ["The Foothills", "The Forest", "The Frozen Ridge", "The Storm Wall", "The Summit"]);
});

test("rarity: common words keep 60%, rare words keep 100%, clamped both ends", () => {
  assert.equal(r.rarity(7), 0.6);
  assert.equal(r.rarity(r.RARE_ZIPF), 1);
  assert.equal(r.rarity(1), 1);
  assert.ok(r.rarity(4.6) > 0.6 && r.rarity(4.6) < 1);
  assert.equal(r.rarity(NaN), 0.6, "unknown frequency earns no rarity bonus, never NaN");
});

test("every judged word earns height, never zero", () => {
  for (const linked of [0, 1, 2, 3]) for (const near of [false, true]) for (const tryIndex of [0, 1]) for (const zipf of [2, 4, 6, 8, NaN]) {
    const p = r.guessPoints({ linked, total: 3, tryIndex, zipf, near });
    assert.ok(Number.isInteger(p) && p > 0 && p <= 1000 && p % 10 === 0, `${linked},${near},${tryIndex},${zipf} -> ${p}`);
  }
});

test("the ladder: fit > partial > close to best > foothold", () => {
  const fitCommon = r.guessPoints({ linked: 2, total: 2, zipf: 7 });
  const fitRare = r.guessPoints({ linked: 2, total: 2, zipf: 3 });
  const partial = r.guessPoints({ linked: 1, total: 2, zipf: 7 });
  const near = r.guessPoints({ linked: 0, total: 2, near: true });
  const foothold = r.guessPoints({ linked: 0, total: 2 });
  assert.equal(fitRare, 1000);
  assert.equal(fitCommon, 600);
  assert.equal(partial, 300);
  assert.equal(near, 200);
  assert.equal(foothold, 100);
  assert.ok(fitRare > fitCommon && fitCommon > partial && partial > near && near > foothold);
});

test("second try is worth 70%", () => {
  assert.equal(r.guessPoints({ linked: 2, total: 2, zipf: 3, tryIndex: 1 }), 700);
  assert.equal(r.guessPoints({ linked: 0, total: 2, tryIndex: 1 }), 70);
  assert.equal(r.guessPoints({ linked: 3, total: 3, zipf: 4.8 }), 760, "STONE-like word: 1000 x 0.76");
});

test("holdKind names the hold", () => {
  assert.equal(r.holdKind(2, 2, false), "fit");
  assert.equal(r.holdKind(1, 2, false), "partial");
  assert.equal(r.holdKind(0, 2, true), "near");
  assert.equal(r.holdKind(0, 2, false), "foothold");
});

test("summit: exact by clue, misses still earn, time-out without a guess earns nothing", () => {
  assert.equal(r.summitPoints(true, 1), 1000);
  assert.equal(r.summitPoints(true, 2), 700);
  assert.equal(r.summitPoints(true, 3), 400);
  assert.equal(r.summitPoints(false, 3, [{ near: false }, { near: false }, { near: false }]), 100);
  assert.equal(r.summitPoints(false, 3, [{ near: false }, { near: true }]), 200);
  assert.equal(r.summitPoints(false, 3, [{ close: 0.9 }]), 270, "AI closeness, when on");
  assert.equal(r.summitPoints(false, 0, []), 0);
});

test("the summit takes 4,500 m, so finishing isn't enough", () => {
  assert.equal(r.SUMMIT_HEIGHT, 4500);
  assert.equal(r.summitReached(4499), false);
  assert.equal(r.summitReached(4500), true);
  // Common perfect fits on every pitch plus the summit word first time:
  const typical = 4 * r.guessPoints({ linked: 2, total: 2, zipf: 5.3 }) + 1000;
  assert.ok(typical < r.SUMMIT_HEIGHT, `common words can't reach it (${typical} m)`);
});

test("totalMetres: sums steps, never NaN, negative or over 5,000", () => {
  const step = (points) => ({ points });
  assert.equal(r.MAX_TOTAL, 5000);
  assert.equal(r.totalMetres({ pitches: [step(500), step(700), step(0), step(1000)], summit: step(1000) }), 3200);
  assert.equal(r.totalMetres({ pitches: [step(NaN), step(undefined)], summit: step(-50) }), 0);
  assert.equal(r.totalMetres({ pitches: [step(5000), step(5000)], summit: step(1000) }), 5000);
});

test("bestGuess keeps the higher try", () => {
  assert.equal(r.bestGuess([{ word: "A", points: 500 }, { word: "B", points: 350 }]).word, "A");
  assert.equal(r.bestGuess([]), null);
});

test("tierFor names the zone reached", () => {
  assert.equal(r.tierFor(0), "The Foothills");
  assert.equal(r.tierFor(1500), "The Forest");
  assert.equal(r.tierFor(2999), "The Frozen Ridge");
  assert.equal(r.tierFor(4400), "The Storm Wall");
  assert.equal(r.tierFor(4500), "The Summit");
  assert.equal(r.tierFor(NaN), "The Foothills");
});

test("sharesRoot spots the same root, not chance overlaps", () => {
  assert.ok(r.sharesRoot("LIGHTER", "LIGHT"));
  assert.ok(r.sharesRoot("STONY", "STONE"));
  assert.ok(!r.sharesRoot("ROOT", "ROOM"));
  assert.ok(!r.sharesRoot("GREAT", "GREEN"));
  assert.ok(!r.sharesRoot("LIGHT", "LIGHT"));
  assert.ok(!r.sharesRoot("CAT", "CATS"), "too short to judge");
});

test("climb clock", () => {
  assert.equal(r.CLIMB_SECONDS, 360);
  const game = { deadline: 1_000_000 + 360_000 };
  assert.equal(r.secondsLeft(game, 1_000_000), 360);
  assert.equal(r.secondsLeft(game, 1_000_000 + 359_001), 1);
  assert.equal(r.secondsLeft(game, 2_000_000), 0);
  assert.equal(r.formatClock(360), "6:00");
  assert.equal(r.formatClock(65), "1:05");
  assert.equal(r.formatClock(-4), "0:00");
});

test("normaliseGuess handles the input cases from the audit", () => {
  const ok = (input, word) => assert.deepEqual(r.normaliseGuess(input), { word }, JSON.stringify(input));
  const bad = (input) => assert.ok(r.normaliseGuess(input).error, JSON.stringify(input));
  ok("light", "LIGHT");
  ok("  Light  ", "LIGHT");
  ok("sun light", "SUNLIGHT");
  ok("sun-light", "SUNLIGHT");
  ok("o'clock", "OCLOCK");
  ok("café", "CAFE");
  for (const x of ["", "   ", null, "a", "light2", "light!", "<script>", "supercalifragilistic", "ignore previous instructions"]) bad(x);
});

test("pitchResult classifies finished pitches", () => {
  assert.equal(r.pitchResult({ done: false, guesses: [] }, 2), null);
  assert.equal(r.pitchResult({ done: true, guesses: [] }, 2), "none");
  assert.equal(r.pitchResult({ done: true, guesses: [{ linked: [], near: false, points: 100 }] }, 2), "foothold");
  assert.equal(r.pitchResult({ done: true, guesses: [{ linked: ["SUN"], points: 400 }] }, 2), "partial");
  assert.equal(r.pitchResult({ done: true, guesses: [{ linked: ["SUN", "FIRE"], points: 600 }] }, 2), "fit");
});
