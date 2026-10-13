// Saved progress, stats and streaks. Everything lives in this browser only.
//
// Save format (version 3), under the key "ascent":
//   { version: 3,
//     games:    { [puzzleNo]: game },       the day's one climb, in progress or finished
//     attempts: { [puzzleNo]: startedAt },  when each day's climb was begun
//     results:  { [puzzleNo]: result },     the finished climb, written once, used for stats
//     seenHelp: boolean }
//
// Older saves ("ascent:v1", "ascent:v2") are migrated on first load and left
// in place untouched. Everything loaded is validated: a bad game is dropped on
// its own instead of wiping the rest. Local storage can be edited by anyone,
// so none of this is treated as trustworthy for a leaderboard.
import { tierFor, totalMetres, summitReached, PITCHES, PITCH_TRIES, SUMMIT_TRIES, MAX_TOTAL, CLIMB_SECONDS } from "./rules.js";

let KEY = "ascent";
let backing = () => localStorage;
let testing = false;

// Test mode keeps its own save in this tab only (sessionStorage), never
// touches the real one, and never tells the account sync about changes.
export function useTestSave() {
  KEY = "ascent:test";
  backing = () => sessionStorage;
  testing = true;
  cache = null;
}
export function resetTestSave() {
  if (!testing) return;
  try { sessionStorage.removeItem(KEY); } catch {}
  cache = null;
}
const VERSION = 3;
const OLD_KEYS = ["ascent:v2", "ascent:v1"];

let cache = null;
let persistent = true;
export let notice = ""; // shown once if saving isn't possible or data was repaired

const blank = () => ({ version: VERSION, games: {}, attempts: {}, results: {}, seenHelp: false });
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const num = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
const WORD = /^[A-Z]{2,20}$/;

