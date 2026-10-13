// Ascent: one climb a day.
//
// The day moves through three screens:
//   ready    today's mountain, waiting for "Begin climb"
//   climb    the timed attempt: five themed pitches
//   results  the finished climb, shown for the rest of the day
// and inside the climb the game is always in exactly one phase:
//   playing   waiting for a word (the only phase that accepts input)
//   judging   a guess is being checked; input is locked so it can't be sent twice
//   feedback  a pitch just finished; its result shows briefly, then the next
//             pitch starts by itself (or straight away with the button)
// Every change goes through setPhase(). A guess is stored only after it has
// been judged, in one save, so refreshing mid-check can't score it twice.
//
// Timing: each pitch has rules.PITCH_SECONDS. Its start time is saved before
// its clues are shown, and its deadline is always start + PITCH_SECONDS
// (never a stored deadline), so refreshing, switching tabs or changing the
// device clock can't add time. Only one pitch clock exists at a time. No
// clock runs during the short transition between pitches, and the next
// pitch doesn't start while the page is hidden, because its clues can't be
// seen. A pitch that runs out keeps its best try (or 0 m) and the climb
// moves on to the next pitch.
import * as rules from "./rules.js";
import { syncClock, travelTo, now, todayNumber, puzzleFor, msUntilTomorrow, keyForNumber, formatKey } from "./daily.js";
import { drawMountain, updateClimb } from "./climb.js";
import * as store from "./stats.js";
import { shareText, share } from "./share.js";
import * as account from "./account.js";
import { judgeLink, judgeSummit, rarestLinks, ready as judgeReady, ERROR_TEXT } from "./judge.js";
import * as fx from "./fx.js";

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
  startedAt: null, pitchStarts: [null, null, null, null, null], endedAt: null, endReason: null, rejected: 0,
});
const step = (i = game.current) => (i < 4 ? game.pitches[i] : game.summit);
const target = (i = game.current) => (i < 4 ? puzzle.pitches[i] : puzzle.summit);
const fmt = (m) => m.toLocaleString("en-AU");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// The game's clock. It follows server-corrected time (daily.now) but never
// runs backwards during a visit, so setting the device clock back mid-pitch
// can't add time. Forward jumps (a phone waking up) are taken as they come.
let mono = null;
function nowMs() {
  const wall = now().getTime();
  const perf = performance.now();
  if (!mono || wall >= mono.wall + (perf - mono.perf)) mono = { wall, perf };
  return Math.max(wall, mono.wall + (perf - mono.perf));
}
const deadline = () => rules.pitchDeadline(game);
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
  if (phase !== "feedback") clearTimeout(transitionTimer);
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
  stage.innerHTML = `<p class="loading" role="status">Finding today's mountain…</p>`;
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
  // A pitch whose time ran out while the page was closed ends as of its deadline.
  expirePitch({ quiet: true });
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
// under way keeps its own pitch timers and is saved to the day
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

// Coming back to the page (another tab, a locked phone): a pitch whose time
// ran out while away ends now, and a pitch waiting to start starts now.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || phase === "loading") return;
  checkDay();
  expirePitch();
  // Show the result they missed for a moment, then start (no clock runs meanwhile).
  if (phase === "feedback" && !game.done) scheduleNextPitch(rules.TRANSITION_MS);
});

// Another tab saved: reload so the two tabs don't overwrite each other.
window.addEventListener("storage", (e) => {
  if (e.key !== "ascent" || phase === "judging" || phase === "loading") return;
  store.reload();
  loadToday();
});

/* ---------- pitch timer ---------- */
// Separate from the countdown to tomorrow's mountain: this one is the
// PITCH_SECONDS you have for the current pitch. One interval, one clock.

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
  if (!game?.startedAt || game.done) return stopTimer();
  const running = deadline() !== null;
  const left = rules.secondsLeft(game, nowMs());
  timerEl.querySelector(".timer-num").textContent = rules.formatClock(left);
  timerEl.classList.toggle("paused", !running);
  timerEl.classList.toggle("low", running && left <= 5);
  // The bar drains continuously; the number counts whole seconds.
  const share = running ? Math.max(0, Math.min(1, (deadline() - nowMs()) / (rules.PITCH_SECONDS * 1000))) : 1;
  timerEl.style.setProperty("--left", share.toFixed(3));
  const key = `${game.current}:${left}`;
  if (running && (left === 10 || left === 5) && lastSpoken !== key) {
    lastSpoken = key;
    announce(`${left} seconds left.`);
  }
  if (running && left <= 0 && phase === "playing") expirePitch();
}

