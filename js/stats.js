// Saved progress, stats and streaks. Everything lives in this browser only.
//
// Save format (version 3), under the key "ascent":
//   { version: 3,
//     games:   { [puzzleNo]: game },       one per mountain played, today or replayed
//     results: { [puzzleNo]: result },     finished on its own day, used for stats
//     seenHelp: boolean }
//
// Older saves ("ascent:v1", "ascent:v2") are migrated on first load and left
// in place untouched. Everything loaded is validated: a bad game is dropped on
// its own instead of wiping the rest. Local storage can be edited by anyone,
// so none of this is treated as trustworthy for a leaderboard.
import { TIERS, tierFor, totalMetres, PITCHES, PITCH_TRIES, SUMMIT_TRIES, MAX_TOTAL } from "./rules.js";

const KEY = "ascent";
const VERSION = 3;
const OLD_KEYS = ["ascent:v2", "ascent:v1"];

let cache = null;
let persistent = true;
export let notice = ""; // shown once if saving isn't possible or data was repaired

const blank = () => ({ version: VERSION, games: {}, results: {}, seenHelp: false });
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const num = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
const WORD = /^[A-Z]{2,20}$/;

function storage() {
  try {
    const t = "__ascent_test__";
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return null;
  }
}

function readJson(store, key) {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return undefined; // present but unreadable
  }
}

function validLinkGuess(g, clueCount) {
  return isObj(g) && WORD.test(g.word) && Array.isArray(g.linked) &&
    g.linked.length <= clueCount && g.linked.every((c) => typeof c === "string") &&
    num(g.points, 0, 1000) && (g.zipf === undefined || num(g.zipf, 0, 9));
}

function validSummitGuess(g) {
  return isObj(g) && WORD.test(g.word) && typeof g.exact === "boolean" && num(g.close ?? 0, 0, 1);
}

// Returns a clean copy of a saved game, or null if it can't be trusted.
export function validateGame(g) {
  if (!isObj(g) || !Array.isArray(g.pitches) || g.pitches.length !== PITCHES || !isObj(g.summit)) return null;
  const pitches = [];
  for (const [i, p] of g.pitches.entries()) {
    if (!isObj(p) || !Array.isArray(p.guesses) || p.guesses.length > PITCH_TRIES) return null;
    const clueCount = i === 3 ? 3 : 2;
    if (!p.guesses.every((x) => validLinkGuess(x, clueCount))) return null;
    const best = Math.max(0, ...p.guesses.map((x) => x.points));
    pitches.push({ guesses: p.guesses, done: p.done === true, points: p.done === true ? best : 0, solved: false });
  }
  const s = g.summit;
  if (!Array.isArray(s.guesses) || s.guesses.length > SUMMIT_TRIES || !s.guesses.every(validSummitGuess)) return null;
  const summit = {
    guesses: s.guesses, done: s.done === true, solved: s.solved === true && s.done === true,
    points: s.done === true && num(s.points, 0, 1000) ? s.points : 0,
  };
  // Steps finish in order, so the current step is the first unfinished one.
  const steps = [...pitches, summit];
  const current = steps.findIndex((x) => !x.done);
  const doneCount = current === -1 ? steps.length : current;
  if (steps.slice(doneCount).some((x) => x.done)) return null;
  const game = { pitches, summit, current: doneCount, done: doneCount === steps.length, metres: 0 };
  game.metres = totalMetres(game);
  return game;
}

function validateResult(r) {
  if (!isObj(r) || !num(r.metres, 0, MAX_TOTAL)) return null;
  const summit = r.summit === true;
  return {
    metres: r.metres,
    summit,
    tier: TIERS.includes(r.tier) ? r.tier : tierFor(r.metres, summit),
    ...(num(r.tries, 0, 20) ? { tries: r.tries } : {}),
    ...(num(r.linked, 0, PITCHES) ? { linked: r.linked } : {}),
  };
}