function storage() {
  try {
    const store = backing();
    const t = "__ascent_test__";
    store.setItem(t, t);
    store.removeItem(t);
    return store;
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
    num(g.points, 0, 1000) && (g.zipf === undefined || num(g.zipf, 0, 9)) &&
    (g.near === undefined || typeof g.near === "boolean") &&
    (g.strength === undefined || num(g.strength, 0, 1)) &&
    (g.types === undefined || (isObj(g.types) && Object.entries(g.types).every(([c, t]) =>
      g.linked.includes(c) && typeof t === "string" && /^[a-z]$/.test(t))));
}

function validSummitGuess(g) {
  return isObj(g) && WORD.test(g.word) && typeof g.exact === "boolean" && num(g.close ?? 0, 0, 1) &&
    (g.near === undefined || typeof g.near === "boolean");
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
  const time = (x) => (num(x, 1.5e12, 4e12) ? x : null);
  const startedAt = time(g.startedAt);
  const timedOut = g.endReason === "timeout";
  const game = {
    pitches, summit, current: doneCount, metres: 0,
    startedAt,
    deadline: startedAt ? startedAt + CLIMB_SECONDS * 1000 : null, // never trust a stored deadline
    endedAt: time(g.endedAt),
    endReason: doneCount === steps.length ? "finished" : timedOut ? "timeout" : null,
    rejected: num(g.rejected, 0, 999) ? Math.floor(g.rejected) : 0,
  };
  game.done = game.endReason !== null;
  game.metres = totalMetres(game);
  return game;
}

// One finished climb. Older results (before the 4,500 m summit rule) stored
// "summit" as "found the summit word", so that becomes summitWord.
function validateResult(r) {
  if (!isObj(r) || !num(r.metres, 0, MAX_TOTAL)) return null;
  const opt = (key, lo, hi) => (num(r[key], lo, hi) ? { [key]: Math.round(r[key]) } : {});
  const isNew = num(r.pitches, 0, PITCHES + 1);
  return {
    metres: r.metres,
    summit: summitReached(r.metres),
    summitWord: isNew ? r.summitWord === true : r.summit === true,
    tier: tierFor(r.metres),
    ...opt("pitches", 0, PITCHES + 1),
    ...opt("time", 0, 86400),
    ...opt("tries", 0, 20),
    ...opt("accepted", 0, 20),
    ...opt("rejected", 0, 999),
    ...opt("fits", 0, PITCHES),
    ...opt("partials", 0, PITCHES),
    ...opt("linked", 0, PITCHES),
    ...(r.endReason === "timeout" || r.endReason === "finished" ? { endReason: r.endReason } : {}),
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
  for (const [k, t] of Object.entries(isObj(data.attempts) ? data.attempts : {})) {
    const n = Number(k);
    if (Number.isInteger(n) && n > 0 && num(t, 1.5e12, 4e12)) out.attempts[n] = t;
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
  if (!data && !testing) {
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

// Lets the account sync know a day changed, so it can be saved to the account too.
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = (n) => !testing && listeners.forEach((fn) => { try { fn(n); } catch (err) { console.error(err); } });

function write() {
  if (!persistent) return;
  try {
    backing().setItem(KEY, JSON.stringify(cache));
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
  changed(n);
}

// Marks the day's climb as begun. Only the first call for a day counts.
export function recordAttempt(n, startedAt) {
  const data = load();
  if (data.attempts[n]) return false;
  data.attempts[n] = startedAt;
  write();
  changed(n);
  return true;
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
  changed(n);
  return true;
}

/* ---------- account sync ---------- */
// Rows from the account look like { day, started_at, game, result }. The
// account is the authority: its results win, its start time wins if earlier,
// and its game wins if it got further. Everything is validated like a local save.

const progress = (g) => (g ? (g.done ? 1000 : 0) + g.current * 10 +
  [...g.pitches, g.summit].reduce((s, x) => s + x.guesses.length, 0) : -1);

// Merges account rows into this browser's save. Returns the days that changed.
export function mergeRemote(rows) {
  const data = load();
  const touched = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const n = Number(row?.day);
    if (!Number.isInteger(n) || n < 1) continue;
    const t = Date.parse(row.started_at);
    if (num(t, 1.5e12, 4e12) && !(data.attempts[n] <= t)) {
      data.attempts[n] = t;
      touched.add(n);
    }
    const g = row.game ? validateGame(row.game) : null;
    if (g && progress(g) > progress(data.games[n] || null)) {
      data.games[n] = g;
      touched.add(n);
    }
    const r = row.result ? validateResult(row.result) : null;
    if (r && JSON.stringify(r) !== JSON.stringify(data.results[n])) {
      data.results[n] = r;
      touched.add(n);
    }
  }
  if (touched.size) write();
  return [...touched];
}

// The account row for one day, or null if there's nothing to save.
export function exportDay(n) {
  const data = load();
  const game = data.games[n] || null;
  const result = data.results[n] || null;
  const start = data.attempts[n] || game?.startedAt || null;
  if (!game && !result && !start) return null;
  return { day: n, started_at: start ? new Date(start).toISOString() : null, game, result };
}

// Days this browser knows more about than the account does.
export function daysToPush(rows) {
  const data = load();
  const remote = new Map((Array.isArray(rows) ? rows : []).map((r) => [Number(r.day), r]));
  const days = new Set([...Object.keys(data.games), ...Object.keys(data.attempts), ...Object.keys(data.results)].map(Number));
  return [...days].filter((n) => {
    const r = remote.get(n);
    if (!r) return true;
    if (r.result) return false; // finished on the account: nothing more to say
    if (data.results[n]) return true;
    const g = r.game ? validateGame(r.game) : null;
    return progress(data.games[n] || null) > progress(g);
  }).sort((a, b) => a - b);
}

export const seenHelp = () => load().seenHelp;
export function markHelpSeen() {
  load().seenHelp = true;
  write();
}

export { tierFor };

// How a day looks in the calendar.
export function dayStatus(n, today) {
  const data = load();
  const r = data.results[n];
  if (r) return r.summit ? "summit" : "done";
  if (n === today) return data.attempts[n] ? "climbing" : "today";
  return data.attempts[n] ? "unfinished" : "missed";
}

// Stats come only from stored results (one per day, written once), so
// opening the results again never changes them.
// Streak rule: a day counts when its climb is finished (all five pitches,
// or the timer ran out) on that day. A day with no finished climb breaks it.
export function summary(today) {
  const data = load();
  const results = data.results;
  const days = Object.keys(results).map(Number).filter((d) => d <= today).sort((a, b) => a - b);
  const completed = days.length;
  const attempted = new Set([...Object.keys(data.attempts).map(Number), ...days].filter((d) => d <= today)).size;
  const summits = days.filter((d) => results[d].summit).length;
  const total = days.reduce((s, d) => s + results[d].metres, 0);
  const best = days.reduce((m, d) => Math.max(m, results[d].metres), 0);
  const withPitches = days.filter((d) => results[d].pitches != null);
  const avgPitches = withPitches.length
    ? withPitches.reduce((s, d) => s + results[d].pitches, 0) / withPitches.length : null;

  let streak = 0;
  for (let d = results[today] ? today : today - 1; results[d]; d--) streak++;
  let longest = 0;
  let run = 0;
  days.forEach((d, i) => {
    run = i > 0 && d === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });

  const recent = days.slice(-7).reverse().map((d) => ({ n: d, ...results[d] }));
  return {
    attempted, completed, summits, best, streak, longest, recent,
    average: completed ? Math.round(total / completed) : 0,
    avgPitches,
  };
}
