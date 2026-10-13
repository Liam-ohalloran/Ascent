import { todayNumber, dateForNumber, puzzleFor, msUntilTomorrow, formatDate } from "./daily.js";
import { drawMountain, updateClimb } from "./climb.js";
import * as store from "./stats.js";
import { shareText, share } from "./share.js";
import { judgeLink, judgeSummit, rarestLinks } from "./judge.js";

// Scoring. A link pitch is worth up to 1,000 m.
// Fit: every clue your word genuinely links earns its share, so the best
// words sit right between all the clues.
// Rarity: niche words climb higher. A very common word keeps 60% of the
// height, a rare one keeps all of it.
// You get two tries and keep the better one. The second is worth 70%.
const PITCH_MAX = 1000;
const SECOND_TRY = 0.7;
const PITCH_TRIES = 2;
const COMMON_ZIPF = 5.6;   // as common as LIGHT or POWER: 60%
const RARE_ZIPF = 3.6;     // as rare as LIME or GROCER: 100%

function rarity(zipf) {
  const k = (COMMON_ZIPF - zipf) / (COMMON_ZIPF - RARE_ZIPF);
  return 0.6 + 0.4 * Math.max(0, Math.min(1, k));
}

function rarityLabel(zipf) {
  if (zipf >= 5) return "Common word";
  if (zipf >= 4.3) return "Familiar word";
  if (zipf >= 3.7) return "Uncommon word";
  return "Rare word";
}
// The summit is exact-word only, worth less with each clue revealed.
// Near-misses don't solve it, but the closest one earns a little height.
const SUMMIT_POINTS = [1000, 700, 400];
const SUMMIT_TRIES = SUMMIT_POINTS.length;
const NEAR_MISS_MAX = 300;
const MAX_LEN = 16;

const $ = (sel) => document.querySelector(sel);
const stage = $("#stage");
const svg = $("#mountainSvg");
const keyboard = $("#keyboard");

const today = todayNumber();
let n = today;
let puzzle;
let game;
let entry = "";
let locked = false;

/* ---------- state ---------- */

function freshStep() {
  return { guesses: [], done: false, points: 0, solved: false };
}

function freshGame() {
  return { current: 0, pitches: [0, 1, 2, 3].map(freshStep), summit: freshStep(), metres: 0, done: false };
}

const step = (i = game.current) => (i < 4 ? game.pitches[i] : game.summit);
const target = (i = game.current) => (i < 4 ? puzzle.pitches[i] : puzzle.summit);
const normalise = (w) => w.toUpperCase().replace(/[^A-Z]/g, "");
const round10 = (x) => Math.round(x / 10) * 10;

function linkPoints(linkedCount, total, tryIndex, zipf) {
  if (!linkedCount) return 0;
  const fit = linkedCount / total;
  const base = PITCH_MAX * fit * rarity(zipf) * (tryIndex === 0 ? 1 : SECOND_TRY);
  return Math.max(50, round10(base));
}

function best(s) {
  return s.guesses.reduce((b, g) => (g.points > (b?.points ?? -1) ? g : b), null);
}

// "full" = every clue linked, "part" = some, "slip" = none.
function stepResult(s, i) {
  if (!s.done) return null;
  if (i === 4) return s.solved ? "clean" : "slip";
  const b = best(s);
  if (!b || !b.linked.length) return "slip";
  return b.linked.length === target(i).clues.length ? "clean" : "part";
}

function climbResults() {
  return [...game.pitches, game.summit].map((s, i) => stepResult(s, i));
}

// Where each finished step left you, for drawing the rope.
function climbStops() {
  let total = 0;
  const stops = [];
  [...game.pitches, game.summit].forEach((s, i) => {
    if (!s.done) return;
    total += s.points;
    const word = i === 4 ? (s.solved ? puzzle.summit.answer : "") : best(s)?.word || "";
    stops.push({ metres: total, word, points: s.points });
  });
  return stops;
}

function drawClimb(animate) {
  updateClimb(svg, climbStops(), game.summit.solved, animate);
}

function save() {
  store.putGame(n, game);
}

/* ---------- loading ---------- */

function loadDay(num) {
  n = num;
  puzzle = puzzleFor(n);
  game = store.getGame(n) || freshGame();
  locked = false;
  entry = startingEntry();

  const label = n === today ? "Today's mountain" : "Replay";
  $("#dayLine").textContent = `No. ${n}, ${formatDate(dateForNumber(n))}. ${label}.`;

  drawMountain(svg);
  drawClimb(false);
  setAltitude(game.metres, false);
  render();
}

