// Optional sign-in. Signing in saves each day's climb to your account, so
// streaks and stats follow you between devices, and the day's one attempt
// holds across devices too. Without an account the game works exactly as before.
//
// Sign-in is an emailed link (Supabase Auth): no passwords. The account table
// enforces the rules the browser can't: the server stamps the start time, a
// finished result can't be changed, future days can't be opened, and rows can't
// be deleted. The client library is loaded only when needed, so a blocked CDN
// never stops the game.
import * as store from "./stats.js";

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

export async function sendLink(email) {
  const address = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { error: "Enter your email address." };
  if (!client) return { error: "Accounts can't be reached right now. Try again soon." };
  const { error } = await client.auth.signInWithOtp({
    email: address,
    options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
  });
  if (error) {
    const wait = /rate|seconds|too many/i.test(error.message);
    return { error: wait ? "Too many sign-in emails. Wait a minute, then try again." : "The sign-in email couldn't be sent. Try again soon." };
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
      const rowsOut = store.daysToPush(rows).map(store.exportDay).filter(Boolean)
        .map((r) => ({ ...r, user_id: user.id }));
      if (rowsOut.length) {
        const { data: saved, error: upErr } = await client.from("climbs")
          .upsert(rowsOut, { onConflict: "user_id,day" })
          .select("day, started_at, game, result");
        if (upErr) throw upErr;
        changed.push(...store.mergeRemote(saved));
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
