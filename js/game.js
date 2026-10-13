// Ascent game loop.
//
// The game is always in exactly one phase:
//   loading   reading the clock and saved progress
//   playing   waiting for a word (the only phase that accepts input)
//   judging   a guess is being checked; input is locked so it can't be sent twice
//   feedback  a pitch just finished; waiting for the player to continue
//   done      the climb is over (results screen)
//   error     the puzzle couldn't be loaded
// Every change of phase goes through setPhase(), and a guess is only stored
// after it has been judged, in one save. Refreshing mid-check simply drops the
// unchecked guess, so nothing is ever scored twice.
import * as rules from "./rules.js";
import { syncClock, todayNumber, puzzleFor, msUntilTomorrow, keyForNumber, formatKey } from "./daily.js";
import { drawMountain, updateClimb } from "./climb.js";
import * as store from "./stats.js";
import { shareText, share } from "./share.js";
import { judgeLink, judgeSummit, rarestLinks, ready as judgeReady, ERROR_TEXT } from "./judge.js";

const $ = (sel) => document.querySelector(sel);
const stage = $("#stage");
const svg = $("#mountainSvg");
const keyboard = $("#keyboard");
const form = $("#entryForm");
const input = $("#guess");
const climbBtn = $("#climbBtn");
const formMsg = $("#formMsg");

let phase = "loading";
let today = 1;      // today's puzzle number, in Perth
let n = 1;          // the puzzle on screen (today, or a replay)
let puzzle = null;
let game = null;

/* ---------- state ---------- */

const freshStep = () => ({ guesses: [], done: false, points: 0, solved: false });
const freshGame = () => ({ current: 0, pitches: [0, 1, 2, 3].map(freshStep), summit: freshStep(), metres: 0, done: false });
const step = (i = game.current) => (i < 4 ? game.pitches[i] : game.summit);
const target = (i = game.current) => (i < 4 ? puzzle.pitches[i] : puzzle.summit);
const fmt = (m) => m.toLocaleString("en-AU");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function results() {
  return [...game.pitches.map((s, i) => rules.pitchResult(s, target(i).clues.length)),
    game.summit.done ? (game.summit.solved ? "clean" : "slip") : null];
}

function save() {
  game.metres = rules.totalMetres(game);
  store.putGame(n, game);
}

function setPhase(next) {
  phase = next;
  const typing = phase === "playing";
  document.body.dataset.phase = phase;
  form.hidden = !(typing || phase === "judging");
  keyboard.hidden = form.hidden;
  input.readOnly = !typing;
  climbBtn.disabled = !typing;
  climbBtn.textContent = phase === "judging" ? "Checking…" : "Climb";
  climbBtn.setAttribute("aria-busy", String(phase === "judging"));
}

/* ---------- loading ---------- */

async function start() {
  setPhase("loading");
  stage.innerHTML = `<p class="loading">Finding today's mountain…</p>`;
  await syncClock();
  today = todayNumber();
  store.load();
  const notice = store.takeNotice();
  if (notice) showBanner(esc(notice));
  loadDay(dayFromUrl());
  if (!store.seenHelp()) openDialog("help");
  scheduleRollover();
}

function loadDay(num) {
  n = num;
  try {
    puzzle = puzzleFor(n);
  } catch (err) {
    console.error(err);
    setPhase("error");
    stage.innerHTML = `<div class="error-state"><h2>This mountain couldn't be loaded</h2>
      <p>Its puzzle data is damaged. Try another day from Past climbs, or come back tomorrow.</p></div>`;
    return;
  }
  game = store.getGame(n) || freshGame();
  input.value = "";
  formMsg.textContent = "";
  const label = n === today ? "Today's mountain" : "Replay";
  $("#dayLine").innerHTML = `<strong>${esc(puzzle.name)}</strong>, No. ${n}. ${esc(formatKey(keyForNumber(n)))}. ${label}.`;
  drawMountain(svg);
  drawClimb(false);
  setAltitude(game.metres, false);
  render();
}

function dayFromUrl() {
  const d = Number(new URLSearchParams(location.search).get("day"));
  // Future puzzles can't be opened, whatever the URL says.
  return Number.isInteger(d) && d >= 1 && d <= today ? d : today;
}

