import { todayNumber, dateForNumber, puzzleFor, msUntilTomorrow, formatDate } from "./daily.js";
import { drawMountain, updateClimb } from "./climb.js";
import * as store from "./stats.js";
import { shareText, share } from "./share.js";

const PITCH_POINTS = [1000, 700, 400];
const SUMMIT_POINTS = [1000, 750, 500, 250];
const HINT_COST = 200;
const PITCH_TRIES = PITCH_POINTS.length;
const SUMMIT_TRIES = SUMMIT_POINTS.length;

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
  return { guesses: [], hint: false, solved: false, done: false, points: 0 };
}

function freshGame() {
  return {
    current: 0,
    pitches: [0, 1, 2, 3].map(freshStep),
    summit: freshStep(),
    metres: 0,
    done: false,
  };
}

function step(i = game.current) {
  return i < 4 ? game.pitches[i] : game.summit;
}

function target(i = game.current) {
  return i < 4 ? puzzle.pitches[i] : puzzle.summit;
}

function triesFor(i) {
  return i < 4 ? PITCH_TRIES : SUMMIT_TRIES;
}

function normalise(word) {
  return word.toUpperCase().replace(/[^A-Z]/g, "");
}

function isCorrect(guess, t) {
  return [t.answer, ...t.alt].map(normalise).includes(guess);
}

function climbResults() {
  return [...game.pitches, game.summit].map((s) =>
    s.done ? (s.solved ? "clean" : "slip") : null
  );
}

function climbWords() {
  return [...puzzle.pitches.map((p) => p.answer), puzzle.summit.answer];
}

function save() {
  store.putGame(n, game);
}

/* ---------- loading ---------- */

function loadDay(num) {
  n = num;
  puzzle = puzzleFor(n);
  game = store.getGame(n) || freshGame();
  entry = startingEntry();
  locked = false;

  const label = n === today ? "Today's mountain" : "Replay";
  $("#dayLine").textContent = `No. ${n}, ${formatDate(dateForNumber(n))}. ${label}.`;

  drawMountain(svg);
  updateClimb(svg, climbResults(), game.current, false, climbWords());
  setAltitude(game.metres, false);
  render();
}

function startingEntry() {
  if (game.done) return "";
  const s = step();
  return s.hint ? normalise(target().answer)[0] : "";
}

/* ---------- altitude ---------- */

let altFrame;
function setAltitude(metres, animate = true) {
  const numEl = $("#altNum");
  const from = Number(numEl.dataset.value || 0);
  numEl.dataset.value = metres;
  const tier = store.tierFor(metres, game.summit.solved);
  $("#altTier").textContent = tier;

  cancelAnimationFrame(altFrame);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduce || from === metres) {
    numEl.textContent = metres.toLocaleString();
    return;
  }
  const start = performance.now();
  const dur = 900;
  const tick = (t) => {
    const k = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    numEl.textContent = Math.round(from + (metres - from) * eased).toLocaleString();
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
  keepTilesInView();
}

// The clue area scrolls on short screens. Keep the answer row visible.
function keepTilesInView() {
  const tiles = stage.querySelector(".tiles");
  if (!tiles) return;
  const top = tiles.offsetTop - stage.offsetTop;
  const bottom = top + tiles.offsetHeight + 48;
  if (bottom > stage.scrollTop + stage.clientHeight) {
    stage.scrollTop = bottom - stage.clientHeight;
  } else if (top < stage.scrollTop) {
    stage.scrollTop = top - 16;
  }
}

function tilesHtml(answer, s, state = "") {
  const len = answer.length;
  let html = `<div class="tiles ${state}" style="--len:${len}" role="group" aria-label="${len} letter answer">`;
  for (let k = 0; k < len; k++) {
    const ch = state ? answer[k] : entry[k] || "";
    const fixed = s.hint && k === 0 ? " fixed" : "";
    const cursor = !state && k === entry.length ? " cursor" : "";
    html += `<span class="tile${ch ? " filled" : ""}${fixed}${cursor}">${ch}</span>`;
  }
  return html + "</div>";
}

function triesHtml(s, max) {
  let dots = "";
  for (let k = 0; k < max; k++) {
    dots += `<span class="try${k < s.guesses.length ? " used" : ""}"></span>`;
  }
  const left = max - s.guesses.length;
  return `<span class="tries" aria-label="${left} guess${left === 1 ? "" : "es"} left">${dots}</span>`;
}