function startingEntry() {
  return "";
}

/* ---------- altitude ---------- */

let altFrame;
function setAltitude(metres, animate = true) {
  const numEl = $("#altNum");
  const from = Number(numEl.dataset.value || 0);
  numEl.dataset.value = metres;
  $("#altTier").textContent = store.tierFor(metres, game.summit.solved);

  cancelAnimationFrame(altFrame);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduce || from === metres) {
    numEl.textContent = metres.toLocaleString();
    return;
  }
  const start = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - start) / 900);
    numEl.textContent = Math.round(from + (metres - from) * (1 - Math.pow(1 - k, 3))).toLocaleString();
    if (k < 1) altFrame = requestAnimationFrame(tick);
  };
  altFrame = requestAnimationFrame(tick);
}

/* ---------- rendering ---------- */

function render() {
  if (game.done) {
    document.body.classList.remove("at-summit");
    renderResult();
    keyboard.hidden = true;
    stage.scrollTop = 0;
    return;
  }
  keyboard.hidden = false;
  renderKeyboard();
  const i = game.current;
  document.body.classList.toggle("at-summit", i === 4);
  i < 4 ? renderPitch(i) : renderSummit();
  keepEntryInView();
}

// The play area scrolls on short screens. Keep the typing line visible.
function keepEntryInView() {
  const el = stage.querySelector(".entry");
  if (!el) return;
  const top = el.offsetTop - stage.offsetTop;
  const bottom = top + el.offsetHeight + 64;
  if (bottom > stage.scrollTop + stage.clientHeight) stage.scrollTop = bottom - stage.clientHeight;
  else if (top < stage.scrollTop) stage.scrollTop = top - 16;
}

function entryHtml(state = "") {
  const s = step();
  if (state === "judging") {
    return `<div class="entry judging" aria-live="polite"><span class="typed">${entry}</span><span class="checking">Checking the hold…</span></div>`;
  }
  const empty = !entry ? `<span class="placeholder">Type any word</span>` : "";
  return `<div class="entry" role="textbox" aria-label="Your word" aria-readonly="true"><span class="typed">${entry}</span>${empty}<span class="caret" aria-hidden="true"></span></div>`;
}

function chipsHtml(t, i) {
  return t.clues
    .map((c, k) => {
      const carried = k === 0 && t.carried;
      return `<li class="chip${carried ? " carried" : ""}">${
        carried ? `<span class="rope-tag" aria-label="carried up the rope from pitch ${i}"></span>` : ""
      }${c}</li>`;
    })
    .join('<li class="plus" aria-hidden="true">+</li>');
}

function linkCardHtml(g, t) {
  const total = t.clues.length;
  const missed = t.clues.filter((c) => !g.linked.includes(c));
  let why;
  if (g.linked.length === total) why = total === 2 ? "Links both clues." : "Links all three clues.";
  else if (!g.linked.length) why = `Doesn't link ${t.clues.join(" or ")}.`;
  else why = `Holds on ${g.linked.join(" and ")}. Doesn't link ${missed.join(" or ")}.`;
  if (g.unchecked) why += " Only dictionary links counted this time.";
  const pts = g.points ? `+${g.points.toLocaleString()} m` : "0 m";
  const rare = g.linked.length
    ? `<span class="g-rare" title="Rarer words climb higher">${rarityLabel(g.zipf)}, ×${rarity(g.zipf).toFixed(2)}</span>`
    : "";
  return `<div class="guess-card${g.points ? "" : " zero"}">
      <div class="g-top"><span class="g-word">${g.word}</span><span class="g-pts">${pts}</span></div>
      <p class="g-why">${why} ${rare}</p>
    </div>`;
}

function renderPitch(i, outcome, judging = false) {
  const s = game.pitches[i];
  const t = puzzle.pitches[i];
  const tryNo = s.guesses.length;
  const note = outcome ? "" : tryNo === 0 ? "Two tries" : "Second try, worth 70%";
  const prompt = t.clues.length === 2
    ? "Find a word that fits between both clues. Rarer words climb higher."
    : "Find a word that fits between all three clues. Rarer words climb higher.";
  const b = best(s);

  let actions = "";
  if (!outcome && !judging) {
    const keep = tryNo > 0
      ? `<button class="btn primary" id="keepBtn">${b.points ? `Keep ${b.points.toLocaleString()} m and climb` : "Climb on with 0 m"}</button>`
      : "";
    actions = keep ? `<div class="actions">${keep}</div>` : "";
  }

  stage.innerHTML = `
    <div class="pitch">
      <div class="pitch-head">
        <h2>Pitch ${i + 1} <span>of 5</span></h2>
        <span class="try-note">${note}</span>
      </div>
      <p class="prompt">${prompt}</p>
      <ul class="chips">${chipsHtml(t, i)}</ul>
      ${s.guesses.map((g) => linkCardHtml(g, t)).join("")}
      ${outcome ? outcomeHtml(i) : entryHtml(judging ? "judging" : "")}
      ${actions}
    </div>`;
  bindActions();
}

