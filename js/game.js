// Ascent: one climb a day.
//
// The day moves through three screens:
//   ready    today's mountain, waiting for "Begin climb"
//   climb    the timed attempt: five themed pitches
//   results  the finished climb, shown for the rest of the day
// and inside the climb the game is always in exactly one phase:
//   playing   waiting for a word (the only phase that accepts input)
//   judging   a guess is being checked; input is locked so it can't be sent twice
//   feedback  a pitch just finished; waiting for the player to continue
// Every change goes through setPhase(). A guess is stored only after it has
// been judged, in one save, so refreshing mid-check can't score it twice.
// The climb's deadline is saved when it begins, so refreshing never resets
// the timer, and there is no way to start the day's climb again.
import * as rules from "./rules.js";
import { syncClock, travelTo, now, todayNumber, puzzleFor, msUntilTomorrow, keyForNumber, formatKey } from "./daily.js";
import { drawMountain, updateClimb } from "./climb.js";
import * as store from "./stats.js";
import { shareText, share } from "./share.js";
import * as account from "./account.js";
import { judgeLink, judgeSummit, rarestLinks, ready as judgeReady, ERROR_TEXT } from "./judge.js";

const $ = (sel) => document.querySelector(sel);
const stage = $("#stage");
const svg = $("#mountainSvg");
const keyboard = $("#keyboard");
const form = $("#entryForm");
const input = $("#guess");
const climbBtn = $("#climbBtn");
const formMsg = $("#formMsg");
const timerEl = $("#timer");

let phase = "loading";
let today = 1;
let n = 1;
let puzzle = null;
let game = null;

/* ---------- state ---------- */

const freshStep = () => ({ guesses: [], done: false, points: 0, solved: false });
const freshGame = () => ({
  current: 0, pitches: [0, 1, 2, 3].map(freshStep), summit: freshStep(), metres: 0, done: false,
  startedAt: null, deadline: null, endedAt: null, endReason: null, rejected: 0,
});
const step = (i = game.current) => (i < 4 ? game.pitches[i] : game.summit);
const target = (i = game.current) => (i < 4 ? puzzle.pitches[i] : puzzle.summit);
const fmt = (m) => m.toLocaleString("en-AU");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nowMs = () => now().getTime();
const SHORT_THEME = ["Foothills", "Forest", "Ridge", "Storm", "Summit"];

function resultsFor(g, p) {
  return [...g.pitches.map((s, i) => rules.pitchResult(s, p.pitches[i].clues.length)),
    g.summit.done ? (g.summit.solved ? "fit" : g.summit.guesses.length ? "foothold" : "none") : null];
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
  const climbing = ["playing", "judging", "feedback"].includes(phase) && game && !game.done;
  timerEl.hidden = !climbing;
  if (climbing) startTimer();
  else stopTimer();
}

/* ---------- loading ---------- */

// Test mode, from a link: ?test plays tomorrow's mountain, ?test=5 plays
// No. 5, and &at=23:58 starts at that Perth time (to watch midnight pass).
// It has its own throwaway save in this tab, so real stats are never touched.
const TEST = (() => {
  const q = new URLSearchParams(location.search);
  if (!q.has("test")) return null;
  const n = Number(q.get("test"));
  const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(q.get("at") || "") ? q.get("at") : null;
  return { day: Number.isInteger(n) && n > 0 ? n : null, at };
})();

async function start() {
  setPhase("loading");
  stage.innerHTML = `<p class="loading">Finding today's mountain…</p>`;
  await syncClock();
  if (TEST) {
    store.useTestSave();
    travelTo(TEST.day || todayNumber() + 1, TEST.at);
    document.body.classList.add("test-mode");
  }
  today = todayNumber();
  store.load();
  const notice = store.takeNotice();
  if (notice) showBanner(esc(notice));
  loadToday();
  if (!TEST && !store.seenHelp()) openDialog("help");
  scheduleRollover();
  if (TEST) return showTestBanner();
  account.subscribe(accountChanged);
  account.initAccount({ onSync: synced });
}

function showTestBanner() {
  const exit = location.pathname;
  showBanner(`<strong>Test mode.</strong> It's ${esc(formatKey(keyForNumber(today)))} here, Perth time. Nothing counts toward your real streak or stats.
    <span class="test-actions"><button class="link-btn" type="button" id="testReset">Start the test again</button> · <a class="link-btn" href="${exit}">Back to today</a></span>`);
  $("#testReset").addEventListener("click", () => { store.resetTestSave(); location.reload(); });
}

/* ---------- account ---------- */

// The account brought in climbs from another device. Only redraw when nothing
// is being typed, so a sync never interrupts a climb.
function synced(days) {
  if (days.includes(today) && !["playing", "judging", "feedback"].includes(phase)) loadToday();
  if ($("#stats").open) renderStats();
  if ($("#archive").open) renderArchive();
  if (days.length > 1 || !days.includes(today)) toast("Your climbs are synced.");
}