/* ---------- daily rollover ---------- */
// When Perth passes midnight: a finished or untouched game moves straight to
// the new mountain. A climb in progress stays on screen with a banner, and it
// counts for its own day only if finished before that day ends. A climb
// started at 11:50 pm and finished at 12:10 am is kept, but as a replay.

let rolloverTimer;
function scheduleRollover() {
  clearTimeout(rolloverTimer);
  rolloverTimer = setTimeout(checkDay, Math.min(msUntilTomorrow() + 1500, 2 ** 31 - 1));
}

async function checkDay() {
  await syncClock();
  const newToday = todayNumber();
  if (newToday !== today) {
    const wasOnToday = n === today;
    today = newToday;
    if (wasOnToday) {
      const busy = phase === "judging" || (phase === "playing" && step().guesses.length + game.current > 0);
      if (busy) showBanner(`A new mountain is ready. <button class="link-btn" id="goToday" type="button">Go to today's climb</button>`, true);
      else go(today);
    }
  }
  scheduleRollover();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && phase !== "loading") checkDay();
});

// Another tab saved: reload so the two tabs don't overwrite each other.
window.addEventListener("storage", (e) => {
  if (e.key !== "ascent" || phase === "judging" || phase === "loading") return;
  store.reload();
  loadDay(n);
});

/* ---------- altitude ---------- */

let altFrame;
function setAltitude(metres, animate = true) {
  const numEl = $("#altNum");
  const from = Number(numEl.dataset.value || 0);
  numEl.dataset.value = metres;
  $("#altTier").textContent = rules.tierFor(metres, game.summit.solved);
  const left = rules.MAX_TOTAL - metres;
  $("#altLeft").textContent = left > 0 ? `${fmt(left)} m below the top` : "At the top";

  cancelAnimationFrame(altFrame);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduce || from === metres) {
    numEl.textContent = fmt(metres);
    return;
  }
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 700);
    numEl.textContent = fmt(Math.round(from + (metres - from) * (1 - (1 - k) ** 3)));
    if (k < 1) altFrame = requestAnimationFrame(tick);
  };
  altFrame = requestAnimationFrame(tick);
}

function drawClimb(animate) {
  let total = 0;
  const stops = [];
  [...game.pitches, game.summit].forEach((s, i) => {
    if (!s.done) return;
    total += s.points;
    const word = i === 4 ? (s.solved ? puzzle.summit.answer : "") : rules.bestGuess(s.guesses)?.word || "";
    stops.push({ metres: total, word, points: s.points });
  });
  updateClimb(svg, stops, game.summit.solved, animate);
}

/* ---------- rendering ---------- */

function renderTrack() {
  const res = results();
  $("#track").innerHTML = [0, 1, 2, 3, 4].map((i) => {
    const s = step(i);
    const title = i < 4 ? `Pitch ${i + 1}` : "Summit";
    const active = i === game.current && !game.done;
    const state = s.done ? res[i] : active ? "active" : "todo";
    const label = s.done ? `${title}, done, ${fmt(s.points)} metres` : active ? `${title}, current` : `${title}, still to come`;
    const mark = s.done ? (res[i] === "slip" ? "×" : "✓") : active ? "" : "";
    return `<li class="t-${state}" ${active ? 'aria-current="step"' : ""}>
      <span class="sr">${label}</span>
      <span class="t-dot" aria-hidden="true">${mark}</span>
      <span class="t-name" aria-hidden="true">${i < 4 ? i + 1 : "Top"}</span>
      <span class="t-pts" aria-hidden="true">${s.done ? fmt(s.points) : ""}</span></li>`;
  }).join("");
}

function render() {
  renderTrack();
  if (game.done) {
    setPhase("done");
    renderResult();
    return;
  }
  setPhase("playing");
  renderKeyboard();
  game.current < 4 ? renderPitch(game.current) : renderSummit();
  keepInputInView();
}

function keepInputInView() {
  requestAnimationFrame(() => form.scrollIntoView({ block: "nearest" }));
}

function chipsHtml(t, i) {
  return t.clues.map((c, k) => {
    const carried = k === 0 && t.carried;
    return `<li class="chip${carried ? " carried" : ""}">${
      carried ? `<span class="rope-tag" aria-hidden="true"></span><span class="sr">Carried up from pitch ${i}: </span>` : ""
    }${esc(c)}</li>`;
  }).join('<li class="plus" aria-hidden="true">+</li>');
}

