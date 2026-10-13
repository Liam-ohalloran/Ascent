// Puzzle archive quality: every day is the same for everyone, every
// intended link is justified, and pitches mix association types.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { PUZZLES, buildDay, validateDay } from "../../js/puzzles.js";
import { linkStrength } from "../../js/rules.js";

const assoc = JSON.parse(fs.readFileSync(new URL("../../data/assoc.json", import.meta.url), "utf8"));
const days = PUZZLES.map(buildDay);

// Published puzzles never change: a change would give players on the same
// day different mountains. To add a puzzle, append it and add its hash.
// To change one on purpose, it must not have been played yet.
const LOCKED = [
  "077803e374c44482", "deaddf3aeb8ddae8", "9c0cf42198710ed3", "104d1c9bfc6a6500",
  "ab5b19f0b4d469b2", "51bc26876e9a1d76", "5264ab43944287f4", "d12ac9266da7492d",
  "79df33cc975720fc", "f6c42284e112e170", "dbad60d6918185cb", "d2affa08de27c122",
  "d36a34dad2f5412c", "c4875050da436209",
];
const hash = (p) => crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16);

// Pitches whose links were written before the association rules and are
// known to be weak. Listed so they're visible, not silently accepted.
const KNOWN_WEAK = new Set(["2:3"]); // PARK + SIDE (puzzle 2, already announced)

test("published puzzles are unchanged", () => {
  LOCKED.forEach((h, i) => assert.equal(hash(PUZZLES[i]), h, `puzzle ${i + 1} changed`));
});

test("every puzzle validates", () => {
  PUZZLES.forEach((p, i) => assert.equal(validateDay(p), null, `puzzle ${i + 1}`));
});

test("the word data was rebuilt after the last puzzle change", () => {
  for (const d of days) for (const p of d.pitches) {
    for (const c of [...p.clues, p.answer]) assert.ok(assoc.links[c], `${c} missing: run npm run build:words`);
  }
});

test("every intended link is justified by a rule, not just because it's the answer", () => {
  days.forEach((d, i) => d.pitches.forEach((p, j) => {
    if (KNOWN_WEAK.has(`${i + 1}:${j + 1}`)) return;
    for (const c of p.clues) {
      const t = assoc.links[c][p.answer];
      assert.ok(t && t !== "i", `puzzle ${i + 1} pitch ${j + 1}: ${p.answer} + ${c}`);
    }
  }));
});

test("listed alternatives fit every clue on their pitch", () => {
  days.forEach((d, i) => d.pitches.forEach((p, j) => {
    for (const alt of p.alt) for (const c of p.clues) {
      assert.ok(assoc.links[c][alt], `puzzle ${i + 1} pitch ${j + 1}: ${alt} + ${c}`);
    }
  }));
});

const fits = (p) => Object.keys(assoc.links[p.clues[0]])
  .filter((w) => !p.clues.includes(w) && p.clues.every((c) => assoc.links[c][w]));

test("two-clue pitches have more than one reasonable answer (puzzles 3 onward)", () => {
  days.slice(2).forEach((d, i) => d.pitches.slice(0, 3).forEach((p, j) => {
    assert.ok(fits(p).length >= 2, `puzzle ${i + 3} pitch ${j + 1} has only ${fits(p).join(", ")}`);
  }));
});

const WORD_JOIN = new Set(["c", "p", "u"]);
test("mountains mix association types instead of leaning on compounds (puzzles 3 onward)", () => {
  days.slice(2).forEach((d, i) => {
    const joinOnly = d.pitches.filter((p) => p.clues.every((c) => WORD_JOIN.has(assoc.links[c][p.answer])));
    assert.ok(joinOnly.length <= 2, `puzzle ${i + 3}: ${joinOnly.length} compound/phrase-only pitches`);
    const meaning = d.pitches.some((p) => p.clues.some((c) => "saxrg".includes(assoc.links[c][p.answer])));
    assert.ok(meaning, `puzzle ${i + 3} has no meaning-based link`);
  });
});

test("every link in the data has a known type and strength", () => {
  for (const words of Object.values(assoc.links)) {
    for (const t of Object.values(words)) assert.ok(linkStrength(t) > 0, `type ${t}`);
  }
});