function renderSummit(outcome, judging = false) {
  const s = game.summit;
  const t = puzzle.summit;
  const shown = outcome ? t.clues.length : Math.min(t.clues.length, s.guesses.length + 1);
  const clues = t.clues
    .map((c, k) => (k < shown ? `<li class="def">${c}</li>` : `<li class="def locked">A clearer clue after each miss</li>`))
    .join("");
  const misses = s.guesses
    .filter((g) => !g.exact)
    .map((g) => `<li class="${g.close >= 0.6 ? "close" : ""}">${g.word}<span>${g.close >= 0.6 ? "close" : "not it"}</span></li>`)
    .join("");
  const left = SUMMIT_TRIES - s.guesses.length;

  stage.innerHTML = `
    <div class="pitch summit">
      <div class="pitch-head">
        <h2>Summit</h2>
        <span class="try-note">${outcome ? "" : `${left} ${left === 1 ? "try" : "tries"} left`}</span>
      </div>
      <p class="prompt">The rope ends here. Name the uncommon word.</p>
      <ol class="defs">${clues}</ol>
      ${misses ? `<ul class="near">${misses}</ul>` : ""}
      ${outcome ? outcomeHtml(4) : entryHtml(judging ? "judging" : "")}
    </div>`;
  bindActions();
}

function outcomeHtml(i) {
  const s = step(i);
  const answer = target(i).answer;
  const pts = `+${s.points.toLocaleString()} m`;
  if (i === 4) {
    if (s.solved) return `<p class="outcome good">Summit reached. ${pts}</p>`;
    return `<p class="outcome bad">The summit stayed in the clouds. It was ${answer}.${s.points ? ` Your closest guess earned ${pts}.` : ""}</p>`;
  }
  const b = best(s);
  const rare = `<p class="rarest" id="rarest"></p>`;
  if (b && b.word === answer) return `<p class="outcome good">${pts}. ${answer} goes up the rope.</p>${rare}`;
  if (b && b.linked.length === target(i).clues.length) return `<p class="outcome good">${pts}. Great find. ${answer} goes up the rope as the next clue.</p>${rare}`;
  if (s.points) return `<p class="outcome good">${pts} banked. ${answer} goes up the rope as the next clue.</p>${rare}`;
  return `<p class="outcome bad">No hold this time. ${answer} still goes up the rope.</p>${rare}`;
}

// After a pitch, show the rarest words that would have fit.
async function showRarest(i) {
  const words = await rarestLinks(target(i).clues);
  const el = $("#rarest");
  if (el && words.length) el.textContent = `Rarest fits here: ${words.join(", ")}.`;
  stage.scrollTop = stage.scrollHeight;
}

function bindActions() {
  $("#keepBtn")?.addEventListener("click", () => finishStep());
}