function accountChanged(s) {
  const btn = $("#accountBtn");
  btn.classList.toggle("signed-in", s.status === "in");
  btn.setAttribute("aria-label", s.status === "in" ? `Account, signed in as ${s.email}` : "Account, not signed in");
  if ($("#account").open) renderAccount();
}

let linkSentTo = "";
function renderAccount() {
  const s = account.state;
  const body = $("#accountBody");
  const msg = s.message ? `<p class="account-msg" role="status">${esc(s.message)}</p>` : "";
  if (TEST) {
    body.innerHTML = `<p>Accounts are off in test mode, so nothing here is saved to your account.</p>`;
  } else if (s.status === "loading") {
    body.innerHTML = `<p class="loading">Checking your account…</p>`;
  } else if (s.status === "unavailable") {
    body.innerHTML = `${msg}<p class="fine">You can keep playing. Nothing is lost.</p>`;
  } else if (s.status === "in") {
    const when = s.syncing ? "Syncing…" : s.lastSync
      ? `Synced at ${new Date(s.lastSync).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}.` : "Not synced yet.";
    body.innerHTML = `
      <p>Signed in as <strong>${esc(s.email)}</strong>.</p>
      <p class="fine">Your streak, stats and calendar are saved to your account. Sign in on another device with the same email to pick them up there. Each day's climb is still one attempt, across all your devices.</p>
      ${msg}
      <p class="fine" aria-live="polite">${when}</p>
      <div class="account-actions">
        <button class="btn ghost" type="button" id="syncBtn" ${s.syncing ? "disabled" : ""}>Sync now</button>
        <button class="btn ghost" type="button" id="signOutBtn">Sign out</button>
      </div>`;
    $("#syncBtn").addEventListener("click", () => account.sync());
    $("#signOutBtn").addEventListener("click", () => account.signOut());
  } else if (linkSentTo) {
    body.innerHTML = `
      <p>Check your email. We sent a sign-in link to <strong>${esc(linkSentTo)}</strong>.</p>
      <p class="fine">Open it on this device to sign in here. It can take a minute to arrive, and it may land in spam.</p>
      <button class="btn ghost" type="button" id="otherEmailBtn">Use a different email</button>`;
    $("#otherEmailBtn").addEventListener("click", () => { linkSentTo = ""; renderAccount(); });
  } else {
    body.innerHTML = `
      <p>Sign in to keep your streak and stats on every device. It's optional, and there's no password: we email you a link.</p>
      ${msg}
      <form id="signInForm" class="sign-in" novalidate>
        <label for="emailInput">Email</label>
        <div class="try-row">
          <input id="emailInput" class="try-input" type="email" autocomplete="email" inputmode="email" spellcheck="false" required placeholder="you@example.com">
          <button class="btn primary" type="submit" id="sendLinkBtn">Email me a link</button>
        </div>
        <p id="signInMsg" class="form-msg" role="status" aria-live="polite"></p>
      </form>
      <p class="fine">Climbs you've already finished in this browser are added to your account when you sign in.</p>`;
    $("#signInForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("#sendLinkBtn");
      const email = $("#emailInput").value;
      btn.disabled = true;
      btn.textContent = "Sending…";
      const res = await account.sendLink(email);
      btn.disabled = false;
      btn.textContent = "Email me a link";
      if (res.error) {
        $("#signInMsg").textContent = res.error;
        $("#emailInput").focus();
      } else {
        linkSentTo = email.trim();
        renderAccount();
      }
    });
  }
}

function loadToday() {
  n = today;
  if (!TEST && new URLSearchParams(location.search).has("day")) history.replaceState({}, "", location.pathname);
  try {
    puzzle = puzzleFor(n);
  } catch (err) {
    console.error(err);
    setPhase("error");
    stage.innerHTML = `<div class="error-state"><h2>Today's mountain couldn't be loaded</h2>
      <p>Its puzzle data is damaged. Please check back soon.</p></div>`;
    return;
  }
  game = store.getGame(n) || freshGame();
  // A climb whose time ran out while the page was closed ends now, as of its deadline.
  if (game.startedAt && !game.done && nowMs() >= game.deadline) endClimb("timeout", { quiet: true });
  input.value = "";
  formMsg.textContent = "";
  $("#dayLine").innerHTML = `<strong>${esc(puzzle.name)}</strong>, No. ${n}. ${esc(formatKey(keyForNumber(n)))}.`;
  drawMountain(svg);
  drawClimb(false);
  setAltitude(game.metres, false);
  render();
}

/* ---------- daily rollover ---------- */
// At midnight Perth time the new mountain appears by itself. A climb that is
// under way keeps its own timer (at most six minutes) and is saved to the day
// it began. After it ends, the new mountain is one tap away.