/* ---------- moving between pitches ---------- */

let transitionTimer;
function scheduleNextPitch(delay = rules.TRANSITION_MS) {
  clearTimeout(transitionTimer);
  transitionTimer = setTimeout(startPitch, delay);
}

// Starts the current pitch's clock and shows its clues. Its start is saved
// first, so a refresh from here on can never give it a fresh 20 seconds.
function startPitch() {
  clearTimeout(transitionTimer);
  if (!game || game.done || phase !== "feedback") return;
  if (document.visibilityState === "hidden") return; // starts when the page is seen again
  const i = game.current;
  if (!Number.isFinite(game.pitchStarts[i])) {
    game.pitchStarts[i] = nowMs();
    save();
  }
  render();
  // Skipping the result early must never leave the height behind the score.
  if (Number($("#altNum").dataset.value || 0) !== game.metres) {
    drawClimb(true);
    setAltitude(game.metres);
  }
  input.focus({ preventScroll: true });
  announce(`${rules.THEMES[i]}. ${rules.PITCH_SECONDS} seconds.`);
}

// The current pitch's time is up: it keeps its best try and the climb moves on.
// A guess sent in time is still judged first (phase "judging" waits for it).
function expirePitch({ quiet = false } = {}) {
  if (!game?.startedAt || game.done || phase === "judging") return false;
  const d = deadline();
  if (d === null || !rules.pitchExpired(game, nowMs())) return false;
  const i = game.current;
  closeStep(d, true);
  if (quiet) return true;
  input.value = "";
  formMsg.textContent = "";
  afterStep(i, true);
  return true;
}

/* ---------- altitude and mountain ---------- */

function setAltitude(metres, animate = true) {
  const numEl = $("#altNum");
  const from = Number(numEl.dataset.value || 0);
  numEl.dataset.value = metres;
  fx.setMeter($("#altMeter"), metres, rules.MAX_TOTAL);
  $(".altitude").classList.toggle("gained", animate && metres > from && !fx.reduced());
  $("#altTier").textContent = rules.tierFor(metres);
  $("#altLeft").textContent = rules.summitReached(metres) ? "Summit reached" : `${fmt(rules.SUMMIT_HEIGHT - metres)} m to the summit`;

  fx.countUp(numEl, metres, { from, ms: animate ? fx.FX.climb : 0, format: fmt });
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
  // During the climb, the zone of the pitch you're on; afterwards, the zone your height reached.
  fx.setZone(game.done ? rules.THEMES.indexOf(rules.tierFor(game.metres)) : game.current);
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
  // Between pitches (for example after a refresh during the transition):
  // show the last result, then start the next pitch.
  if (!Number.isFinite(game.pitchStarts[game.current])) {
    setPhase("feedback");
    if (game.current > 0) renderFeedback(game.current - 1, step(game.current - 1).timedOut);
    scheduleNextPitch(game.current > 0 ? rules.TRANSITION_MS : 0);
    return;
  }
  setPhase("playing");
  renderKeyboard();
  game.current < 4 ? renderPitch(game.current) : renderSummit();
  stage.firstElementChild?.classList.add("enter");
  requestAnimationFrame(() => form.scrollIntoView({ block: "nearest" }));
}

// The main menu: today's mountain, one action, and your record.
function renderReady() {
  const s = store.summary(today);
  stage.innerHTML = `
    <section class="ready" aria-labelledby="readyTitle">
      <p class="ready-kicker">Today's climb, No. ${n}, ${esc(formatKey(keyForNumber(n)))}</p>
      <h2 id="readyTitle">${esc(puzzle.name)}</h2>
      <p class="ready-rules">Five pitches, ${rules.PITCH_SECONDS} seconds each. Find one word that links the clues: a synonym, an opposite, a phrase or a compound all count, and rarer links climb higher. The summit is at ${fmt(rules.SUMMIT_HEIGHT)} m.</p>
      <button class="btn primary begin" type="button" id="beginBtn">Start climb</button>
      <dl class="register">
        <div><dt>Streak</dt><dd>${s.streak}<small> day${s.streak === 1 ? "" : "s"}</small></dd></div>
        <div><dt>Personal best</dt><dd>${s.best ? `${fmt(s.best)}<small> m</small>` : "<small>No climbs yet</small>"}</dd></div>
        <div><dt>Next mountain</dt><dd><span id="countdown">--:--:--</span></dd></div>
      </dl>
    </section>`;
  $("#beginBtn").addEventListener("click", beginClimb);
  startCountdown();
}

