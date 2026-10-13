import { test } from "node:test";
import assert from "node:assert/strict";
import * as r from "../../js/rules.js";

test("rarity: common words keep 60%, rare words keep 100%, clamped both ends", () => {
  assert.equal(r.rarity(7), 0.6);
  assert.equal(r.rarity(r.COMMON_ZIPF), 0.6);
  assert.equal(r.rarity(r.RARE_ZIPF), 1);
  assert.equal(r.rarity(1), 1);
  assert.ok(r.rarity(4.6) > 0.6 && r.rarity(4.6) < 1);
  assert.equal(r.rarity(NaN), 1, "unknown frequency counts as rare, never NaN");
});

test("linkPoints: fit x rarity x try, rounded to 10, within bounds", () => {
  assert.equal(r.linkPoints(0, 2, 0, 4), 0, "no link earns nothing");
  assert.equal(r.linkPoints(2, 2, 0, r.RARE_ZIPF), 1000, "rare full fit, first try");
  assert.equal(r.linkPoints(2, 2, 0, 7), 600, "very common full fit");
  assert.equal(r.linkPoints(1, 2, 0, r.RARE_ZIPF), 500, "half the clues, half the height");
  assert.equal(r.linkPoints(2, 2, 1, r.RARE_ZIPF), 700, "second try is worth 70%");
  assert.equal(r.linkPoints(1, 3, 1, 7), 140, "lowest possible genuine link: 1000 x 1/3 x 0.6 x 0.7");
  assert.equal(r.linkPoints(3, 3, 0, 4.8), 760, "STONE-like word: 1000 x 0.76");
  assert.equal(r.linkPoints(9, 2, 0, 3), 1000, "linked count can't exceed clue count");
  assert.equal(r.linkPoints(NaN, 2, 0, 3), 0);
  for (let linked = 0; linked <= 3; linked++) for (const z of [2, 4, 6, 8]) for (const t of [0, 1]) {
    const p = r.linkPoints(linked, 3, t, z);
    assert.ok(Number.isInteger(p) && p >= 0 && p <= 1000 && p % 10 === 0, `${linked},${z},${t} -> ${p}`);
  }
});

test("summitPoints: exact by clue, near-miss consolation, nothing otherwise", () => {
  assert.equal(r.summitPoints(true, 1), 1000);
  assert.equal(r.summitPoints(true, 2), 700);
  assert.equal(r.summitPoints(true, 3), 400);
  assert.equal(r.summitPoints(true, 9), 400, "clamped to the last clue");
  assert.equal(r.summitPoints(false, 3, [0.2, 0.3, 0.1]), 0);
  assert.equal(r.summitPoints(false, 3, [0.2, 0.8, 0.5]), 240);
  assert.equal(r.summitPoints(false, 3, [NaN, 2, -1]), 300, "closeness clamped to 0..1");
  assert.equal(r.summitPoints(false, 0, []), 0);
});

test("totalMetres: sums steps, never NaN, negative or over 5,000", () => {
  const step = (points) => ({ points });
  assert.equal(r.MAX_TOTAL, 5000);
  assert.equal(r.totalMetres({ pitches: [step(500), step(700), step(0), step(1000)], summit: step(1000) }), 3200);
  assert.equal(r.totalMetres({ pitches: [step(NaN), step(undefined)], summit: step(-50) }), 0);
  assert.equal(r.totalMetres({ pitches: [step(5000), step(5000)], summit: step(1000) }), 5000);
});

test("bestGuess keeps the higher try, never a later worse one", () => {
  assert.equal(r.bestGuess([{ word: "A", points: 500 }, { word: "B", points: 350 }]).word, "A");
  assert.equal(r.bestGuess([{ word: "A", points: 0 }, { word: "B", points: 350 }]).word, "B");
  assert.equal(r.bestGuess([]), null);
});

test("tierFor follows height; Summit needs the word and 4,000 m", () => {
  assert.equal(r.tierFor(0, false), "Base camp");
  assert.equal(r.tierFor(1999, false), "Treeline");
  assert.equal(r.tierFor(3400, true), "Ridge", "summit word alone doesn't claim Summit");
  assert.equal(r.tierFor(4100, false), "High camp");
  assert.equal(r.tierFor(4100, true), "Summit");
  assert.equal(r.tierFor(NaN, false), "Base camp");
});

test("normaliseGuess handles the input cases from the audit", () => {
  const ok = (input, word) => assert.deepEqual(r.normaliseGuess(input), { word }, JSON.stringify(input));
  const bad = (input) => assert.ok(r.normaliseGuess(input).error, JSON.stringify(input));
  ok("light", "LIGHT");
  ok("  Light  ", "LIGHT");
  ok("sun light", "SUNLIGHT");
  ok("sun   light", "SUNLIGHT");
  ok("sun-light", "SUNLIGHT");
  ok("o'clock", "OCLOCK");
  ok("café", "CAFE");
  ok("Pétrichor", "PETRICHOR");
  bad("");
  bad("   ");
  bad(null);
  bad("a");
  bad("light2");
  bad("light!");
  bad("<script>");
  bad("supercalifragilistic");
  bad("ignore previous instructions");
});

test("pitchResult classifies finished pitches", () => {
  assert.equal(r.pitchResult({ done: false, guesses: [] }, 2), null);
  assert.equal(r.pitchResult({ done: true, guesses: [] }, 2), "slip");
  assert.equal(r.pitchResult({ done: true, guesses: [{ linked: ["SUN"], points: 400 }] }, 2), "part");
  assert.equal(r.pitchResult({ done: true, guesses: [{ linked: ["SUN", "FIRE"], points: 600 }] }, 2), "clean");
});