function sanitise(data) {
  const out = blank();
  if (!isObj(data)) return out;
  out.seenHelp = data.seenHelp === true;
  let dropped = 0;
  for (const [k, g] of Object.entries(isObj(data.games) ? data.games : {})) {
    const n = Number(k);
    const clean = Number.isInteger(n) && n > 0 ? validateGame(g) : null;
    if (clean) out.games[n] = clean;
    else dropped++;
  }
  for (const [k, r] of Object.entries(isObj(data.results) ? data.results : {})) {
    const n = Number(k);
    const clean = Number.isInteger(n) && n > 0 ? validateResult(r) : null;
    if (clean) out.results[n] = clean;
    else dropped++;
  }
  if (dropped) notice = "Some saved progress was damaged and has been reset. Your other results are safe.";
  return out;
}

export function load() {
  if (cache) return cache;
  const store = storage();
  if (!store) {
    persistent = false;
    notice = "This browser isn't letting Ascent save, so progress will be lost when you close the page.";
    return (cache = blank());
  }
  let data = readJson(store, KEY);
  if (data === undefined) {
    notice = "Your saved progress couldn't be read, so a fresh save was started.";
    data = null;
  }
  if (!data) {
    // Migrate from an older save. v1 games used a different shape and are
    // dropped by validation, but their results and streaks carry over.
    for (const old of OLD_KEYS) {
      const prev = readJson(store, old);
      if (isObj(prev)) {
        data = { ...prev, results: { ...(data?.results || {}), ...(prev.results || {}) } };
        break;
      }
    }
    const v1 = readJson(store, "ascent:v1");
    if (data && isObj(v1)) {
      data.results = { ...(v1.results || {}), ...(data.results || {}) };
      data.seenHelp = data.seenHelp || v1.seenHelp === true;
    }
    if (data) notice = "";
  }
  cache = sanitise(data);
  write();
  return cache;
}

// Called when another tab saves, so the two don't overwrite each other.
export function reload() {
  cache = null;
  persistent = true;
  notice = "";
  return load();
}

function write() {
  if (!persistent) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    persistent = false;
    notice = "Storage is full, so new progress can't be saved.";
  }
}

export const isPersistent = () => persistent;
export const takeNotice = () => { const n = notice; notice = ""; return n; };

export function getGame(n) {
  return load().games[n] || null;
}

export function putGame(n, game) {
  load().games[n] = game;
  write();
}

// Only the mountain played on its own day counts toward stats and streaks,
// and only once: a result is never overwritten.
export function recordResult(n, result) {
  const data = load();
  if (data.results[n]) return false;
  const clean = validateResult(result);
  if (!clean) return false;
  data.results[n] = clean;
  write();
  return true;
}

export const seenHelp = () => load().seenHelp;
export function markHelpSeen() {
  load().seenHelp = true;
  write();
}

export { tierFor };

export function summary(today) {
  const results = load().results;
  const days = Object.keys(results).map(Number).filter((d) => d <= today).sort((a, b) => a - b);
  const played = days.length;
  const summits = days.filter((d) => results[d].summit).length;
  const total = days.reduce((s, d) => s + results[d].metres, 0);
  const best = days.reduce((m, d) => Math.max(m, results[d].metres), 0);
  const withTries = days.filter((d) => results[d].tries != null);
  const avgTries = withTries.length
    ? withTries.reduce((s, d) => s + results[d].tries, 0) / withTries.length
    : null;

  // Current streak: consecutive days ending today, or yesterday if today
  // isn't finished yet. A streak is one finished climb per Perth day.
  let streak = 0;
  for (let d = results[today] ? today : today - 1; results[d]; d--) streak++;

  let longest = 0;
  let run = 0;
  days.forEach((d, i) => {
    run = i > 0 && d === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });

  const spread = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const d of days) spread[results[d].tier]++;

  return {
    played, summits, best, streak, longest, spread,
    average: played ? Math.round(total / played) : 0,
    summitRate: played ? Math.round((summits / played) * 100) : 0,
    avgTries,
  };
}