function renderResult() {
  const tier = store.tierFor(game.metres, game.summit.solved);
  const first = puzzle.pitches[0].clues.join(" + ");
  const chain = puzzle.pitches.map((p) => p.answer);
  const results = climbResults();

  const rows = [...game.pitches, game.summit]
    .map((s, i) => {
      const name = i < 4 ? `Pitch ${i + 1}` : "Summit";
      const answer = target(i).answer;
      let word, how;
      if (i === 4) {
        word = s.solved ? answer : s.guesses.at(-1)?.word || answer;
        how = s.solved ? `on clue ${s.guesses.length}` : `the word was ${answer}`;
      } else {
        const b = best(s);
        word = b?.word || "—";
        const total = target(i).clues.length;
        if (!b || !b.linked.length) how = `no link. The answer was ${answer}`;
        else how = `${b.linked.length === total ? "fits every clue" : `links ${b.linked.join(" and ")} only`}, ${rarityLabel(b.zipf).toLowerCase()}`;
      }
      return `<li class="${results[i]}"><span class="r-name">${name}</span><span class="r-word">${word}</span><span class="r-how">${how}</span><span class="r-pts">${s.points.toLocaleString()} m</span></li>`;
    })
    .join("");

  const isToday = n === today;
  stage.innerHTML = `
    <div class="result">
      <h2 class="result-tier">${tier}</h2>
      <p class="chain" aria-label="Today's chain">
        <span class="seed">${first}</span>
        ${chain.map((w, i) => `<span class="arrow" aria-hidden="true">→</span><span class="link ${results[i]}">${w}</span>`).join("")}
        <span class="arrow" aria-hidden="true">→</span><span class="peak">${puzzle.summit.answer}</span>
      </p>
      <p class="definition"><strong>${puzzle.summit.answer.toLowerCase()}</strong>: ${puzzle.summit.clues.at(-1).toLowerCase()}.</p>
      <ul class="breakdown">${rows}</ul>
      <div class="result-actions">
        <button class="btn primary" id="shareBtn">Share result</button>
        ${isToday ? `<button class="btn ghost" data-open="stats" id="statsBtn">See your stats</button>` : `<button class="btn ghost" id="todayBtn">Back to today</button>`}
      </div>
      ${isToday ? `<p class="next">Next mountain in <span id="countdown"></span></p>` : ""}
    </div>`;

  $("#shareBtn").addEventListener("click", async () => {
    const res = await share(shareText(n, game, tier, results));
    if (res === "copied") toast("Result copied");
    else if (res === "failed") toast("Couldn't copy. Try again from a secure page.");
  });
  $("#todayBtn")?.addEventListener("click", () => go(today));
  $("#statsBtn")?.addEventListener("click", () => openDialog("stats"));
  if (isToday) startCountdown();
}

let countdownTimer;
function startCountdown() {
  clearInterval(countdownTimer);
  const tick = () => {
    const el = $("#countdown");
    if (!el) return clearInterval(countdownTimer);
    const ms = msUntilTomorrow();
    if (ms <= 1000) return location.reload();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ---------- input ---------- */

const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

function renderKeyboard() {
  if (keyboard.childElementCount) return;
  ROWS.forEach((row, r) => {
    const div = document.createElement("div");
    div.className = "krow";
    if (r === 2) div.appendChild(keyBtn("Enter", "enter", "Submit word"));
    for (const ch of row) div.appendChild(keyBtn(ch, ch));
    if (r === 2) div.appendChild(keyBtn("⌫", "back", "Delete letter"));
    keyboard.appendChild(div);
  });
}

function keyBtn(label, key, aria) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "key" + (key.length > 1 ? " wide" : "");
  b.textContent = label;
  b.dataset.key = key;
  if (aria) b.setAttribute("aria-label", aria);
  return b;
}

keyboard.addEventListener("click", (e) => {
  const b = e.target.closest("[data-key]");
  if (b) press(b.dataset.key);
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector("dialog[open]")) return;
  if (e.key === "Enter") press("enter");
  else if (e.key === "Backspace") press("back");
  else if (/^[a-z]$/i.test(e.key)) press(e.key.toUpperCase());
  else return;
  e.preventDefault();
});

function press(key) {
  if (game.done || locked) return;
  if (key === "back") {
    entry = entry.slice(0, -1);
  } else if (key === "enter") {
    return submit();
  } else if (entry.length < MAX_LEN) {
    entry += key;
  }
  const el = stage.querySelector(".entry");
  if (el) el.outerHTML = entryHtml();
}

function shake(msg) {
  const el = stage.querySelector(".entry");
  if (el) {
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  }
  if (msg) toast(msg);
}

async function submit() {
  const i = game.current;
  const s = step();
  const t = target();
  const word = entry;

  if (word.length < 2) return shake("Type a word first");
  if (s.guesses.some((g) => g.word === word)) return shake("Already tried that one");
  if (i < 4 && t.clues.includes(word)) return shake("That's one of the clues");

  locked = true;
  i < 4 ? renderPitch(i, null, true) : renderSummit(null, true);

  if (i < 4) {
    const { linked, zipf, checked } = await judgeLink(word, t.clues, t.answer);
    const tryIndex = s.guesses.length;
    const points = linkPoints(linked.length, t.clues.length, tryIndex, zipf);
    s.guesses.push({ word, linked, zipf, points, unchecked: !checked });
    s.points = best(s).points;
    locked = false;
    entry = startingEntry();
    if (linked.length === t.clues.length || s.guesses.length >= PITCH_TRIES) return finishStep();
    save();
    renderPitch(i);
    keepEntryInView();
    return;
  }

  const res = await judgeSummit(word, t.answer, t.clues.at(-1));
  s.guesses.push({ word, exact: res.exact, close: res.close });
  locked = false;
  entry = startingEntry();
  if (res.exact) {
    s.solved = true;
    s.points = SUMMIT_POINTS[s.guesses.length - 1];
    return finishStep();
  }
  if (s.guesses.length >= SUMMIT_TRIES) {
    const closest = Math.max(...s.guesses.map((g) => g.close || 0));
    s.points = closest >= 0.4 ? round10(NEAR_MISS_MAX * closest) : 0;
    return finishStep();
  }
  save();
  renderSummit();
  if (res.close >= 0.6) toast("Close. Think of a rarer word.");
  keepEntryInView();
}

