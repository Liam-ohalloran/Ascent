import { PUZZLES, buildDay, validateDay } from "./puzzles.js";

// The daily mountain changes at midnight in Perth, for everyone, wherever
// they are. Perth has no daylight saving (UTC+8 all year), so a day is
// always exactly 24 hours long.
//
// Time comes from the server where possible: the HTTP Date header of a
// small same-origin request gives the real time, so a wrong or changed
// device clock can't skip ahead to a future puzzle. If that request fails,
// the device clock is used.
export const TIMEZONE = "Australia/Perth";
const PERTH_OFFSET = "+08:00";
export const LAUNCH_KEY = "2026-10-13"; // puzzle No. 1
const DAY_MS = 86400000;

let clockOffset = 0; // server time minus device time, in ms
let testShift = 0;   // test mode only: moves the game to another day

export function now() {
  return new Date(Date.now() + clockOffset + testShift);
}

// Test mode: pretend it's day n, at hh:mm Perth time (or the current Perth
// time of day if none is given). Only ever set from a ?test link.
export function travelTo(n, hhmm = null) {
  testShift = 0;
  const real = now();
  const perthMs = (real.getTime() + 8 * 3600000) % DAY_MS; // time since Perth midnight
  const [h, m] = hhmm ? hhmm.split(":").map(Number) : [];
  const timeOfDay = hhmm ? (h * 60 + m) * 60000 : perthMs;
  const midnight = Date.parse(`${keyForNumber(n)}T00:00:00${PERTH_OFFSET}`);
  testShift = midnight + timeOfDay - real.getTime();
}

export async function syncClock() {
  try {
    const sent = Date.now();
    const r = await fetch(`data/freq.json?clock=${sent}`, { method: "HEAD", cache: "no-store" });
    const header = r.headers.get("date");
    if (!header) return false;
    const server = Date.parse(header);
    if (!Number.isFinite(server)) return false;
    const received = Date.now();
    const offset = server - (sent + received) / 2;
    // The header is to the second, so ignore offsets under a minute.
    clockOffset = Math.abs(offset) > 60000 ? offset : 0;
    return true;
  } catch {
    return false;
  }
}

// YYYY-MM-DD for an instant, in Perth.
export function dateKey(date = now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

const keyToUtc = (key) => Date.parse(`${key}T00:00:00Z`);

export function numberForKey(key) {
  return Math.round((keyToUtc(key) - keyToUtc(LAUNCH_KEY)) / DAY_MS) + 1;
}

export function keyForNumber(n) {
  return new Date(keyToUtc(LAUNCH_KEY) + (n - 1) * DAY_MS).toISOString().slice(0, 10);
}

export function todayNumber(date = now()) {
  return Math.max(1, numberForKey(dateKey(date)));
}

// Milliseconds until the next Perth midnight.
export function msUntilTomorrow(date = now()) {
  const next = keyForNumber(numberForKey(dateKey(date)) + 1);
  return Date.parse(`${next}T00:00:00${PERTH_OFFSET}`) - date.getTime();
}

// Puzzles loop once the list runs out, so every day has a mountain.
// The mapping depends only on the day number, never on load order.
export function puzzleFor(n) {
  const index = (((n - 1) % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
  const raw = PUZZLES[index];
  const problem = validateDay(raw);
  if (problem) throw new Error(`Puzzle ${n} is broken: ${problem}`);
  return buildDay(raw);
}

export function formatKey(key) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
}