function linkCardHtml(g, t, tryIndex) {
  const total = t.clues.length;
  const missed = t.clues.filter((c) => !g.linked.includes(c));
  let why, icon;
  if (g.linked.length === total) {
    why = total === 2 ? "Fits between both clues." : "Fits between all three clues.";
    icon = "✓";
  } else if (!g.linked.length) {
    why = `Doesn't link ${t.clues.join(" or ")}.`;
    icon = "×";
  } else {
    why = `Holds on ${g.linked.join(" and ")}, but doesn't link ${missed.join(" or ")}.`;
    icon = "½";
  }
  const parts = [];
  if (g.linked.length) parts.push(`${rules.rarityLabel(g.zipf)} ×${rules.rarity(g.zipf).toFixed(2)}`);
  if (tryIndex > 0 && g.linked.length) parts.push("second try ×0.70");
  const kind = g.points ? (g.linked.length === total ? "full" : "part") : "zero";
  return `<div class="guess-card ${kind}">
      <div class="g-top"><span class="g-icon" aria-hidden="true">${icon}</span><span class="g-word">${esc(g.word)}</span>
        <span class="g-pts">${g.points ? `+${fmt(g.points)} m` : "0 m"}</span></div>
      <p class="g-why">${why}${parts.length ? ` <span class="g-rare">${parts.join(", ")}.</span>` : ""}</p>
    </div>`;
}

function renderPitch(i) {
  const s = game.pitches[i];
  const t = puzzle.pitches[i];
  const tryNo = s.guesses.length;
  const b = rules.bestGuess(s.guesses);
  const prompt = t.clues.length === 2
    ? "Find a word that fits between both clues. Rarer words climb higher."
    : "Find a word that fits between all three clues. Rarer words climb higher.";
  const tries = tryNo === 0 ? "Try 1 of 2" : "Try 2 of 2, worth 70%";
  const keep = tryNo > 0
    ? `<div class="actions"><button class="btn ghost" type="button" id="keepBtn">${b.points ? `Keep ${fmt(b.points)} m and move on` : "Move on with 0 m"}</button></div>`
    : "";

  stage.innerHTML = `
    <section class="pitch" aria-labelledby="pitchTitle">
      <div class="pitch-head">
        <h2 id="pitchTitle">Pitch ${i + 1} <span>of 5</span></h2>
        <span class="try-note">${tries}</span>
      </div>
      <p class="prompt">${prompt}</p>
      <ul class="chips" aria-label="Clues">${chipsHtml(t, i)}</ul>
      ${s.guesses.map((g, k) => linkCardHtml(g, t, k)).join("")}
      ${keep}
    </section>`;
  $("#keepBtn")?.addEventListener("click", () => {
    if (phase === "playing") finishStep();
  });
  if (tryNo) stage.scrollTop = stage.scrollHeight; // show the newest result
}

function renderSummit() {
  const s = game.summit;
  const t = puzzle.summit;
  const shown = Math.min(t.clues.length, s.guesses.length + 1);
  const left = rules.SUMMIT_TRIES - s.guesses.length;
  const clues = t.clues.map((c, k) => (k < shown
    ? `<li class="def">${esc(c)}</li>`
    : `<li class="def locked">A clearer clue after each miss</li>`)).join("");
  const misses = s.guesses.filter((g) => !g.exact).map((g) => {
    const close = g.close >= rules.CLOSE;
    return `<li class="${close ? "close" : ""}">${esc(g.word)}<span>${close ? "close" : "not it"}</span></li>`;
  }).join("");

  stage.innerHTML = `
    <section class="pitch summit" aria-labelledby="pitchTitle">
      <div class="pitch-head">
        <h2 id="pitchTitle">Summit</h2>
        <span class="try-note">${left} ${left === 1 ? "try" : "tries"} left, worth ${fmt(rules.SUMMIT_POINTS[s.guesses.length])} m</span>
      </div>
      <p class="prompt">The rope ends here. Name the uncommon word.</p>
      <ol class="defs" aria-label="Definitions">${clues}</ol>
      ${misses ? `<ul class="near" aria-label="Your guesses">${misses}</ul>` : ""}
    </section>`;
}