function beginClimb() {
  if (phase !== "ready" || game.startedAt) return;
  game.startedAt = nowMs();
  game.pitchStarts = [game.startedAt, null, null, null, null];
  store.recordAttempt(n, game.startedAt);
  save();
  render();
  input.focus({ preventScroll: true });
  announce(`Climb started. ${rules.THEMES[0]}, ${rules.PITCH_SECONDS} seconds.`);
}

function chipsHtml(t, i) {
  return t.clues.map((c, k) => {
    const carried = k === 0 && t.carried;
    return `<li class="chip${carried ? " carried" : ""}">${
      carried ? `<span class="rope-tag" aria-hidden="true"></span><span class="sr">Carried up from pitch ${i}: </span>` : ""
    }${esc(c)}</li>`;
  }).join('<li class="plus" aria-hidden="true">+</li>');
}

// The newest card settles into its result, then its height counts up.
function revealCard(card) {
  if (!card) return;
  const pts = card.querySelector(".g-pts");
  fx.countUp(pts, Number(pts.dataset.points), { delay: fx.FX.countDelay, format: (v) => `+${fmt(v)} m` });
}

// Shown the moment a word is sent, until the judge answers.
function showPending(word) {
  stage.querySelector("#pendingCard")?.remove();
  const card = document.createElement("div");
  card.className = "guess-card pending";
  card.id = "pendingCard";
  card.setAttribute("aria-hidden", "true");
  card.innerHTML = `<div class="g-top"><span class="g-icon">…</span><span class="g-word">${esc(word)}</span><span class="g-pts">checking</span></div>`;
  const section = stage.querySelector(".pitch");
  (section?.querySelector(".actions") ? section.insertBefore(card, section.querySelector(".actions")) : section?.appendChild(card));
  card.scrollIntoView?.({ block: "nearest" });
}
const clearPending = () => stage.querySelector("#pendingCard")?.remove();

function linkCardHtml(g, t, tryIndex, reveal = false) {
  const total = t.clues.length;
  const kind = rules.holdKind(g.linked.length, total, g.near);
  const missed = t.clues.filter((c) => !g.linked.includes(c));
  const how = (c) => g.types?.[c] ? `${esc(c)} (${rules.linkLabel(g.types[c])})` : esc(c);
  const why = {
    fit: `Links ${g.linked.map(how).join(", ")}.`,
    partial: `Holds on ${g.linked.map(how).join(" and ")}, but doesn't link ${missed.join(" or ")}.`,
    near: "Doesn't link the clues, but it's close to the best word.",
    foothold: "Doesn't link the clues. A foothold.",
  }[kind];
  const icon = { fit: "✓", partial: "½", near: "~", foothold: "•" }[kind];
  const parts = [];
  if (g.linked.length && Number.isFinite(g.strength) && g.strength < g.linked.length / total) {
    parts.push(`looser link ×${(g.strength * total / g.linked.length).toFixed(2)}`);
  }
  if (g.linked.length) parts.push(`${rules.rarityLabel(g.zipf)} ×${rules.rarity(g.zipf).toFixed(2)}`);
  if (tryIndex > 0) parts.push("second try ×0.70");
  return `<div class="guess-card ${kind}${reveal ? " reveal" : ""}">
      <div class="g-top"><span class="g-icon" aria-hidden="true">${icon}</span><span class="g-word">${esc(g.word)}</span>
        <span class="g-pts" data-points="${g.points}">+${fmt(g.points)} m</span></div>
      <p class="g-why">${why}${parts.length ? ` <span class="g-rare">${parts.join(", ")}.</span>` : ""}</p>
    </div>`;
}

function pitchHead(i, note) {
  return `<div class="pitch-head">
      <div><p class="theme-name">${rules.THEMES[i]}</p><h2 id="pitchTitle">${i < 4 ? `Pitch ${i + 1} <span>of 5</span>` : "The summit word"}</h2></div>
      <span class="try-note">${note}</span>
    </div>`;
}

