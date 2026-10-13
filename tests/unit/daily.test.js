import { test } from "node:test";
import assert from "node:assert/strict";
import * as d from "../../js/daily.js";
import { PUZZLES, validateDay } from "../../js/puzzles.js";

const at = (iso) => new Date(iso);

test("the day changes at midnight Perth time (UTC+8), not device time", () => {
  assert.equal(d.dateKey(at("2026-10-13T15:59:59Z")), "2026-10-13"); // 11:59:59 pm Perth
  assert.equal(d.dateKey(at("2026-10-13T16:00:00Z")), "2026-10-14"); // midnight Perth
  assert.equal(d.todayNumber(at("2026-10-13T15:59:59Z")), 1);
  assert.equal(d.todayNumber(at("2026-10-13T16:00:00Z")), 2);
});

test("every timezone gets the same puzzle at the same instant", () => {
  // dateKey uses an explicit timeZone, so the process timezone can't change it.
  // Run under several TZ values in CI: TZ=America/Los_Angeles npm test.
  const instant = at("2026-10-13T20:00:00Z");
  assert.equal(d.todayNumber(instant), 2, `TZ=${process.env.TZ || "default"}`);
});

test("puzzle numbers and date keys round-trip", () => {
  assert.equal(d.numberForKey(d.LAUNCH_KEY), 1);
  assert.equal(d.keyForNumber(1), d.LAUNCH_KEY);
  for (const n of [1, 2, 30, 365, 1000]) assert.equal(d.numberForKey(d.keyForNumber(n)), n);
  assert.equal(d.keyForNumber(20), "2026-11-01", "crosses a month boundary");
});

test("before launch still shows puzzle 1, never 0 or negative", () => {
  assert.equal(d.todayNumber(at("2026-01-01T00:00:00Z")), 1);
});

test("msUntilTomorrow counts to the next Perth midnight", () => {
  assert.equal(d.msUntilTomorrow(at("2026-10-13T15:00:00Z")), 3600000);
  assert.equal(d.msUntilTomorrow(at("2026-10-13T16:00:00Z")), 86400000);
});

test("puzzle selection is deterministic and loops through the list", () => {
  assert.deepEqual(d.puzzleFor(3), d.puzzleFor(3));
  assert.deepEqual(d.puzzleFor(1), d.puzzleFor(1 + PUZZLES.length));
  assert.notDeepEqual(d.puzzleFor(1), d.puzzleFor(2));
});

test("every shipped puzzle passes validation, and broken ones are caught", () => {
  for (const [i, p] of PUZZLES.entries()) assert.equal(validateDay(p), null, `day ${i + 1}`);
  assert.ok(validateDay(null));
  assert.ok(validateDay({ name: "X", pitches: [] }));
  const broken = structuredClone(PUZZLES[0]);
  broken.pitches[1].answer = "light!";
  assert.ok(validateDay(broken));
});

test("the carried rope word becomes the first clue of the next pitch", () => {
  const day = d.puzzleFor(1);
  for (let i = 1; i < 4; i++) {
    assert.equal(day.pitches[i].clues[0], day.pitches[i - 1].answer);
    assert.equal(day.pitches[i].carried, day.pitches[i - 1].answer);
  }
  assert.equal(day.pitches[3].clues.length, 3);
});

test("no day is skipped or repeated across two years (Perth has no daylight saving)", () => {
  // Walk every Perth midnight for two years, including the dates other
  // countries change their clocks, and check the puzzle number rises by one.
  let prev = d.todayNumber(new Date("2026-10-12T16:00:00Z"));
  for (let day = 1; day <= 730; day++) {
    const midnight = new Date(Date.parse("2026-10-12T16:00:00Z") + day * 86400000);
    const justBefore = new Date(midnight.getTime() - 1000);
    assert.equal(d.todayNumber(justBefore), prev, `just before midnight, day ${day}`);
    assert.equal(d.todayNumber(midnight), prev + 1, `at midnight, day ${day}`);
    prev++;
  }
});