let rolloverTimer;
function scheduleRollover() {
  clearTimeout(rolloverTimer);
  rolloverTimer = setTimeout(checkDay, Math.min(msUntilTomorrow() + 1500, 2 ** 31 - 1));
}

async function checkDay() {
  await syncClock();
  const newToday = todayNumber();
  if (newToday !== today) {
    today = newToday;
    const climbing = game && game.startedAt && !game.done;
    if (climbing) showBanner(`A new mountain is ready. Finish this climb first, it still counts for its own day.`);
    else loadToday();
  }
  scheduleRollover();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || phase === "loading") return;
  checkDay();
  if (game?.startedAt && !game.done && nowMs() >= game.deadline) endClimb("timeout");
});

// Another tab saved: reload so the two tabs don't overwrite each other.
window.addEventListener("storage", (e) => {
  if (e.key !== "ascent" || phase === "judging" || phase === "loading") return;
  store.reload();
  loadToday();
});

/* ---------- climb timer ---------- */
// Separate from the countdown to tomorrow's mountain: this one is the six
// minutes you have for today's climb.

let timerInterval;
let lastSpoken = null;
function startTimer() {
  if (timerInterval) return;
  tickTimer();
  timerInterval = setInterval(tickTimer, 250);
}
function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}
function tickTimer() {
  if (!game?.deadline || game.done) return stopTimer();
  const left = rules.secondsLeft(game, nowMs());
  timerEl.querySelector(".timer-num").textContent = rules.formatClock(left);
  timerEl.classList.toggle("low", left <= 60);
  if ((left === 60 || left === 10) && lastSpoken !== left) {
    lastSpoken = left;
    announce(`${left === 60 ? "One minute" : "Ten seconds"} left.`);
  }
  if (left <= 0 && phase !== "judging") endClimb("timeout");
}

/* ---------- altitude and mountain ---------- */

let altFrame;
function setAltitude(metres, animate = true) {
  const numEl = $("#altNum");
  const from = Number(numEl.dataset.value || 0);
  numEl.dataset.value = metres;
  $("#altTier").textContent = rules.tierFor(metres);
  $("#altLeft").textContent = rules.summitReached(metres) ? "Summit reached" : `${fmt(rules.SUMMIT_HEIGHT - metres)} m to the summit`;

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

function climbStops(g, p) {
  let total = 0;
  const stops = [];
  [...g.pitches, g.summit].forEach((s, i) => {
    if (!s.done) return;
    total += s.points;
    const word = i === 4 ? (s.solved ? p.summit.answer : "") : rules.bestGuess(s.guesses)?.word || "";
    stops.push({ metres: total, word, points: s.points });
  });
  return stops;
}

function drawClimb(animate) {
  updateClimb(svg, climbStops(game, puzzle), rules.summitReached(game.metres), animate);
}

/* ---------- rendering ---------- */

function renderTrack() {
  const res = resultsFor(game, puzzle);
  $("#track").innerHTML = [0, 1, 2, 3, 4].map((i) => {
    const s = step(i);
    const active = i === game.current && !game.done && game.startedAt;
    const state = s.done ? res[i] : active ? "active" : "todo";
    const title = rules.THEMES[i];
    const label = s.done ? `${title}, done, ${fmt(s.points)} metres` : active ? `${title}, current pitch` : `${title}, still to come`;
    const mark = s.done ? (res[i] === "none" ? "×" : res[i] === "fit" ? "✓" : "•") : "";
    return `<li class="t-${state}" ${active ? 'aria-current="step"' : ""}>
      <span class="sr">${label}</span>
      <span class="t-dot" aria-hidden="true">${mark}</span>
      <span class="t-name" aria-hidden="true">${SHORT_THEME[i]}</span>
      <span class="t-pts" aria-hidden="true">${s.done ? fmt(s.points) : ""}</span></li>`;
  }).join("");
}

function render() {
  renderTrack();
  if (game.done) {
    setPhase("done");
    stage.innerHTML = resultsHtml(game, puzzle, n, { live: true });
    bindResults();
    return;
  }
  if (!game.startedAt) {
    setPhase("ready");
    renderReady();
    return;
  }
  setPhase("playing");
  renderKeyboard();
  game.current < 4 ? renderPitch(game.current) : renderSummit();
  requestAnimationFrame(() => form.scrollIntoView({ block: "nearest" }));
}

function renderReady() {
  const s = store.summary(today);
  stage.innerHTML = `
    <section class="ready" aria-labelledby="readyTitle">
      <p class="ready-kicker">Today's climb</p>
      <h2 id="readyTitle">${esc(puzzle.name)}</h2>
      <ol class="theme-list">${rules.THEMES.map((t, i) => `<li><span>${i + 1}</span>${t}</li>`).join("")}</ol>
      <p class="ready-rules">Five pitches, ${rules.formatClock(rules.CLIMB_SECONDS)} minutes, one climb a day. Every real word earns height, and rarer words that fit the clues climb highest. The summit is ${fmt(rules.SUMMIT_HEIGHT)} m.</p>
      <button class="btn primary begin" type="button" id="beginBtn">Begin climb</button>
      ${s.streak ? `<p class="ready-streak">You're on a ${s.streak}-day streak.</p>` : ""}
    </section>`;
  $("#beginBtn").addEventListener("click", beginClimb);
}

function beginClimb() {
  if (phase !== "ready" || game.startedAt) return;
  game.startedAt = nowMs();
  game.deadline = game.startedAt + rules.CLIMB_SECONDS * 1000;
  store.recordAttempt(n, game.startedAt);
  save();
  render();
  input.focus({ preventScroll: true });
  announce(`Climb started. ${rules.CLIMB_SECONDS / 60} minutes on the clock. ${rules.THEMES[0]}.`);
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
  const kind = rules.holdKind(g.linked.length, total, g.near);
  const missed = t.clues.filter((c) => !g.linked.includes(c));
  const why = {
    fit: total === 2 ? "Fits between both clues." : "Fits between all three clues.",
    partial: `Holds on ${g.linked.join(" and ")}, but doesn't link ${missed.join(" or ")}.`,
    near: "Doesn't link the clues, but it's close to the best word.",
    foothold: "Doesn't link the clues. A foothold.",
  }[kind];
  const icon = { fit: "✓", partial: "½", near: "~", foothold: "•" }[kind];
  const parts = [];
  if (g.linked.length) parts.push(`${rules.rarityLabel(g.zipf)} ×${rules.rarity(g.zipf).toFixed(2)}`);
  if (tryIndex > 0) parts.push("second try ×0.70");
  return `<div class="guess-card ${kind}">
      <div class="g-top"><span class="g-icon" aria-hidden="true">${icon}</span><span class="g-word">${esc(g.word)}</span>
        <span class="g-pts">+${fmt(g.points)} m</span></div>
      <p class="g-why">${why}${parts.length ? ` <span class="g-rare">${parts.join(", ")}.</span>` : ""}</p>
    </div>`;
}

