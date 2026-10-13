// Stand-in for the Supabase client in e2e runs.
//
// Single-page mode: state lives on window.__fakeAccount
//   { session, rows, upserts, otp }.
// Shared mode (window.__fakeShared = true): users and rows live on the test
// server (/__fake/state), so two separate browser sessions use one account,
// like the real service. Sessions are kept in this browser's localStorage,
// so they survive a refresh.
//
// The database rules are mirrored from supabase/migrations: players never
// write results, the start time is stamped once, a scored day is frozen.
// functions.invoke("finish-climb") scores the climb with the real js/verify.js.
const F = () => (window.__fakeAccount ||= { session: null, rows: [], upserts: [], otp: [] });
const copy = (x) => JSON.parse(JSON.stringify(x));
const shared = () => Boolean(window.__fakeShared);
const SESSION_KEY = "ascent-auth";
const offline = { message: "Failed to fetch", status: 0 };

async function load() {
  if (!shared()) return F();
  return (await fetch("/__fake/state", { cache: "no-store" })).json();
}
async function save(st) {
  if (shared()) await fetch("/__fake/state", { method: "PUT", body: JSON.stringify(st) });
}
function session() {
  if (!shared()) return F().session;
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

async function scoreDay(st, userId, day) {
  const row = st.rows.find((r) => r.user_id === userId && r.day === day);
  if (!row) return { error: { message: "no-climb", status: 404 } };
  if (row.result) return { data: copy(row) };
  // This file is served at the CDN's address, so name the page's own origin.
  const here = (path) => new URL(path, location.origin).href;
  const [{ verifyClimb }, { puzzleFor }] = await Promise.all([import(here("/js/verify.js")), import(here("/js/daily.js"))]);
  const [assoc, freq, words] = await Promise.all([
    fetch("/data/assoc.json").then((r) => r.json()),
    fetch("/data/freq.json").then((r) => r.json()),
    fetch("/data/words.txt").then((r) => r.text()),
  ]);
  const v = verifyClimb(row.game, puzzleFor(day), { assoc, freq, words: new Set(words.split("\n").filter(Boolean)) });
  if (v.error) return { error: { message: v.error, status: 422 } };
  row.game = v.game;
  row.result = v.result;
  return { data: copy(row) };
}

export function createClient() {
  let notify = () => {};
  const auth = {
    onAuthStateChange(fn) {
      notify = fn;
      setTimeout(() => fn("INITIAL_SESSION", session()), 0);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async getSession() { return { data: { session: session() } }; },
    async getUser() { return { data: { user: session()?.user || null } }; },
    async signInWithOtp({ email }) {
      const st = await load();
      if (st.down) return { error: offline };
      (st.otp ||= []).push(email);
      await save(st);
      return { error: null };
    },
    async signUp({ email, password }) {
      const st = await load();
      if (st.down) return { error: offline };
      st.users ||= {};
      const u = st.users[email];
      if (u?.confirmed) return { data: { user: { identities: [] }, session: null }, error: null };
      st.users[email] = { id: u?.id || crypto.randomUUID(), password, confirmed: false };
      await save(st);
      return { data: { user: { identities: [{}] }, session: null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const st = await load();
      if (st.down) return { data: {}, error: offline };
      const u = st.users?.[email];
      if (!u || u.password !== password) return { data: {}, error: { message: "Invalid login credentials", status: 400 } };
      if (!u.confirmed) return { data: {}, error: { message: "Email not confirmed", status: 400 } };
      const s = { user: { id: u.id, email } };
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      notify("SIGNED_IN", s);
      return { data: { session: s }, error: null };
    },
    async signOut() {
      if (shared()) localStorage.removeItem(SESSION_KEY);
      else F().session = null;
      notify("SIGNED_OUT", null);
      return { error: null };
    },
  };

  const from = () => {
    let days = null;
    const q = {
      select() { return q; },
      in(_col, d) { days = d; return q; },
      then(ok, bad) {
        return (async () => {
          const st = await load();
          if (st.down) return { data: null, error: offline };
          const me = session()?.user?.id;
          const rows = (st.rows || []).filter((r) => (!shared() || r.user_id === me) && (!days || days.includes(r.day)));
          return { data: copy(rows), error: null };
        })().then(ok, bad);
      },
      upsert(rows) {
        const run = (async () => {
          const st = await load();
          if (st.down) return { data: null, error: offline };
          const me = session()?.user?.id;
          st.rows ||= [];
          if (!shared()) F().upserts.push(...copy(rows));
          const out = [];
          for (const r of copy(rows)) {
            const owner = shared() ? me : r.user_id;
            const i = st.rows.findIndex((x) => x.day === r.day && (!shared() || x.user_id === owner));
            if (i < 0) {
              st.rows.push({ ...r, user_id: owner, started_at: r.started_at || new Date().toISOString(), result: null });
            } else if (!st.rows[i].result) {
              st.rows[i] = { ...st.rows[i], game: r.game };   // start time and result never change
            }
            out.push(copy(st.rows[i < 0 ? st.rows.length - 1 : i]));
          }
          await save(st);
          return { data: out, error: null };
        })();
        return { select: () => run };
      },
    };
    return q;
  };

  const functions = {
    async invoke(name, { body }) {
      const st = await load();
      if (st.down) return { data: null, error: offline };
      const me = session()?.user?.id;
      if (name !== "finish-climb" || !me) return { data: null, error: { message: "not found", status: 404 } };
      const res = await scoreDay(st, shared() ? me : st.rows.find((r) => r.day === body.day)?.user_id, body.day);
      await save(st);
      return { data: res.data || null, error: res.error || null };
    },
  };
  return { auth, from, functions };
}