function finishStep() {
  const i = game.current;
  const s = step(i);
  s.done = true;
  if (i < 4) s.points = best(s)?.points || 0;
  game.metres = [...game.pitches, game.summit].reduce((sum, x) => sum + x.points, 0);
  game.current = i + 1;
  if (i === 4) game.done = true;
  save();

  locked = true;
  i < 4 ? renderPitch(i, "done") : renderSummit("done");
  stage.scrollTop = stage.scrollHeight;
  if (i < 4) showRarest(i);
  drawClimb(true);
  setAltitude(game.metres);

  if (game.done && n === today) {
    const tier = store.tierFor(game.metres, game.summit.solved);
    store.recordResult(n, { metres: game.metres, summit: game.summit.solved, tier });
  }

  setTimeout(() => {
    locked = false;
    entry = startingEntry();
    render();
  }, 3200);
}

/* ---------- dialogs ---------- */

function openDialog(id) {
  if (id === "stats") renderStats();
  if (id === "archive") renderArchive();
  $("#" + id).showModal();
}

document.querySelectorAll("[data-open]").forEach((b) =>
  b.addEventListener("click", () => openDialog(b.dataset.open))
);
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  });
});
$("#help").addEventListener("close", store.markHelpSeen);

function renderStats() {
  const s = store.summary(today);
  const max = Math.max(1, ...Object.values(s.spread));
  const bars = Object.entries(s.spread)
    .reverse()
    .map(
      ([tier, count]) =>
        `<li><span class="b-name">${tier}</span><span class="b-bar"><span style="width:${
          (count / max) * 100
        }%"></span></span><span class="b-count">${count}</span></li>`
    )
    .join("");

  $("#statsBody").innerHTML = s.played
    ? `
    <dl class="figures">
      <div><dt>Climbs</dt><dd>${s.played}</dd></div>
      <div><dt>Summits</dt><dd>${s.summits}</dd></div>
      <div><dt>Streak</dt><dd>${s.streak}</dd></div>
      <div><dt>Longest</dt><dd>${s.longest}</dd></div>
    </dl>
    <p class="fine">Average ${s.average.toLocaleString()} m. Best ${s.best.toLocaleString()} m.</p>
    <h3>Where your climbs ended</h3>
    <ul class="bars">${bars}</ul>`
    : `<p>Finish today's mountain to start your record.</p>`;
}

function renderArchive() {
  const list = $("#archiveList");
  const items = [];
  for (let d = today; d >= 1; d--) {
    const g = store.getGame(d);
    const status = g?.done ? `${g.metres.toLocaleString()} m` : g ? "In progress" : "Not climbed";
    items.push(
      `<li><button class="arch${d === n ? " current" : ""}" data-day="${d}">
        <span class="a-no">No. ${d}</span>
        <span class="a-date">${formatDate(dateForNumber(d))}</span>
        <span class="a-status">${status}</span>
      </button></li>`
    );
  }
  list.innerHTML = items.join("");
  list.querySelectorAll("[data-day]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#archive").close();
      go(Number(b.dataset.day));
    })
  );
}

/* ---------- misc ---------- */

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

function go(num) {
  const url = new URL(location.href);
  if (num === today) url.searchParams.delete("day");
  else url.searchParams.set("day", num);
  history.pushState({}, "", url);
  loadDay(num);
  window.scrollTo({ top: 0 });
}

function dayFromUrl() {
  const d = Number(new URLSearchParams(location.search).get("day"));
  return Number.isInteger(d) && d >= 1 && d <= today ? d : today;
}

window.addEventListener("popstate", () => loadDay(dayFromUrl()));
// Redraw the mountain when crossing the phone/laptop breakpoint.
matchMedia("(min-width: 900px)").addEventListener("change", () => {
  drawMountain(svg);
  drawClimb(false);
});

loadDay(dayFromUrl());
if (!store.seenHelp()) openDialog("help");