function outcomeHtml(i) {
  const s = step(i);
  const answer = esc(target(i).answer);
  const pts = `+${fmt(s.points)} m`;
  if (i === 4) {
    return s.solved
      ? `<p class="outcome good"><span aria-hidden="true">✓ </span>${answer}. Summit reached, ${pts}.</p>`
      : `<p class="outcome bad"><span aria-hidden="true">× </span>The summit stayed in the clouds. The word was ${answer}.${s.points ? ` Your closest guess earned ${pts}.` : ""}</p>`;
  }
  const b = rules.bestGuess(s.guesses);
  const full = b && b.linked.length === target(i).clues.length;
  const lead = !b || !b.points
    ? `<p class="outcome bad"><span aria-hidden="true">× </span>No hold this time.</p>`
    : `<p class="outcome good"><span aria-hidden="true">${full ? "✓" : "½"} </span>${pts} with ${esc(b.word)}.</p>`;
  const rope = i < 3 ? `<p class="rope-note"><strong>${answer}</strong> goes up the rope as the next clue.</p>`
    : `<p class="rope-note">The rope word was <strong>${answer}</strong>. Next stop, the summit.</p>`;
  return `${lead}${rope}<p class="rarest" id="rarest"></p>`;
}

function renderFeedback(i) {
  const next = i < 3 ? `pitch ${i + 2}` : i === 3 ? "the summit" : "your results";
  stage.innerHTML = `
    <section class="pitch feedback" aria-labelledby="pitchTitle">
      <div class="pitch-head"><h2 id="pitchTitle">${i < 4 ? `Pitch ${i + 1}` : "Summit"} done</h2></div>
      ${i < 4 ? `<ul class="chips" aria-label="Clues">${chipsHtml(target(i), i)}</ul>` : ""}
      ${i < 4 ? step(i).guesses.map((g, k) => linkCardHtml(g, target(i), k)).join("") : ""}
      ${outcomeHtml(i)}
      <div class="actions"><button class="btn primary" type="button" id="nextBtn">On to ${next}</button></div>
    </section>`;
  const nextBtn = $("#nextBtn");
  nextBtn.addEventListener("click", continueClimb);
  nextBtn.focus({ preventScroll: true });
  requestAnimationFrame(() => nextBtn.scrollIntoView({ block: "nearest" }));
  if (i < 4) {
    rarestLinks(target(i).clues).then((words) => {
      const el = $("#rarest");
      if (el && words.length) el.textContent = `Rarest fits here: ${words.join(", ")}.`;
    });
  }
}

function continueClimb() {
  if (phase !== "feedback") return;
  render();
  if (!game.done) input.focus({ preventScroll: true });
  else $("#resultTitle")?.focus({ preventScroll: true });
}