function renderPitch(i, { reveal = false } = {}) {
  fx.cancelAll();
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
      ${s.guesses.map((g, k) => linkCardHtml(g, t, k, reveal && k === tryNo - 1)).join("")}
      ${keep}
    </section>`;
  if (reveal) revealCard(stage.querySelector(".guess-card.reveal"));
  $("#keepBtn")?.addEventListener("click", () => {
    if (phase === "playing") finishStep();
  });
  if (tryNo) stage.scrollTop = stage.scrollHeight;
}

function renderSummit({ reveal = false } = {}) {
  fx.cancelAll();
  const s = game.summit;
  const t = puzzle.summit;
  const shown = Math.min(t.clues.length, s.guesses.length + 1);
  const left = rules.SUMMIT_TRIES - s.guesses.length;
  const clues = t.clues.map((c, k) => (k < shown
    ? `<li class="def${reveal && k === shown - 1 && k > 0 ? " reveal" : ""}">${esc(c)}</li>`
    : `<li class="def locked">A clearer clue after each miss</li>`)).join("");
  const missList = s.guesses.filter((g) => !g.exact);
  const misses = missList.map((g, k) => {
    const close = g.near || g.close >= rules.CLOSE;
    const fresh = reveal && k === missList.length - 1;
    return `<li class="${close ? "close" : ""}${fresh ? " reveal" : ""}">${esc(g.word)}<span>${close ? "close" : "not it"}</span></li>`;
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
  if (!s.guesses.length) {
    const rope = i < 4 ? `<p class="rope-note"><strong>${answer}</strong> ${i < 3 ? "goes up the rope as the next clue" : "was the rope word"}.</p>` : "";
    return `<p class="outcome bad"><span aria-hidden="true">× </span>Time ran out before a word. +0 m.${i === 4 ? ` The summit word was ${answer}.` : ""}</p>${rope}`;
  }
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

function renderFeedback(i, timedOut = false, { reveal = false } = {}) {
  fx.cancelAll();
  const last = i >= 4;
  const next = last ? "your results" : rules.THEMES[i + 1];
  stage.innerHTML = `
    <section class="pitch feedback" aria-labelledby="pitchTitle">
      ${pitchHead(i, timedOut ? "Out of time" : "Done")}
      ${i < 4 ? `<ul class="chips" aria-label="Clues">${chipsHtml(target(i), i)}</ul>` : ""}
      ${i < 4 ? step(i).guesses.map((g, k) => linkCardHtml(g, target(i), k, reveal && k === step(i).guesses.length - 1)).join("") : ""}
      <div class="outcome-wrap${reveal ? " reveal-late" : ""}">${outcomeHtml(i)}</div>
      ${last ? "" : `<p class="next-note">${esc(next)} starts in a moment, with a fresh ${rules.PITCH_SECONDS} seconds.</p>`}
      <div class="actions"><button class="btn primary" type="button" id="nextBtn">${last ? `On to ${next}` : `Start ${esc(next)} now`}</button></div>
    </section>`;
  if (reveal) revealCard(stage.querySelector(".guess-card.reveal"));
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
  if (!game.done) return startPitch();
  fx.cancelAll();
  drawClimb(false);
  setAltitude(game.metres, false);
  render();
  $("#resultTitle")?.focus({ preventScroll: true });
}

/* ---------- results (today's, or a past day from the calendar) ---------- */

function resultsHtml(g, p, num, { live = false } = {}) {
  const res = resultsFor(g, p);
  const metres = g.metres;
  const reached = rules.summitReached(metres);
  const summary = store.summary(today);
  const pitchesDone = [...g.pitches, g.summit].filter((s) => s.done && s.guesses.length).length;
  const accepted = [...g.pitches, g.summit].reduce((sum, s) => sum + s.guesses.length, 0);
  const time = rules.climbSeconds(g);
  const outOfTime = [...g.pitches, g.summit].filter((s) => s.timedOut).length;
  const fits = res.slice(0, 4).filter((r) => r === "fit").length;
  const partials = res.slice(0, 4).filter((r) => r === "partial").length;
  const isBest = live && summary.best === metres && summary.completed > 1;
  const quality = `${fits} perfect fit${fits === 1 ? "" : "s"}, ${partials} partial link${partials === 1 ? "" : "s"}${g.summit.solved ? ", summit word found" : ""}.`;

  const rows = [...g.pitches, g.summit].map((s, i) => {
    const answer = (i < 4 ? p.pitches[i] : p.summit).answer;
    let word, how;
    if (!s.done || !s.guesses.length) {
      word = s.done ? "No word" : "Not reached";
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
    if (s.timedOut && s.guesses.length) how += ", then time ran out";
    return `<li class="${res[i] || "none"}"><span class="r-name">${rules.THEMES[i]}</span><span class="r-word">${esc(word)}</span><span class="r-how">${esc(how)}</span><span class="r-pts">${fmt(s.points)} m</span></li>`;
  }).join("");

  return `
    <section class="result${reached ? " won" : ""}" aria-labelledby="resultTitle">
      <p class="result-kicker">${esc(p.name)}, No. ${num}, ${esc(formatKey(keyForNumber(num)))}</p>
      <div class="result-meter" aria-hidden="true" style="--pct: ${Math.min(100, (metres / rules.MAX_TOTAL) * 100)}%"><span class="fill"></span><span class="goal"></span></div>
      <h2 class="result-tier" id="resultTitle" tabindex="-1">${reached ? "Summit reached" : `Finished at ${fmt(metres)} m`}</h2>
      <p class="result-sub">${reached ? `${fmt(metres)} m, an exceptional climb.` : `${fmt(rules.SUMMIT_HEIGHT - metres)} m short of the summit. ${rules.tierFor(metres)}.`}
        ${g.endReason === "timeout" ? " Time ran out." : outOfTime ? ` Time ran out on ${outOfTime} pitch${outOfTime === 1 ? "" : "es"}.` : ""}${isBest ? " <strong>New personal best.</strong>" : ""}</p>
      <dl class="figures register">
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
  if (deadline() === null || rules.pitchExpired(game, submittedAt)) return expirePitch();
  const parsed = rules.normaliseGuess(input.value);
  if (parsed.error) return showFormMsg(parsed.error);
  const word = parsed.word;
  const i = game.current;
  const s = step();
  const t = target();
  if (s.guesses.some((g) => g.word === word)) return showFormMsg(`You've already tried ${word} here.`);
  if (i < 4 && t.clues.includes(word)) return showFormMsg("That's one of the clues. Find a word that links them.");

  const forDay = n;
  const forStep = i;
  setPhase("judging");
  showPending(word);
  const verdict = i < 4 ? await judgeLink(word, t.clues, t.answer) : await judgeSummit(word, t.answer, t.clues.at(-1));
  if (n !== forDay || game.current !== forStep || phase !== "judging") return;

  clearPending();
  // A refused or unjudged word never stops the clock and never adds time.
  if (verdict.error || verdict.unknown) {
    if (verdict.unknown) {
      game.rejected = (game.rejected || 0) + 1;
      save();
    }
    setPhase("playing");
    if (expirePitch()) return;
    showFormMsg(verdict.error
      ? ERROR_TEXT[verdict.error] || ERROR_TEXT.down
      : `${word} isn't a word we know. Check the spelling. Your try wasn't used.`, verdict.error ? "error" : "warn");
    return;
  }

  // A guess sent before the deadline counts even if judging finished after it.
  input.value = "";
  if (i < 4) {
    const points = rules.guessPoints({ linked: verdict.linked.length, total: t.clues.length, tryIndex: s.guesses.length, zipf: verdict.zipf, near: verdict.near, strength: verdict.strength });
    const guess = { word, linked: verdict.linked, types: verdict.types, strength: verdict.strength, near: Boolean(verdict.near), points };
    if (Number.isFinite(verdict.zipf)) guess.zipf = verdict.zipf;
    s.guesses.push(guess);
    s.points = rules.bestGuess(s.guesses).points;
    const kind = rules.holdKind(verdict.linked.length, t.clues.length, verdict.near);
    announce(`${word}: ${{ fit: "fits", partial: `links ${verdict.linked.join(" and ")}`, near: "close to the best word", foothold: "a foothold" }[kind]}. Plus ${points} metres.`);
    if (kind === "fit" || s.guesses.length >= rules.PITCH_TRIES) return finishStep(submittedAt);
    save();
    setPhase("playing");
    if (expirePitch()) return;
    renderPitch(i, { reveal: true });
    setAltitude(game.metres);
    input.focus({ preventScroll: true });
    return;
  }

  s.guesses.push({ word, exact: verdict.exact, near: Boolean(verdict.near), close: verdict.close || 0 });
  if (verdict.exact) {
    s.solved = true;
    return finishStep(submittedAt);
  }
  if (s.guesses.length >= rules.SUMMIT_TRIES) return finishStep(submittedAt);
  save();
  setPhase("playing");
  if (expirePitch()) return;
  announce(`${word} isn't it.${verdict.near ? " Close, though." : ""} A clearer clue is showing.`);
  renderSummit({ reveal: true });
  input.focus({ preventScroll: true });
}