function pitchHead(i, note) {
  return `<div class="pitch-head">
      <div><p class="theme-name">${rules.THEMES[i]}</p><h2 id="pitchTitle">${i < 4 ? `Pitch ${i + 1} <span>of 5</span>` : "The summit word"}</h2></div>
      <span class="try-note">${note}</span>
    </div>`;
}

function renderPitch(i) {
  const s = game.pitches[i];
  const t = puzzle.pitches[i];
  const tryNo = s.guesses.length;
  const b = rules.bestGuess(s.guesses);
  const prompt = t.clues.length === 2
    ? "Find a word that fits between both clues. Every real word climbs, rare fits climb highest."
    : "Find a word that fits between all three clues. Every real word climbs, rare fits climb highest.";
  const keep = tryNo > 0
    ? `<div class="actions"><button class="btn ghost" type="button" id="keepBtn">Keep ${fmt(b.points)} m and move on</button></div>` : "";
  stage.innerHTML = `
    <section class="pitch" aria-labelledby="pitchTitle">
      ${pitchHead(i, tryNo === 0 ? "Try 1 of 2" : "Try 2 of 2, worth 70%")}
      <p class="prompt">${prompt}</p>
      <ul class="chips" aria-label="Clues">${chipsHtml(t, i)}</ul>
      ${s.guesses.map((g, k) => linkCardHtml(g, t, k)).join("")}
      ${keep}
    </section>`;
  $("#keepBtn")?.addEventListener("click", () => {
    if (phase === "playing") finishStep();
  });
  if (tryNo) stage.scrollTop = stage.scrollHeight;
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
    const close = g.near || g.close >= rules.CLOSE;
    return `<li class="${close ? "close" : ""}">${esc(g.word)}<span>${close ? "close" : "not it"}</span></li>`;
  }).join("");
  stage.innerHTML = `
    <section class="pitch summit" aria-labelledby="pitchTitle">
      ${pitchHead(4, `${left} ${left === 1 ? "try" : "tries"} left, worth ${fmt(rules.SUMMIT_POINTS[s.guesses.length])} m`)}
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
      ? `<p class="outcome good"><span aria-hidden="true">✓ </span>${answer}. Summit word found, ${pts}.</p>`
      : `<p class="outcome bad"><span aria-hidden="true">× </span>The summit word was ${answer}. Your closest guess earned ${pts}.</p>`;
  }
  const b = rules.bestGuess(s.guesses);
  const kind = rules.holdKind(b.linked.length, target(i).clues.length, b.near);
  const lead = `<p class="outcome ${kind === "fit" ? "good" : "ok"}"><span aria-hidden="true">${kind === "fit" ? "✓" : "•"} </span>${pts} with ${esc(b.word)}.</p>`;
  const rope = i < 3 ? `<p class="rope-note"><strong>${answer}</strong> goes up the rope as the next clue.</p>`
    : `<p class="rope-note">The rope word was <strong>${answer}</strong>. Next, the summit word.</p>`;
  return `${lead}${rope}<p class="rarest" id="rarest"></p>`;
}

function renderFeedback(i) {
  const next = i < 4 ? rules.THEMES[i + 1] : "your results";
  stage.innerHTML = `
    <section class="pitch feedback" aria-labelledby="pitchTitle">
      ${pitchHead(i, "Done")}
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