function missesHtml(s) {
  if (!s.guesses.length) return "";
  return `<p class="misses"><span class="sr">Wrong guesses:</span>${s.guesses
    .map((g) => `<s>${g}</s>`)
    .join(" ")}</p>`;
}

function hintHtml(s) {
  if (s.hint) return `<p class="hint-note">First letter shown, ${HINT_COST} m off this pitch.</p>`;
  return `<button class="btn ghost hint" id="hintBtn">Show first letter <span>−${HINT_COST} m</span></button>`;
}

function renderPitch(i, outcome) {
  const s = game.pitches[i];
  const t = puzzle.pitches[i];
  const chips = t.clues
    .map((c, k) => {
      const carried = k === 0 && t.carried;
      return `<li class="chip${carried ? " carried" : ""}">${
        carried ? `<span class="rope-tag" aria-label="carried up from pitch ${i}"></span>` : ""
      }${c}</li>`;
    })
    .join('<li class="plus" aria-hidden="true">+</li>');

  const prompt = t.clues.length === 2 ? "Find the word that links both clues." : "Find the word that links all three clues.";

  stage.innerHTML = `
    <div class="pitch">
      <div class="pitch-head">
        <h2>Pitch ${i + 1} <span>of 5</span></h2>
        ${triesHtml(s, PITCH_TRIES)}
      </div>
      <p class="prompt">${prompt}</p>
      <ul class="chips">${chips}</ul>
      ${tilesHtml(normalise(t.answer), s, outcome)}
      ${outcome ? outcomeHtml(i, outcome) : missesHtml(s) + hintHtml(s)}
    </div>`;
  bindHint();
}

function renderSummit(outcome) {
  const s = game.summit;
  const t = puzzle.summit;
  const shown = Math.min(t.clues.length, s.guesses.length + 1);
  const clues = t.clues
    .map((c, k) =>
      k < shown || outcome
        ? `<li class="def">${c}</li>`
        : `<li class="def locked">Clearer clue after a wrong guess</li>`
    )
    .join("");

  stage.innerHTML = `
    <div class="pitch summit">
      <div class="pitch-head">
        <h2>Summit</h2>
        ${triesHtml(s, SUMMIT_TRIES)}
      </div>
      <p class="prompt">The rope ends here. Name the uncommon word.</p>
      <ol class="defs">${clues}</ol>
      ${tilesHtml(normalise(t.answer), s, outcome)}
      ${outcome ? outcomeHtml(4, outcome) : missesHtml(s) + hintHtml(s)}
    </div>`;
  bindHint();
}

function outcomeHtml(i, outcome) {
  const s = step(i);
  const answer = normalise(target(i).answer);
  if (i === 4) {
    return outcome === "solved"
      ? `<p class="outcome good">Summit reached. +${s.points.toLocaleString()} m</p>`
      : `<p class="outcome bad">The summit stayed in the clouds. It was ${answer}.</p>`;
  }
  return outcome === "solved"
    ? `<p class="outcome good">+${s.points.toLocaleString()} m. ${answer} goes up the rope.</p>`
    : `<p class="outcome bad">Slipped. It was ${answer}, and it still goes up the rope.</p>`;
}

function bindHint() {
  const btn = $("#hintBtn");
  if (btn) btn.addEventListener("click", useHint);
}

