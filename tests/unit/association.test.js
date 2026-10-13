// Association judging across link types, using the real data/assoc.json and
// data/freq.json from disk. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../../", import.meta.url);
globalThis.location = { hostname: "liam-ohalloran.github.io" };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
globalThis.fetch = async (url) => {
  if (!String(url).startsWith("data/")) throw new Error(`unexpected network call: ${url}`);
  const body = fs.readFileSync(new URL(String(url), root), "utf8");
  return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
};

const judge = await import("../../js/judge.js");
const r = await import("../../js/rules.js");

// Score a guess exactly as the game does.
async function play(word, clues, answer, tryIndex = 0) {
  const v = await judge.judgeLink(word, clues, answer);
  if (v.unknown || v.error) return v;
  const points = r.guessPoints({ linked: v.linked.length, total: clues.length, tryIndex, zipf: v.zipf, near: v.near, strength: v.strength });
  return { ...v, points, kind: r.holdKind(v.linked.length, clues.length, v.near) };
}

test("synonyms fit: TRANQUIL for QUIET + CALM, not just the intended STILL", async () => {
  const v = await play("TRANQUIL", ["QUIET", "CALM"], "STILL");
  assert.equal(v.kind, "fit");
  assert.deepEqual(v.types, { QUIET: "s", CALM: "s" });
  assert.ok(v.points >= 600);
});

test("opposites fit: SMALL for BIG + LARGE", async () => {
  const v = await play("SMALL", ["BIG", "LARGE"], "SMALL");
  assert.equal(v.types.BIG, "a");
  assert.equal(v.kind, "fit");
});

test("ambiguous pitch: a synonym and an opposite both fit BIG + LARGE", async () => {
  const huge = await play("HUGE", ["BIG", "LARGE"], "SMALL");
  const little = await play("LITTLE", ["BIG", "LARGE"], "SMALL");
  assert.equal(huge.kind, "fit");
  assert.equal(little.kind, "fit");
});

test("mixed types on one pitch: LIGHT fits TIME (phrase), DAY (phrase), DARK (opposite)", async () => {
  const v = await play("LIGHT", ["TIME", "DAY", "DARK"], "NIGHT");
  assert.equal(v.kind, "fit");
  assert.equal(v.types.DARK, "a");
  assert.ok(v.points > 100, "a creative answer that isn't the intended one still climbs");
});

test("phrases and compounds still count", async () => {
  assert.equal((await play("FALL", ["ICE", "SNOW"], "STORM")).kind, "fit", "icefall, snowfall");
  assert.equal((await play("WATER", ["STORM", "RAIN"], "CLOUD")).kind, "fit", "stormwater, rainwater");
});

test("shared context (hand-checked) counts: CROWN for QUEEN + KING", async () => {
  const v = await play("CROWN", ["QUEEN", "KING"], "CROWN");
  assert.equal(v.kind, "fit");
  const throne = await play("THRONE", ["QUEEN", "KING"], "CROWN");
  assert.equal(throne.kind, "fit", "a listed alternative fits too");
});

test("looser links earn less than strong ones at the same rarity", () => {
  const strong = r.guessPoints({ linked: 2, total: 2, zipf: 4.5, strength: 1 });
  const loose = r.guessPoints({ linked: 2, total: 2, zipf: 4.5, strength: r.MODERATE });
  assert.ok(loose < strong);
  assert.ok(loose > r.NEAR_BEST);
});

test("association can't exceed what the linked clues allow", () => {
  // One clue of two linked can never score like a full fit, whatever strength is passed.
  assert.equal(
    r.guessPoints({ linked: 1, total: 2, zipf: 4, strength: 1 }),
    r.guessPoints({ linked: 1, total: 2, zipf: 4, strength: 0.5 }),
  );
});

test("a rare word with no real link can't climb high", async () => {
  // PETRICHOR is real and rare, but has nothing to do with SUN or FIRE.
  const v = await play("PETRICHOR", ["SUN", "FIRE"], "LIGHT");
  assert.deepEqual(v.linked, []);
  assert.ok(v.points <= r.NEAR_BEST);
});

test("unknown word frequency gives no rarity bonus", () => {
  assert.equal(r.rarity(undefined), r.MIN_RARITY);
  assert.equal(r.rarityLabel(undefined), "Frequency unknown");
  assert.equal(r.guessPoints({ linked: 2, total: 2 }), 600);
});

test("string accidents from the old dictionary are no longer links", async () => {
  for (const w of ["TED", "LOS", "ATS"]) {
    const v = await judge.judgeLink(w, ["BALL", "CAR"], "PARK");
    assert.ok(v.unknown || v.linked.length === 0, `${w} must not link CAR`);
  }
  const hot = await judge.judgeLink("SNAPS", ["SUN", "FIRE"], "LIGHT");
  assert.ok(hot.unknown || hot.linked.length === 0);
});

test("a word that contains the clue isn't a link (SUNSHINE for SUN)", async () => {
  const v = await judge.judgeLink("SUNSHINE", ["SUN", "FIRE"], "LIGHT");
  assert.ok(!v.linked?.includes("SUN"));
});

test("profanity never links, though it's still a real word", async () => {
  const data = JSON.parse(fs.readFileSync(new URL("data/assoc.json", root), "utf8"));
  for (const words of Object.values(data.links)) {
    for (const bad of ["SHIT", "WHORE"]) assert.ok(!(bad in words));
  }
});

test("gibberish is refused across every pitch type", async () => {
  assert.deepEqual(await judge.judgeLink("QZXWV", ["QUIET", "CALM"], "STILL"), { unknown: true });
  assert.deepEqual(await judge.judgeLink("TRANQIL", ["QUIET", "CALM"], "STILL"), { unknown: true });
});

test("the intended answer always fits fully, even through a looser link", async () => {
  const v = await play("BONE", ["BACK", "SKELETON", "DRY"], "BONE");
  assert.equal(v.strength, 1);
  assert.equal(v.kind, "fit");
});

test("judging is deterministic: same puzzle + same word = same verdict", async () => {
  const a = await play("TRANQUIL", ["QUIET", "CALM"], "STILL");
  const b = await play("TRANQUIL", ["QUIET", "CALM"], "STILL");
  assert.deepEqual(a, b);
});

test("summit: a word sharing a sense is close (TERSE for LACONIC), others aren't", async () => {
  assert.equal((await judge.judgeSummit("TERSE", "LACONIC", "x")).near, true);
  assert.equal((await judge.judgeSummit("TRANSIENT", "EPHEMERAL", "x")).near, true);
  assert.equal((await judge.judgeSummit("BANANA", "LACONIC", "x")).near, false);
});