/* ---------- results (today's, or a past day from the calendar) ---------- */

function resultsHtml(g, p, num, { live = false } = {}) {
  const res = resultsFor(g, p);
  const metres = g.metres;
  const reached = rules.summitReached(metres);
  const summary = store.summary(today);
  const pitchesDone = [...g.pitches, g.summit].filter((s) => s.done && s.guesses.length).length;
  const accepted = [...g.pitches, g.summit].reduce((sum, s) => sum + s.guesses.length, 0);
  const time = g.startedAt ? Math.min(rules.CLIMB_SECONDS, Math.round(((g.endedAt || g.deadline) - g.startedAt) / 1000)) : 0;
  const fits = res.slice(0, 4).filter((r) => r === "fit").length;
  const partials = res.slice(0, 4).filter((r) => r === "partial").length;
  const isBest = live && summary.best === metres && summary.completed > 1;
  const quality = `${fits} perfect fit${fits === 1 ? "" : "s"}, ${partials} partial link${partials === 1 ? "" : "s"}${g.summit.solved ? ", summit word found" : ""}.`;

  const rows = [...g.pitches, g.summit].map((s, i) => {
    const answer = (i < 4 ? p.pitches[i] : p.summit).answer;
    let word, how;
    if (!s.done || !s.guesses.length) {
      word = "Not reached";
      how = `time ran out. The ${i < 4 ? "rope word" : "summit word"} was ${answer}`;
    } else if (i === 4) {
      word = g.summit.solved ? answer : s.guesses.at(-1).word;
      how = g.summit.solved ? `found on clue ${s.guesses.length}` : `the word was ${answer}`;
    } else {
      const b = rules.bestGuess(s.guesses);
      word = b.word;
      const kind = rules.holdKind(b.linked.length, p.pitches[i].clues.length, b.near);
      how = { fit: "fits every clue", partial: `links ${b.linked.join(" and ")} only`, near: "close to the best word", foothold: "a foothold" }[kind];
      if (b.linked.length) how += `, ${rules.rarityLabel(b.zipf).toLowerCase()}`;
    }
    return `<li class="${res[i] || "none"}"><span class="r-name">${rules.THEMES[i]}</span><span class="r-word">${esc(word)}</span><span class="r-how">${esc(how)}</span><span class="r-pts">${fmt(s.points)} m</span></li>`;
  }).join("");

  return `
    <section class="result${reached ? " won" : ""}" aria-labelledby="resultTitle">
      <p class="result-kicker">${esc(p.name)}, No. ${num}, ${esc(formatKey(keyForNumber(num)))}</p>
      <h2 class="result-tier" id="resultTitle" tabindex="-1">${reached ? "Summit reached" : `Finished at ${fmt(metres)} m`}</h2>
      <p class="result-sub">${reached ? `${fmt(metres)} m, an exceptional climb.` : `${fmt(rules.SUMMIT_HEIGHT - metres)} m short of the summit. ${rules.tierFor(metres)}.`}
        ${g.endReason === "timeout" ? " Time ran out." : ""}${isBest ? " <strong>New personal best.</strong>" : ""}</p>
      <dl class="figures">
        <div><dt>Pitches</dt><dd>${pitchesDone}/5</dd></div>
        <div><dt>Time</dt><dd>${rules.formatClock(time)}</dd></div>
        <div><dt>Words</dt><dd>${accepted}</dd></div>
        <div><dt>Refused</dt><dd>${g.rejected || 0}</dd></div>
      </dl>
      <p class="quality">${quality}${live && summary.best && !isBest && summary.best > metres ? ` Your best is ${fmt(summary.best)} m.` : ""}</p>
      ${live ? `<p class="streaks">Streak <strong>${summary.streak}</strong>, longest <strong>${summary.longest}</strong>.</p>` : ""}
      <p class="chain" aria-label="The day's rope">
        <span class="seed">${esc(p.pitches[0].clues.join(" + "))}</span>
        ${p.pitches.map((x) => `<span class="arrow" aria-hidden="true">→</span><span class="link">${esc(x.answer)}</span>`).join("")}
        <span class="arrow" aria-hidden="true">→</span><span class="peak">${esc(p.summit.answer)}</span>
      </p>
      <p class="definition"><strong>${esc(p.summit.answer.toLowerCase())}</strong>: ${esc(p.summit.clues.at(-1).toLowerCase())}.</p>
      <ul class="breakdown" aria-label="Your climb, pitch by pitch">${rows}</ul>
      ${live ? `<div class="result-actions">
        <button class="btn primary" type="button" id="shareBtn">Share result</button>
        <button class="btn ghost" type="button" id="statsBtn">Your stats</button>
        <button class="btn ghost" type="button" id="archiveBtn">Calendar</button>
      </div>
      <p class="next">${num === today ? "Today's climb is done." : "That climb is done."} The next mountain appears in <span id="countdown"></span>, at midnight Perth time.</p>
      ${num !== today ? `<button class="btn primary" type="button" id="todayBtn">Go to today's mountain</button>` : ""}` : ""}
    </section>`;
}

