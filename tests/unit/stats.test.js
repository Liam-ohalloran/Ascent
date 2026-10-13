import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// A minimal localStorage stand-in.
class MemoryStorage {
  constructor(data = {}) { this.data = { ...data }; this.broken = false; }
  getItem(k) { if (this.broken) throw new Error("blocked"); return k in this.data ? this.data[k] : null; }
  setItem(k, v) { if (this.broken) throw new Error("blocked"); this.data[k] = String(v); }
  removeItem(k) { delete this.data[k]; }
}
globalThis.localStorage = new MemoryStorage();
const store = await import("../../js/stats.js");

const linkStep = (points, done = true, word = "LIGHT") => ({
  guesses: [{ word, linked: points ? ["SUN", "FIRE"] : [], zipf: 5, points }], done, points,
});
const game = (overrides = {}) => ({
  current: 5, done: true, metres: 0,
  pitches: [linkStep(600), linkStep(700), linkStep(0), { ...linkStep(800), guesses: [{ word: "MATE", linked: ["A", "B", "C"], zipf: 4.5, points: 800 }] }],
  summit: { guesses: [{ word: "PETRICHOR", exact: true, close: 1 }], done: true, solved: true, points: 1000 },
  ...overrides,
});

function fresh(data = {}) {
  globalThis.localStorage = new MemoryStorage(data);
  store.reload();
}

beforeEach(() => fresh());

test("a new player starts with an empty, versioned save", () => {
  const data = store.load();
  assert.equal(data.version, 3);
  assert.deepEqual(data.games, {});
  assert.equal(store.seenHelp(), false);
  assert.ok(JSON.parse(localStorage.getItem("ascent")));
});

test("progress survives a reload, and the total is recomputed from the steps", () => {
  store.putGame(1, game({ metres: 99999 }));
  fresh(localStorage.data);
  const g = store.getGame(1);
  assert.equal(g.metres, 3100, "stored total isn't trusted");
  assert.equal(g.current, 5);
  assert.equal(g.done, true);
});

test("v1 results, streaks and the tutorial flag carry over to the new save", () => {
  fresh({ "ascent:v1": JSON.stringify({ games: { 1: { old: "shape" } }, results: { 1: { metres: 3000, summit: true, tier: "Ridge" } }, seenHelp: true }) });
  assert.equal(store.seenHelp(), true);
  assert.deepEqual(store.load().results[1], { metres: 3000, summit: true, tier: "Ridge" });
  assert.equal(store.getGame(1), null, "v1 games had a different shape and are dropped");
  assert.ok(localStorage.getItem("ascent:v1"), "the old save is left in place");
});

test("v2 games carry over and v1 results fill gaps", () => {
  fresh({
    "ascent:v2": JSON.stringify({ games: { 2: game() }, results: { 2: { metres: 3100, summit: true, tier: "Ridge" } } }),
    "ascent:v1": JSON.stringify({ results: { 1: { metres: 2000, summit: false, tier: "Snowline" } }, seenHelp: true }),
  });
  assert.ok(store.getGame(2));
  assert.equal(Object.keys(store.load().results).length, 2);
  assert.equal(store.seenHelp(), true);
});

test("unreadable JSON starts a fresh save with a notice instead of crashing", () => {
  fresh({ ascent: "{not json" });
  assert.deepEqual(store.load().games, {});
  assert.match(store.takeNotice(), /couldn't be read/);
});

test("one damaged game is dropped without wiping the others", () => {
  fresh({ ascent: JSON.stringify({ version: 3, games: { 1: game(), 2: { current: 7, pitches: null } }, results: { 1: { metres: 3100, summit: true, tier: "Ridge" }, 2: { metres: "lots" } } }) });
  assert.ok(store.getGame(1));
  assert.equal(store.getGame(2), null);
  assert.ok(store.load().results[1]);
  assert.equal(store.load().results[2], undefined);
  assert.match(store.takeNotice(), /damaged/);
});

test("validateGame rejects impossible states", () => {
  assert.ok(store.validateGame(game()));
  const outOfOrder = game();
  outOfOrder.pitches[1].done = false; // pitch 3 done but pitch 2 not
  assert.equal(store.validateGame(outOfOrder), null);
  const tooMany = game();
  tooMany.pitches[0].guesses.push(...tooMany.pitches[0].guesses, ...tooMany.pitches[0].guesses);
  assert.equal(store.validateGame(tooMany), null, "more tries than allowed");
  const badWord = game();
  badWord.pitches[0].guesses[0].word = "<img onerror=x>";
  assert.equal(store.validateGame(badWord), null);
  const inProgress = store.validateGame(game({ current: 99, done: true, summit: { guesses: [], done: false, solved: false, points: 0 } }));
  assert.equal(inProgress.current, 4, "current is derived from finished steps");
  assert.equal(inProgress.done, false);
});

test("a result is recorded once per day and never overwritten", () => {
  assert.equal(store.recordResult(5, { metres: 3000, summit: true, tier: "Ridge" }), true);
  assert.equal(store.recordResult(5, { metres: 5000, summit: true, tier: "Summit" }), false);
  assert.equal(store.load().results[5].metres, 3000);
  assert.equal(store.recordResult(6, { metres: "x" }), false, "invalid results are refused");
});

test("streaks count consecutive days and handle gaps", () => {
  const r = (metres) => ({ metres, summit: metres > 3000, tier: "Ridge" });
  for (const d of [1, 2, 3, 5, 6]) store.recordResult(d, r(3200));
  assert.equal(store.summary(6).streak, 2, "days 5 and 6");
  assert.equal(store.summary(7).streak, 2, "today not played yet keeps yesterday's streak");
  assert.equal(store.summary(8).streak, 0, "a missed day breaks it");
  assert.equal(store.summary(6).longest, 3);
  assert.equal(store.summary(6).played, 5);
  assert.equal(store.summary(6).summitRate, 100);
});

test("blocked storage keeps the game playable in memory and says so", () => {
  globalThis.localStorage = new MemoryStorage();
  localStorage.broken = true;
  store.reload();
  store.putGame(1, game());
  assert.ok(store.getGame(1), "still works for this visit");
  assert.equal(store.isPersistent(), false);
  assert.match(store.takeNotice(), /isn't letting Ascent save/);
});