function scoreStep(i) {
  const s = step(i);
  if (i < 4) s.points = rules.bestGuess(s.guesses)?.points || 0;
  else s.points = rules.summitPoints(s.solved, s.guesses.length, s.guesses.filter((g) => !g.exact));
}

// Ends the current step exactly once, as of time `at`, and saves in one write.
// After the summit, the climb is finished.
function closeStep(at, timedOut) {
  const i = game.current;
  const s = step(i);
  if (s.done || game.done) return false;
  s.done = true;
  s.endedAt = at;
  if (timedOut) s.timedOut = true;
  scoreStep(i);
  game.current = i + 1;
  if (game.current > 4) finishClimb(at);
  else save();
  return true;
}

// The player finished the pitch: a fit, out of tries, or "keep and move on".
function finishStep(at = nowMs()) {
  if (phase !== "playing" && phase !== "judging") return;
  const i = game.current;
  const d = deadline();
  if (!closeStep(d === null ? at : Math.min(at, d), false)) return;
  afterStep(i, false);
}

// Shows a finished step's result. The next pitch starts after the transition.
function afterStep(i, timedOut) {
  renderTrack();
  const climb = () => { drawClimb(true); setAltitude(game.metres); };
  if (game.done) {
    setPhase("feedback");
    timerEl.hidden = true;
    renderFeedback(i, timedOut, { reveal: true });
    fx.later(climb, fx.FX.climbDelay);
    announce(rules.summitReached(game.metres) ? "Summit reached." : `Climb over at ${game.metres} metres.`);
    return;
  }
  setPhase("feedback");
  renderFeedback(i, timedOut, { reveal: true });
  fx.later(climb, fx.FX.climbDelay);
  scheduleNextPitch();
  announce(`${rules.THEMES[i]} ${timedOut ? "out of time" : "done"}. ${game.metres} metres. Next, ${rules.THEMES[i + 1]}.`);
}

