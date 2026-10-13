// Optional accounts. Signing in saves each day's climb to your account, so
// streaks, stats and personal bests follow you between devices, and the day's
// one attempt holds across devices too. Without an account the game works
// exactly as before, in this browser only.
//
// Sign in with an email and password (Supabase Auth), or with an emailed
// link. Passwords never touch this code's storage: Supabase keeps only a
// session token in this browser. The account table (supabase/migrations)
// enforces what the browser can't: each player sees only their own rows, the
// server stamps the start time, future days can't be opened, rows can't be
// deleted, and RESULTS ARE WRITTEN ONLY BY THE SERVER: after a climb is saved,
// the finish-climb function judges its words again and records the score.
// The client library is loaded only when needed, so a blocked CDN never stops
// the game.
import * as store from "./stats.js";
import { todayNumber } from "./daily.js";

const SUPABASE_URL = "https://smkxqwgikxpiaptyszrd.supabase.co";
const SUPABASE_KEY = "sb_publishable_3I_cSjyXmGXQfBPhXGJNiA_k3F7lV8f"; // public by design; rows are protected by row-level security
const LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm";
const PUSH_DELAY = 800;

let client = null;
let onSynced = () => {};
const listeners = new Set();
export const state = { status: "loading", email: null, lastSync: null, message: "", syncing: false };

function set(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const signedIn = () => state.status === "in";

// An expired or reused link comes back with the error in the address.
function linkError() {
  const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  const err = params.get("error_description") || (params.get("error") ? "That sign-in link didn't work." : "");
  if (!err) return "";
  history.replaceState({}, "", location.pathname);
  return /expired|invalid/i.test(err) ? "That sign-in link has expired or was already used. Send a new one." : err;
}

export async function initAccount({ onSync } = {}) {
  if (onSync) onSynced = onSync;
  const message = linkError();
  let lib;
  try {
    lib = await import(LIBRARY);
  } catch {
    set({ status: "unavailable", message: "Accounts can't be reached right now. Your climbs are still saved in this browser." });
    return;
  }
  client = lib.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "ascent-auth" },
  });
  client.auth.onAuthStateChange((event, session) => {
    const email = session?.user?.email || null;
    if (email) {
      const wasIn = state.status === "in";
      set({ status: "in", email, message: wasIn ? state.message : "" });
      // Defer: Supabase asks that no other calls run inside this callback.
      if (!wasIn) setTimeout(() => sync(), 0);
    } else {
      set({ status: "out", email: null, lastSync: null });
    }
  });
  const { data } = await client.auth.getSession();
  if (!data.session) set({ status: "out", message });
  store.onChange(queuePush);
}

const validEmail = (address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
export const MIN_PASSWORD = 8;
const OFFLINE = "Couldn't reach the account service. Check your connection and try again.";
const offline = (error) => !error?.status || /fetch|network|load failed/i.test(error?.message || "");

// Turns an account error into what to do next.
function explain(error) {
  const m = error?.message || "";
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. Check them, or email yourself a sign-in link.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first: open the link we sent you, then sign in.";
  if (/already registered|already been registered|user already exists/i.test(m)) return "There's already an account for that email. Sign in instead.";
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return `Use a password of at least ${MIN_PASSWORD} characters.`;
  if (/rate|seconds|too many/i.test(m) || error?.status === 429) return "Too many tries. Wait a minute, then try again.";
  if (offline(error)) return OFFLINE;
  return "That didn't work. Try again in a moment.";
}

function checkForm(email, password) {
  if (!validEmail(email)) return "Enter your email address.";
  if (password.length < MIN_PASSWORD) return `Use a password of at least ${MIN_PASSWORD} characters.`;
  if (!client) return "Accounts can't be reached right now. Try again soon.";
  return "";
}

// Creates an account. Supabase emails a confirmation link first.
export async function register(email, password) {
  const address = String(email || "").trim();
  const problem = checkForm(address, String(password || ""));
  if (problem) return { error: problem };
  try {
    const { data, error } = await client.auth.signUp({
      email: address, password, options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) return { error: explain(error) };
    // An existing, confirmed email comes back with no identities (Supabase hides whether it exists).
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { error: explain({ message: "already registered" }) };
    }
    return data?.session ? { ok: true, signedIn: true } : { ok: true, confirm: true };
  } catch (err) {
    return { error: explain(err) };
  }
}

export async function signIn(email, password) {
  const address = String(email || "").trim();
  const problem = checkForm(address, String(password || ""));
  if (problem) return { error: problem };
  try {
    const { error } = await client.auth.signInWithPassword({ email: address, password });
    return error ? { error: explain(error) } : { ok: true };
  } catch (err) {
    return { error: explain(err) };
  }
}

export async function sendLink(email) {
  const address = String(email || "").trim();
  if (!validEmail(address)) return { error: "Enter your email address." };
  if (!client) return { error: "Accounts can't be reached right now. Try again soon." };
  const { error } = await client.auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
  });
  if (error) {
    if (/rate|seconds|too many/i.test(error.message)) return { error: "Too many sign-in emails. Wait a minute, then try again." };
    return { error: offline(error) ? OFFLINE : "The sign-in email couldn't be sent. Try again soon." };
  }
  return { ok: true };
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  set({ status: "out", email: null, lastSync: null, message: "Signed out. Your climbs stay saved in this browser." });
}

/* ---------- sync ---------- */

let pending = new Set();
let pushTimer = null;

function queuePush(n) {
  if (!signedIn()) return;
  pending.add(n);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync([...pending]), PUSH_DELAY);
}

let running = null;
// Pulls the account's rows (all, or just some days), merges them in, then
// saves any days this browser knows more about. Safe to call any time.
export function sync(days = null) {
  if (!signedIn() || !client) return Promise.resolve();
  if (running) return running.then(() => sync(days));
  if (days) days.forEach((d) => pending.delete(d));
  running = (async () => {
    set({ syncing: true });
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error("signed out");
      let q = client.from("climbs").select("day, started_at, game, result");
      if (days) q = q.in("day", days);
      const { data: rows, error } = await q;
      if (error) throw error;
      const changed = store.mergeRemote(rows);
      const today = todayNumber();
      const rowsOut = store.daysToPush(rows, today).map(store.exportDay).filter(Boolean)
        .map((r) => ({ ...r, user_id: user.id }));
      let known = rows;
      if (rowsOut.length) {
        const { data: saved, error: upErr } = await client.from("climbs")
          .upsert(rowsOut, { onConflict: "user_id,day" })
          .select("day, started_at, game, result");
        if (upErr) throw upErr;
        changed.push(...store.mergeRemote(saved));
        known = [...rows.filter((r) => !saved.some((s) => s.day === r.day)), ...saved];
      }
      // Finished climbs the account hasn't scored yet: the server judges them.
      for (const day of store.daysToFinish(known)) {
        const { data: row, error: fnErr } = await client.functions.invoke("finish-climb", { body: { day } });
        if (fnErr) {
          console.warn("Ascent finish-climb", day, fnErr);
          continue; // tried again on the next sync
        }
        changed.push(...store.mergeRemote([row]));
      }
      set({ lastSync: Date.now(), message: "" });
      if (changed.length) onSynced([...new Set(changed)]);
    } catch (err) {
      console.warn("Ascent sync", err);
      set({ message: "Couldn't reach your account. Your climbs are saved here and will sync next time." });
    } finally {
      set({ syncing: false });
      running = null;
    }
  })();
  return running;
}

let lastPull = 0;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && signedIn() && Date.now() - lastPull > 30000) {
    lastPull = Date.now();
    sync();
  }
});