function renderResult() {
  const res = results();
  const metres = game.metres;
  const tier = rules.tierFor(metres, game.summit.solved);
  const summary = store.summary(today);
  const linked = game.pitches.filter((s) => rules.bestGuess(s.guesses)?.linked.length).length;
  const tries = [...game.pitches, game.summit].reduce((sum, s) => sum + s.guesses.length, 0);
  const isToday = n === today;
  const counted = isToday && store.load().results[n];
  const won = game.summit.solved;

  const rows = [...game.pitches, game.summit].map((s, i) => {
    const name = i < 4 ? `Pitch ${i + 1}` : "Summit";
    const answer = target(i).answer;
    let word, how;
    if (i === 4) {
      word = won ? answer : s.guesses.at(-1)?.word || answer;
      how = won ? `found on clue ${s.guesses.length}` : `the word was ${answer}`;
    } else {
      const b = rules.bestGuess(s.guesses);
      word = b?.word || "None";
      const total = target(i).clues.length;
      if (!b || !b.linked.length) how = `no link, the rope word was ${answer}`;
      else how = `${b.linked.length === total ? "fits every clue" : `links ${b.linked.join(" and ")} only`}, ${rules.rarityLabel(b.zipf).toLowerCase()}`;
    }
    return `<li class="${res[i]}"><span class="r-name">${name}</span><span class="r-word">${esc(word)}</span><span class="r-how">${esc(how)}</span><span class="r-pts">${fmt(s.points)} m</span></li>`;
  }).join("");

  stage.innerHTML = `
    <section class="result${won ? " won" : ""}" aria-labelledby="resultTitle">
      <p class="result-kicker">${esc(puzzle.name)}, ${esc(formatKey(keyForNumber(n)))}</p>
      <h2 class="result-tier" id="resultTitle" tabindex="-1">${won ? "Summit reached" : "Climb over"}</h2>
      <p class="result-sub">${fmt(metres)} m of ${fmt(rules.MAX_TOTAL)}. ${tier}.${isToday && !counted ? " Finished after midnight, so it's saved as a replay." : ""}</p>
      <dl class="figures">
        <div><dt>Pitches linked</dt><dd>${linked}/4</dd></div>
        <div><dt>Tries used</dt><dd>${tries}</dd></div>
        ${isToday ? `<div><dt>Streak</dt><dd>${summary.streak}</dd></div><div><dt>Best</dt><dd>${fmt(summary.best)}</dd></div>` : ""}
      </dl>
      <p class="chain" aria-label="Today's rope">
        <span class="seed">${esc(puzzle.pitches[0].clues.join(" + "))}</span>
        ${puzzle.pitches.map((p) => `<span class="arrow" aria-hidden="true">→</span><span class="link">${esc(p.answer)}</span>`).join("")}
        <span class="arrow" aria-hidden="true">→</span><span class="peak">${esc(puzzle.summit.answer)}</span>
      </p>
      <p class="definition"><strong>${esc(puzzle.summit.answer.toLowerCase())}</strong>: ${esc(puzzle.summit.clues.at(-1).toLowerCase())}.</p>
      <ul class="breakdown" aria-label="Your climb, pitch by pitch">${rows}</ul>
      <div class="result-actions">
        <button class="btn primary" type="button" id="shareBtn">Share result</button>
        ${isToday ? `<button class="btn ghost" type="button" id="statsBtn">Your stats</button>`
          : `<button class="btn ghost" type="button" id="todayBtn">Back to today</button>`}
        <button class="btn ghost" type="button" id="archiveBtn">Past climbs</button>
      </div>
      ${isToday ? `<p class="next">Next mountain in <span id="countdown"></span>, at midnight Perth time.</p>` : ""}
    </section>`;

  $("#shareBtn").addEventListener("click", async () => {
    const r = await share(shareText(n, puzzle.name, game, tier, res));
    if (r === "copied") toast("Result copied. Paste it anywhere.");
    else if (r === "failed") toast("Couldn't copy. Your browser blocked the clipboard.");
  });
  $("#todayBtn")?.addEventListener("click", () => go(today));
  $("#statsBtn")?.addEventListener("click", () => openDialog("stats"));
  $("#archiveBtn").addEventListener("click", () => openDialog("archive"));
  if (isToday) startCountdown();
}

let countdownTimer;
function startCountdown() {
  clearInterval(countdownTimer);
  const tick = () => {
    const el = $("#countdown");
    if (!el) return clearInterval(countdownTimer);
    const ms = Math.max(0, msUntilTomorrow());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ---------- input ---------- */

// On touch screens the on-screen keyboard is used, so the system keyboard
// is told to stay hidden. On laptops the real keyboard types into the field.
if (matchMedia("(pointer: coarse)").matches) input.setAttribute("inputmode", "none");

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
  b.tabIndex = -1; // keyboard users type into the field; keeps Tab order short
  if (aria) b.setAttribute("aria-label", aria);
  return b;
}

keyboard.addEventListener("click", (e) => {
  const b = e.target.closest("[data-key]");
  if (!b || phase !== "playing") return;
  const key = b.dataset.key;
  if (key === "enter") return form.requestSubmit();
  input.value = key === "back" ? input.value.slice(0, -1) : (input.value + key).slice(0, 24);
  formMsg.textContent = "";
});

// Typing anywhere on the page goes into the word field.
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
  if (phase !== "playing" || e.target === input || e.target.closest?.("button, a, input")) return;
  if (/^[a-z]$/i.test(e.key)) input.focus();
});

input.addEventListener("input", () => {
  formMsg.textContent = "";
  formMsg.className = "form-msg";
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});

function showFormMsg(text, kind = "warn") {
  formMsg.textContent = text;
  formMsg.className = `form-msg ${kind}`;
  input.classList.remove("shake");
  void input.offsetWidth;
  input.classList.add("shake");
}

