// Everything is saved in this browser only (localStorage).
const KEY = "ascent:v2";

function blank() {
  return { games: {}, results: {}, seenHelp: false };
}

let cache = null;

export function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    cache = blank();
  }
  return cache;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full or blocked: the game still works for this visit */
  }
}

export function getGame(n) {
  return load().games[n] || null;
}

export function putGame(n, game) {
  load().games[n] = game;
  save();
}

// Only the puzzle played on its own day counts toward stats and streaks.
export function recordResult(n, result) {
  const data = load();
  if (data.results[n]) return;
  data.results[n] = result;
  save();
}

export function seenHelp() {
  return load().seenHelp;
}

export function markHelpSeen() {
  load().seenHelp = true;
  save();
}

export const TIERS = [
  { min: 0, name: "Base camp" },
  { min: 1000, name: "Treeline" },
  { min: 2000, name: "Snowline" },
  { min: 3000, name: "Ridge" },
  { min: 4000, name: "High camp" },
];

export function tierFor(metres, summitReached) {
  if (summitReached && metres >= 4000) return "Summit";
  let name = TIERS[0].name;
  for (const t of TIERS) if (metres >= t.min) name = t.name;
  return name;
}

export function summary(today) {
  const results = load().results;
  const days = Object.keys(results).map(Number).sort((a, b) => a - b);
  const played = days.length;
  const summits = days.filter((d) => results[d].summit).length;
  const total = days.reduce((s, d) => s + results[d].metres, 0);
  const best = days.reduce((m, d) => Math.max(m, results[d].metres), 0);

  // Current streak: consecutive days ending today (or yesterday, if
  // today hasn't been played yet).
  let streak = 0;
  let d = results[today] ? today : today - 1;
  while (results[d]) {
    streak++;
    d--;
  }

  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const tiers = ["Base camp", "Treeline", "Snowline", "Ridge", "High camp", "Summit"];
  const spread = Object.fromEntries(tiers.map((t) => [t, 0]));
  for (const day of days) spread[results[day].tier]++;

  return {
    played,
    summits,
    average: played ? Math.round(total / played) : 0,
    best,
    streak,
    longest,
    spread,
  };
}
