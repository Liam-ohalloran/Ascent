import { PUZZLES, buildDay } from "./puzzles.js";

// Puzzle No. 1 is this local date. Every player gets the same puzzle
// on the same calendar day, and it changes at local midnight.
const LAUNCH = { y: 2026, m: 10, d: 13 };

function dayNumber(date) {
  const launch = Date.UTC(LAUNCH.y, LAUNCH.m - 1, LAUNCH.d);
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((local - launch) / 86400000) + 1;
}

export function todayNumber(now = new Date()) {
  return Math.max(1, dayNumber(now));
}

export function dateForNumber(n) {
  return new Date(LAUNCH.y, LAUNCH.m - 1, LAUNCH.d + n - 1);
}

export function puzzleFor(n) {
  const raw = PUZZLES[(n - 1) % PUZZLES.length];
  return buildDay(raw);
}

export function msUntilTomorrow(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now;
}

export function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