async function submit() {
  if (phase !== "playing") return; // a second Enter or click while checking does nothing
  const parsed = rules.normaliseGuess(input.value);
  if (parsed.error) return showFormMsg(parsed.error);
  const word = parsed.word;
  const i = game.current;
  const s = step();
  const t = target();
  if (s.guesses.some((g) => g.word === word)) return showFormMsg(`You've already tried ${word} here.`);
  if (i < 4 && t.clues.includes(word)) return showFormMsg("That's one of the clues. Find a word that joins them.");

  const forDay = n;
  const forStep = i;
  setPhase("judging");
  const verdict = i < 4 ? await judgeLink(word, t.clues, t.answer) : await judgeSummit(word, t.answer, t.clues.at(-1));

  // Ignore a late answer if the player has since moved to another day or step.
  if (n !== forDay || game.current !== forStep || phase !== "judging") return;
  if (verdict.error) {
    setPhase("playing");
    showFormMsg(ERROR_TEXT[verdict.error] || ERROR_TEXT.down, "error");
    return; // the try isn't used and the word stays in the box
  }

  input.value = "";
  if (i < 4) {
    const points = rules.linkPoints(verdict.linked.length, t.clues.length, s.guesses.length, verdict.zipf);
    s.guesses.push({ word, linked: verdict.linked, zipf: verdict.zipf, points });
    s.points = rules.bestGuess(s.guesses).points;
    const full = verdict.linked.length === t.clues.length;
    announce(full ? `${word} fits. Plus ${points} metres.` : verdict.linked.length
      ? `${word} links ${verdict.linked.join(" and ")} only. Plus ${points} metres.`
      : `${word} doesn't link the clues.`);
    if (full || s.guesses.length >= rules.PITCH_TRIES) return finishStep();
    save();
    setPhase("playing");
    renderPitch(i);
    input.focus({ preventScroll: true });
    keepInputInView();
    return;
  }

  s.guesses.push({ word, exact: verdict.exact, close: verdict.close });
  if (verdict.exact) {
    s.solved = true;
    return finishStep();
  }
  if (s.guesses.length >= rules.SUMMIT_TRIES) return finishStep();
  save();
  announce(`${word} isn't it.${verdict.close >= rules.CLOSE ? " Close, though." : ""} A clearer clue is showing.`);
  setPhase("playing");
  renderSummit();
  input.focus({ preventScroll: true });
}

// Ends the current step exactly once and saves in one write.
function finishStep() {
  if (phase !== "playing" && phase !== "judging") return;
  const i = game.current;
  const s = step(i);
  if (s.done) return;
  s.done = true;
  if (i < 4) s.points = rules.bestGuess(s.guesses)?.points || 0;
  else s.points = rules.summitPoints(s.solved, s.guesses.length, s.guesses.map((g) => g.close || 0));
  game.current = i + 1;
  game.done = game.current > 4;
  save();

  // Counts for stats only if finished on its own Perth day.
  if (game.done && n === todayNumber()) {
    const tries = [...game.pitches, game.summit].reduce((sum, x) => sum + x.guesses.length, 0);
    const linked = game.pitches.filter((p) => rules.bestGuess(p.guesses)?.linked.length).length;
    store.recordResult(n, { metres: game.metres, summit: game.summit.solved, tier: rules.tierFor(game.metres, game.summit.solved), tries, linked });
  }

  setPhase("feedback");
  renderTrack();
  renderFeedback(i);
  drawClimb(true);
  setAltitude(game.metres);
  announce(i < 4 ? `Pitch ${i + 1} done. ${game.metres} metres climbed.` : game.summit.solved ? "Summit reached." : "The climb is over.");
}

/* ---------- dialogs ---------- */

function openDialog(id) {
  if (id === "stats") renderStats();
  if (id === "archive") renderArchive();
  const d = $("#" + id);
  if (!d.open) d.showModal();
}

document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDialog(b.dataset.open)));
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  });
});
$("#help").addEventListener("close", () => {
  store.markHelpSeen();
  if (phase === "playing") input.focus({ preventScroll: true });
});