function bindResults() {
  $("#shareBtn")?.addEventListener("click", async () => {
    const s = store.summary(today);
    const r = await share(shareText(n, puzzle.name, game, resultsFor(game, puzzle), s.streak));
    if (r === "copied") toast("Result copied. Paste it anywhere.");
    else if (r === "failed") toast("Couldn't copy. Your browser blocked the clipboard.");
  });
  $("#statsBtn")?.addEventListener("click", () => openDialog("stats"));
  $("#archiveBtn")?.addEventListener("click", () => openDialog("archive"));
  $("#todayBtn")?.addEventListener("click", () => { $("#banner").hidden = true; loadToday(); });
  startCountdown();
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
    el.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/* ---------- input ---------- */

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
  b.tabIndex = -1;
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
  if (phase !== "playing") return;
  const submittedAt = nowMs();
  if (submittedAt >= game.deadline) return endClimb("timeout");
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
  if (n !== forDay || game.current !== forStep || phase !== "judging") return;

  if (verdict.error) {
    setPhase("playing");
    showFormMsg(ERROR_TEXT[verdict.error] || ERROR_TEXT.down, "error");
    if (nowMs() >= game.deadline) endClimb("timeout");
    return;
  }
  if (verdict.unknown) {
    game.rejected = (game.rejected || 0) + 1;
    save();
    setPhase("playing");
    showFormMsg(`${word} isn't a word we know. Check the spelling. Your try wasn't used.`);
    if (nowMs() >= game.deadline) endClimb("timeout");
    return;
  }

  // A guess sent before the deadline counts even if judging finished after it.
  input.value = "";
  if (i < 4) {
    const points = rules.guessPoints({ linked: verdict.linked.length, total: t.clues.length, tryIndex: s.guesses.length, zipf: verdict.zipf, near: verdict.near });
    s.guesses.push({ word, linked: verdict.linked, zipf: verdict.zipf, near: Boolean(verdict.near), points });
    s.points = rules.bestGuess(s.guesses).points;
    const kind = rules.holdKind(verdict.linked.length, t.clues.length, verdict.near);
    announce(`${word}: ${{ fit: "fits", partial: `links ${verdict.linked.join(" and ")}`, near: "close to the best word", foothold: "a foothold" }[kind]}. Plus ${points} metres.`);
    if (kind === "fit" || s.guesses.length >= rules.PITCH_TRIES) return finishStep();
    save();
    if (nowMs() >= game.deadline) return endClimb("timeout");
    setPhase("playing");
    renderPitch(i);
    input.focus({ preventScroll: true });
    return;
  }

  s.guesses.push({ word, exact: verdict.exact, near: Boolean(verdict.near), close: verdict.close || 0 });
  if (verdict.exact) {
    s.solved = true;
    return finishStep();
  }
  if (s.guesses.length >= rules.SUMMIT_TRIES) return finishStep();
  save();
  if (nowMs() >= game.deadline) return endClimb("timeout");
  announce(`${word} isn't it.${verdict.near ? " Close, though." : ""} A clearer clue is showing.`);
  setPhase("playing");
  renderSummit();
  input.focus({ preventScroll: true });
}

function scoreStep(i) {
  const s = step(i);
  if (i < 4) s.points = rules.bestGuess(s.guesses)?.points || 0;
  else s.points = rules.summitPoints(s.solved, s.guesses.length, s.guesses.filter((g) => !g.exact));
}

// Ends the current pitch exactly once and saves in one write.
function finishStep() {
  if (phase !== "playing" && phase !== "judging") return;
  const i = game.current;
  const s = step(i);
  if (s.done || game.done) return;
  s.done = true;
  scoreStep(i);
  game.current = i + 1;
  if (game.current > 4) return endClimb("finished", { fromStep: i });
  save();
  setPhase("feedback");
  renderTrack();
  renderFeedback(i);
  drawClimb(true);
  setAltitude(game.metres);
  announce(`${rules.THEMES[i]} done. ${game.metres} metres. Next, ${rules.THEMES[i + 1]}.`);
}

