// Stand-in for the Supabase client in e2e runs. State lives on
// window.__fakeAccount: { session, rows, upserts, otp }.
const F = () => (window.__fakeAccount ||= { session: null, rows: [], upserts: [], otp: [] });
const copy = (x) => JSON.parse(JSON.stringify(x));

export function createClient() {
  let notify = () => {};
  const auth = {
    onAuthStateChange(fn) {
      notify = fn;
      setTimeout(() => fn("INITIAL_SESSION", F().session), 0);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async getSession() { return { data: { session: F().session } }; },
    async getUser() { return { data: { user: F().session?.user || null } }; },
    async signInWithOtp({ email }) { F().otp.push(email); return { error: null }; },
    async signOut() { F().session = null; notify("SIGNED_OUT", null); return { error: null }; },
  };
  const from = () => {
    let days = null;
    const q = {
      select() { return q; },
      in(_col, d) { days = d; return q; },
      then(ok, bad) {
        const rows = F().rows.filter((r) => !days || days.includes(r.day));
        return Promise.resolve({ data: copy(rows), error: null }).then(ok, bad);
      },
      upsert(rows) {
        F().upserts.push(...copy(rows));
        for (const r of copy(rows)) {
          const i = F().rows.findIndex((x) => x.day === r.day);
          if (i < 0) F().rows.push(r);
          else if (!F().rows[i].result) F().rows[i] = { ...r, started_at: F().rows[i].started_at || r.started_at };
        }
        return { select: async () => ({ data: copy(rows), error: null }) };
      },
    };
    return q;
  };
  return { auth, from };
}