// All five steps are done: write the day's result once.
function finishClimb(at) {
  if (game.done) return;
  game.done = true;
  game.endReason = "finished";
  game.endedAt = at;
  save();
  const res = resultsFor(game, puzzle);
  store.recordResult(n, {
    metres: game.metres,
    summitWord: game.summit.solved,
    pitches: [...game.pitches, game.summit].filter((s) => s.done && s.guesses.length).length,
    time: rules.climbSeconds(game),
    accepted: [...game.pitches, game.summit].reduce((sum, s) => sum + s.guesses.length, 0),
    rejected: game.rejected || 0,
    fits: res.slice(0, 4).filter((r) => r === "fit").length,
    partials: res.slice(0, 4).filter((r) => r === "partial").length,
    endReason: "finished",
  });
  stopTimer();
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
  const pts = rules.guessPoints({ linked: v.linked.length, total: 2, zipf: v.zipf, near: v.near, strength: v.strength });
  const kind = rules.holdKind(v.linked.length, 2, v.near);
  const how = v.linked.map((c) => `${c} (${rules.linkLabel(v.types[c])})`).join(" and ");
  out.textContent = {
    fit: `${parsed.word} links ${how}. ${rules.rarityLabel(v.zipf)}, so it earns ${fmt(pts)} m.`,
    partial: `${parsed.word} only links ${how}: ${fmt(pts)} m.`,
    near: `${parsed.word} is close to the best word: ${fmt(pts)} m.`,
    foothold: `${parsed.word} doesn't link either clue, but it's a real word: ${fmt(pts)} m. Try LIGHT, or a rarer one like STONE.`,
  }[kind];
});

function renderStats() {
  const s = store.summary(today);
  const recent = s.recent.map((r) => `<li><span>No. ${r.n}</span><span>${esc(formatKey(keyForNumber(r.n)))}</span><strong>${fmt(r.metres)} m${r.summit ? " ★" : ""}</strong></li>`).join("");
  $("#statsBody").innerHTML = `
    <dl class="figures register">
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