// Ends the day's climb: all five pitches done, or the timer ran out.
// A pitch in progress keeps its best try. Writes the day's result once.
function endClimb(reason, { fromStep = null, quiet = false } = {}) {
  if (game.done) return;
  if (reason === "timeout") {
    const i = game.current;
    if (i <= 4 && step(i).guesses.length && !step(i).done) {
      step(i).done = true;
      scoreStep(i);
      game.current = i + 1;
    }
  }
  game.done = true;
  game.endReason = reason;
  game.endedAt = reason === "timeout" ? game.deadline : Math.min(nowMs(), game.deadline);
  save();
  const res = resultsFor(game, puzzle);
  store.recordResult(n, {
    metres: game.metres,
    summitWord: game.summit.solved,
    pitches: [...game.pitches, game.summit].filter((s) => s.done && s.guesses.length).length,
    time: Math.round((game.endedAt - game.startedAt) / 1000),
    accepted: [...game.pitches, game.summit].reduce((sum, s) => sum + s.guesses.length, 0),
    rejected: game.rejected || 0,
    fits: res.slice(0, 4).filter((r) => r === "fit").length,
    partials: res.slice(0, 4).filter((r) => r === "partial").length,
    endReason: reason,
  });
  stopTimer();
  if (quiet) return;
  renderTrack();
  drawClimb(true);
  setAltitude(game.metres);
  if (fromStep !== null) {
    setPhase("feedback");
    timerEl.hidden = true;
    renderFeedback(fromStep);
  } else {
    toast("Time's up. Your climb is saved.");
    render();
    $("#resultTitle")?.focus({ preventScroll: true });
  }
  announce(rules.summitReached(game.metres) ? "Summit reached." : `Climb over at ${game.metres} metres.`);
}

/* ---------- dialogs ---------- */

function openDialog(id) {
  if (id === "stats") renderStats();
  if (id === "account") renderAccount();
  if (id === "archive") renderArchive();
  const d = $("#" + id);
  if (!d.open) d.showModal();
}

document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openDialog(b.dataset.open)));
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => {
    const closing = e.target === d || e.target.closest("[data-close], .close");
    // Save "seen the rules" right away, not after the close animation,
    // so an instant refresh can't show the rules again.
    if (closing && d.id === "help") store.markHelpSeen();
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
  if (v.unknown) return (out.textContent = `${parsed.word} isn't a word we know. Check the spelling.`);
  const pts = rules.guessPoints({ linked: v.linked.length, total: 2, zipf: v.zipf, near: v.near });
  const kind = rules.holdKind(v.linked.length, 2, v.near);
  out.textContent = {
    fit: `${parsed.word} fits both. ${rules.rarityLabel(v.zipf)}, so it earns ${fmt(pts)} m.`,
    partial: `${parsed.word} only links ${v.linked[0]}: ${fmt(pts)} m.`,
    near: `${parsed.word} is close to the best word: ${fmt(pts)} m.`,
    foothold: `${parsed.word} doesn't link either clue, but it's a real word: ${fmt(pts)} m. Try LIGHT, or a rarer one like STONE.`,
  }[kind];
});

function renderStats() {
  const s = store.summary(today);
  const recent = s.recent.map((r) => `<li><span>No. ${r.n}</span><span>${esc(formatKey(keyForNumber(r.n)))}</span><strong>${fmt(r.metres)} m${r.summit ? " ★" : ""}</strong></li>`).join("");
  $("#statsBody").innerHTML = `
    <dl class="figures">
      <div><dt>Streak</dt><dd>${s.streak}</dd></div>
      <div><dt>Longest</dt><dd>${s.longest}</dd></div>
      <div><dt>Summits</dt><dd>${s.summits}</dd></div>
      <div><dt>Best (m)</dt><dd>${fmt(s.best)}</dd></div>
    </dl>
    <p class="fine">${s.completed} climb${s.completed === 1 ? "" : "s"} finished of ${s.attempted} begun. Average ${fmt(s.average)} m${s.avgPitches != null ? `, ${s.avgPitches.toFixed(1)} pitches a climb` : ""}.</p>
    ${recent ? `<h3>Recent climbs</h3><ul class="recent">${recent}</ul>` : "<p>Finish today's climb to start your record.</p>"}
    <p class="fine">A day counts toward your streak when its climb is finished that day, Perth time. Missing a day resets it. ${account.signedIn() ? "Stats are saved to your account." : `Stats are saved in this browser only. <button class="link-btn" type="button" id="statsSignIn">Sign in</button> to keep them on every device.`}</p>
    <button class="btn ghost" type="button" id="calBtn">Open the calendar</button>`;
  $("#calBtn").addEventListener("click", () => { $("#stats").close(); openDialog("archive"); });
  $("#statsSignIn")?.addEventListener("click", () => { $("#stats").close(); openDialog("account"); });
}