function renderResult() {
  const tier = store.tierFor(game.metres, game.summit.solved);
  const first = puzzle.pitches[0].clues.join(" + ");
  const chain = puzzle.pitches.map((p) => p.answer);

  const rows = [...game.pitches, game.summit]
    .map((s, i) => {
      const name = i < 4 ? `Pitch ${i + 1}` : "Summit";
      const word = normalise(target(i).answer);
      const how = s.solved
        ? `guess ${s.guesses.length}${s.hint ? ", with hint" : ""}`
        : "slipped";
      return `<li class="${s.solved ? "ok" : "miss"}"><span class="r-name">${name}</span><span class="r-word">${word}</span><span class="r-how">${how}</span><span class="r-pts">${s.points.toLocaleString()} m</span></li>`;
    })
    .join("");

  const isToday = n === today;
  stage.innerHTML = `
    <div class="result">
      <h2 class="result-tier">${tier}</h2>
      <p class="chain" aria-label="Today's chain">
        <span class="seed">${first}</span>
        ${chain.map((w) => `<span class="arrow" aria-hidden="true">↑</span><span class="link">${w}</span>`).join("")}
        <span class="arrow" aria-hidden="true">↑</span><span class="peak">${normalise(puzzle.summit.answer)}</span>
      </p>
      <p class="definition"><strong>${puzzle.summit.answer.toLowerCase()}</strong>: ${puzzle.summit.clues[puzzle.summit.clues.length - 1].toLowerCase()}.</p>
      <ul class="breakdown">${rows}</ul>
      <div class="result-actions">
        <button class="btn primary" id="shareBtn">Share result</button>
        ${isToday ? "" : `<button class="btn ghost" id="todayBtn">Back to today</button>`}
      </div>
      ${isToday ? `<p class="next">Next mountain in <span id="countdown"></span></p>` : ""}
    </div>`;

  $("#shareBtn").addEventListener("click", async () => {
    const res = await share(shareText(n, game, tier));
    if (res === "copied") toast("Result copied");
    else if (res === "failed") toast("Couldn't copy. Try again from a secure page.");
  });
  const back = $("#todayBtn");
  if (back) back.addEventListener("click", () => go(today));
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
    if (r === 2) div.appendChild(keyBtn("Enter", "enter", "Submit guess"));
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
  const s = step();
  const answer = normalise(target().answer);
  const floor = s.hint ? 1 : 0;

  if (key === "back") {
    if (entry.length > floor) entry = entry.slice(0, -1);
  } else if (key === "enter") {
    return submit();
  } else if (entry.length < answer.length) {
    entry += key;
  }
  rerenderTiles();
}

function rerenderTiles() {
  const tiles = stage.querySelector(".tiles");
  if (!tiles) return;
  const s = step();
  const answer = normalise(target().answer);
  tiles.outerHTML = tilesHtml(answer, s);
}

function shake(msg) {
  const tiles = stage.querySelector(".tiles");
  if (tiles) {
    tiles.classList.remove("shake");
    void tiles.offsetWidth;
    tiles.classList.add("shake");
  }
  if (msg) toast(msg);
}

function submit() {
  const s = step();
  const t = target();
  const answer = normalise(t.answer);
  const i = game.current;

  if (entry.length < answer.length) return shake(`Fill all ${answer.length} letters`);
  if (s.guesses.includes(entry)) return shake("Already tried that one");

  s.guesses.push(entry);

  if (isCorrect(entry, t)) {
    const base = (i < 4 ? PITCH_POINTS : SUMMIT_POINTS)[s.guesses.length - 1];
    s.points = Math.max(100, base - (s.hint ? HINT_COST : 0));
    s.solved = true;
    finishStep("solved");
  } else if (s.guesses.length >= triesFor(i)) {
    s.points = 0;
    finishStep("slipped");
  } else {
    entry = s.hint ? answer[0] : "";
    save();
    shake();
    // Re-render so the miss list (and the next summit clue) appear.
    setTimeout(() => {
      i < 4 ? renderPitch(i) : renderSummit();
      keepTilesInView();
    }, 380);
  }
}

function finishStep(outcome) {
  const i = game.current;
  const s = step(i);
  s.done = true;
  game.metres = [...game.pitches, game.summit].reduce((sum, x) => sum + x.points, 0);
  game.current = i + 1;
  if (i === 4) game.done = true;
  save();

  locked = true;
  i < 4 ? renderPitch(i, outcome) : renderSummit(outcome);
  updateClimb(svg, climbResults(), game.current, true, climbWords());
  setAltitude(game.metres);

  if (game.done) {
    const tier = store.tierFor(game.metres, game.summit.solved);
    if (n === today) {
      store.recordResult(n, { metres: game.metres, summit: game.summit.solved, tier });
    }
  }

  setTimeout(() => {
    locked = false;
    entry = startingEntry();
    render();
  }, outcome === "solved" ? 1500 : 2200);
}

function useHint() {
  const s = step();
  if (s.hint || game.done) return;
  s.hint = true;
  entry = normalise(target().answer)[0];
  save();
  render();
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

loadDay(dayFromUrl());
if (!store.seenHelp()) openDialog("help");