// Practice box in the rules: scored with the real rules, saved nowhere.
$("#tryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("#tryResult");
  const parsed = rules.normaliseGuess($("#tryInput").value);
  if (parsed.error) return (out.textContent = parsed.error);
  const clues = ["SUN", "FIRE"];
  if (clues.includes(parsed.word)) return (out.textContent = "That's one of the clues. Find a word that joins them.");
  const v = await judgeLink(parsed.word, clues, "LIGHT");
  if (v.error) return (out.textContent = ERROR_TEXT[v.error]);
  const pts = rules.linkPoints(v.linked.length, 2, 0, v.zipf);
  out.textContent = v.linked.length === 2
    ? `${parsed.word} fits both. ${rules.rarityLabel(v.zipf)}, so it earns ${fmt(pts)} m.`
    : v.linked.length
      ? `${parsed.word} only links ${v.linked[0]}, so it earns half: ${fmt(pts)} m.`
      : `${parsed.word} doesn't link either clue. Try LIGHT, or a rarer one like STONE.`;
});

function renderStats() {
  const s = store.summary(today);
  const max = Math.max(1, ...Object.values(s.spread));
  const bars = [...rules.TIERS].reverse().map((tier) =>
    `<li><span class="b-name">${tier}</span><span class="b-bar"><span style="width:${(s.spread[tier] / max) * 100}%"></span></span><span class="b-count">${s.spread[tier]}</span></li>`).join("");
  $("#statsBody").innerHTML = s.played ? `
    <dl class="figures">
      <div><dt>Climbs</dt><dd>${s.played}</dd></div>
      <div><dt>Summit rate</dt><dd>${s.summitRate}%</dd></div>
      <div><dt>Streak</dt><dd>${s.streak}</dd></div>
      <div><dt>Best streak</dt><dd>${s.longest}</dd></div>
    </dl>
    <p class="fine">Best height ${fmt(s.best)} m. Average ${fmt(s.average)} m.${s.avgTries != null ? ` Average ${s.avgTries.toFixed(1)} tries a climb.` : ""}</p>
    <h3>Where your climbs ended</h3>
    <ul class="bars">${bars}</ul>
    <p class="fine">A climb counts when it's finished on its own day, Perth time. Replays don't count.</p>`
    : `<p>Finish today's mountain to start your record.</p>`;
}

function renderArchive() {
  const list = $("#archiveList");
  const items = [];
  for (let d = today; d >= 1; d--) {
    let name;
    try { name = puzzleFor(d).name; } catch { continue; } // skip a broken day rather than offering it
    const g = store.getGame(d);
    const status = g?.done ? `${fmt(g.metres)} m` : g?.pitches.some((p) => p.guesses.length) || g?.current ? "In progress" : "Not climbed";
    items.push(`<li><button class="arch${d === n ? " current" : ""}" type="button" data-day="${d}">
        <span class="a-no">No. ${d}</span>
        <span class="a-name">${esc(name)}<small>${esc(formatKey(keyForNumber(d)))}</small></span>
        <span class="a-status">${status}</span></button></li>`);
  }
  list.innerHTML = items.join("");
  list.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
    $("#archive").close();
    go(Number(b.dataset.day));
  }));
}

/* ---------- misc ---------- */

function announce(text) {
  const el = $("#announce");
  el.textContent = "";
  requestAnimationFrame(() => (el.textContent = text));
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

function showBanner(html, withLink = false) {
  const b = $("#banner");
  b.innerHTML = `<span>${html}</span><button class="banner-x" type="button" aria-label="Dismiss">×</button>`;
  b.hidden = false;
  b.querySelector(".banner-x").addEventListener("click", () => (b.hidden = true));
  if (withLink) b.querySelector("#goToday")?.addEventListener("click", () => { b.hidden = true; go(today); });
}

function go(num) {
  if (phase === "judging") return;
  const url = new URL(location.href);
  if (num === today) url.searchParams.delete("day");
  else url.searchParams.set("day", num);
  history.pushState({}, "", url);
  loadDay(num);
  window.scrollTo({ top: 0 });
}

window.addEventListener("popstate", () => {
  if (phase !== "judging" && phase !== "loading") loadDay(dayFromUrl());
});

// Redraw the mountain when crossing the phone/laptop breakpoint.
matchMedia("(min-width: 900px)").addEventListener("change", () => {
  if (!game) return;
  drawMountain(svg);
  drawClimb(false);
});

judgeReady().catch(() => {}); // start fetching the word lists early
start();