/* ---------- calendar (read-only history) ---------- */

let calMonth = null; // "YYYY-MM"
function renderArchive(detail = null) {
  const todayKey = keyForNumber(today);
  calMonth ||= todayKey.slice(0, 7);
  const [y, m] = calMonth.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push(`<li class="cal-pad"></li>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${calMonth}-${String(d).padStart(2, "0")}`;
    const num = Math.round((Date.parse(key) - Date.parse(keyForNumber(1))) / 86400000) + 1;
    if (num < 1 || num > today) {
      cells.push(`<li class="cal-off"><span>${d}</span></li>`);
      continue;
    }
    const status = store.dayStatus(num, today);
    const label = { summit: "summit", done: "finished", climbing: "in progress", today: "not started", unfinished: "begun, not finished", missed: "missed" }[status];
    cells.push(`<li><button type="button" class="cal-day c-${status}${detail === num ? " sel" : ""}" data-day="${num}" aria-label="${d} ${first.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" })}, ${label}">
      <span>${d}</span>${status === "summit" ? "<i aria-hidden=\"true\">★</i>" : ""}</button></li>`);
  }
  const prevOk = calMonth > keyForNumber(1).slice(0, 7);
  const nextOk = calMonth < todayKey.slice(0, 7);
  $("#archiveBody").innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" type="button" id="calPrev" aria-label="Previous month" ${prevOk ? "" : "disabled"}>‹</button>
      <strong>${first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
      <button class="icon-btn" type="button" id="calNext" aria-label="Next month" ${nextOk ? "" : "disabled"}>›</button>
    </div>
    <ol class="cal-week" aria-hidden="true">${["M", "T", "W", "T", "F", "S", "S"].map((x) => `<li>${x}</li>`).join("")}</ol>
    <ol class="cal">${cells.join("")}</ol>
    <p class="cal-key"><span class="k k-done"></span>Finished <span class="k k-summit"></span>Summit <span class="k k-missed"></span>Missed</p>
    <div id="calDetail" class="cal-detail">${detail ? archiveDetail(detail) : `<p class="fine">Pick a day to see how that climb went. Past days can be looked at, not replayed.</p>`}</div>`;
  $("#calPrev").addEventListener("click", () => { calMonth = shiftMonth(calMonth, -1); renderArchive(); });
  $("#calNext").addEventListener("click", () => { calMonth = shiftMonth(calMonth, 1); renderArchive(); });
  $("#archiveBody").querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
    const d = Number(b.dataset.day);
    if (d === today) {
      $("#archive").close();
      return;
    }
    renderArchive(d);
    $("#calDetail").scrollIntoView({ block: "nearest" });
  }));
  $("#revealBtn")?.addEventListener("click", () => {
    $("#reveal").hidden = false;
    $("#revealBtn").hidden = true;
  });
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function archiveDetail(num) {
  let p;
  try { p = puzzleFor(num); } catch { return `<p>That day's puzzle couldn't be loaded.</p>`; }
  const g = store.getGame(num);
  if (g?.done) return resultsHtml(g, p, num);
  const status = store.dayStatus(num, today);
  return `<h3>${esc(p.name)}, No. ${num}</h3>
    <p>${status === "unfinished" ? "You began this climb but didn't finish it on the day." : "You missed this climb."} Past days can't be played, so your record stays fair.</p>
    <button class="btn ghost" type="button" id="revealBtn">Show the answers</button>
    <div id="reveal" hidden>
      <p class="chain"><span class="seed">${esc(p.pitches[0].clues.join(" + "))}</span>
        ${p.pitches.map((x) => `<span class="arrow" aria-hidden="true">→</span><span class="link">${esc(x.answer)}</span>`).join("")}
        <span class="arrow" aria-hidden="true">→</span><span class="peak">${esc(p.summit.answer)}</span></p>
      <p class="definition"><strong>${esc(p.summit.answer.toLowerCase())}</strong>: ${esc(p.summit.clues.at(-1).toLowerCase())}.</p>
    </div>`;
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
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function showBanner(html) {
  const b = $("#banner");
  b.innerHTML = `<span>${html}</span><button class="banner-x" type="button" aria-label="Dismiss">×</button>`;
  b.hidden = false;
  b.querySelector(".banner-x").addEventListener("click", () => (b.hidden = true));
}

matchMedia("(min-width: 900px)").addEventListener("change", () => {
  if (!game) return;
  drawMountain(svg);
  drawClimb(false);
});

judgeReady().catch(() => {});
start();
