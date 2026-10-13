// The account database rules (supabase/migrations), run against a real
// Postgres in memory (PGlite). Supabase's auth schema is stubbed: auth.uid()
// reads the signed-in player's id from a setting, like Supabase does from the
// session token. The table is created as it exists in the live project.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../../supabase/migrations/", import.meta.url);
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
let db;
let today;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    insert into auth.users values ('${A}', 'a@example.com'), ('${B}', 'b@example.com');

    -- public.climbs as it is in the live project (from the Supabase table listing)
    create table public.climbs (
      user_id uuid not null default auth.uid() references auth.users(id),
      day integer not null check (day > 0),
      started_at timestamptz,
      game jsonb check (game is null or jsonb_typeof(game) = 'object'),
      result jsonb check (result is null or (jsonb_typeof(result) = 'object'
        and jsonb_typeof(result -> 'metres') = 'number'
        and (result ->> 'metres')::numeric between 0 and 5000)),
      updated_at timestamptz not null default now(),
      primary key (user_id, day)
    );
    grant all on public.climbs to anon, authenticated, service_role;
    -- something older to replace
    alter table public.climbs enable row level security;
    create policy legacy_all on public.climbs for all to authenticated using (true) with check (true);
    create function public.legacy_touch() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger legacy_touch before update on public.climbs for each row execute function public.legacy_touch();
  `);
  for (const f of fs.readdirSync(migrations).sort()) await db.exec(fs.readFileSync(new URL(f, migrations), "utf8"));
  today = (await db.query("select public.ascent_today() as d")).rows[0].d;
});

// Runs SQL as a signed-in player (or the server), the way PostgREST does.
async function as(who, sql, params = []) {
  return db.transaction(async (tx) => {
    if (who === "server") {
      await tx.exec("set local role service_role");
    } else {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [who]);
      await tx.exec("set local role authenticated");
    }
    return tx.query(sql, params);
  });
}
const fails = async (p, pattern) => {
  try { await p; } catch (e) { if (!pattern || pattern.test(e.message)) return e.message; throw e; }
  assert.fail("expected an error");
};

test("the old rules are gone and the new ones are in place", async () => {
  const pol = await db.query("select policyname from pg_policies where tablename = 'climbs' order by 1");
  assert.deepEqual(pol.rows.map((r) => r.policyname), ["climbs_add_own", "climbs_read_own", "climbs_save_own"]);
  const trg = await db.query("select tgname from pg_trigger where tgrelid = 'public.climbs'::regclass and not tgisinternal");
  assert.deepEqual(trg.rows.map((r) => r.tgname), ["climbs_guard"]);
});

test("the day number follows Perth time, like the game", async () => {
  const expected = Math.round((Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth" }).format(new Date())) - Date.parse("2026-10-13")) / 86400000) + 1;
  assert.equal(today, expected);
});

test("a player saves today's climb; the server stamps the start and drops any result", async () => {
  const r = await as(A, `insert into public.climbs (user_id, day, started_at, game, result)
    values ($1, $2, '2000-01-01', '{"pitches":[]}', '{"metres":5000}') returning *`, [B, today]);
  const row = r.rows[0];
  assert.equal(row.user_id, A, "a row always belongs to whoever saved it");
  assert.equal(row.result, null, "players can't write results");
  assert.ok(Date.now() - new Date(row.started_at).getTime() < 60_000, "the start time is the server's");
});

test("players see only their own rows", async () => {
  await as(B, "insert into public.climbs (day, game) values ($1, '{}')", [today]);
  const a = await as(A, "select user_id from public.climbs");
  assert.deepEqual(a.rows.map((r) => r.user_id), [A]);
  const changed = await as(A, "update public.climbs set game = '{\"x\":1}' where user_id = $1 returning *", [B]);
  assert.equal(changed.rows.length, 0, "A can't change B's climb");
  const anon = await db.transaction(async (tx) => { await tx.exec("set local role anon"); return tx.query("select count(*)::int as n from public.climbs").catch((e) => e); });
  assert.ok(anon instanceof Error, "signed-out visitors can't read the table");
});

test("the start time and result can't be changed by a player", async () => {
  const before = (await as(A, "select started_at from public.climbs where day = $1", [today])).rows[0].started_at;
  const r = await as(A, `update public.climbs set started_at = '2030-01-01', result = '{"metres":4999}', game = '{"pitches":[1]}' where day = $1 returning *`, [today]);
  assert.deepEqual(r.rows[0].started_at, before);
  assert.equal(r.rows[0].result, null);
  assert.deepEqual(r.rows[0].game, { pitches: [1] }, "the climb's words can still be saved");
});

test("future days can't be opened and older days can't be backfilled", async () => {
  await fails(as(A, "insert into public.climbs (day, game) values ($1, '{}')", [today + 1]), /isn't open yet/);
  if (today > 2) await fails(as(A, "insert into public.climbs (day, game) values ($1, '{}')", [today - 2]), /older days/);
});

test("rows can't be deleted by players", async () => {
  const msg = await fails(as(A, "delete from public.climbs where day = $1", [today]));
  assert.match(msg, /permission denied/);
});

test("the server records a result once; the climb then freezes", async () => {
  await as("server", `update public.climbs set result = '{"metres":3790,"verified":true}' where user_id = $1 and day = $2`, [A, today]);
  await fails(as("server", `update public.climbs set result = '{"metres":5000}' where user_id = $1 and day = $2`, [A, today]), /already recorded/);
  const r = await as(A, `update public.climbs set game = '{"pitches":["edited"]}' where day = $1 returning game, result`, [today]);
  assert.deepEqual(r.rows[0].game, { pitches: [1] }, "a finished climb's words can't change");
  assert.equal(r.rows[0].result.metres, 3790);
});

test("a result above 5,000 m is impossible even for the server", async () => {
  await as(B, "update public.climbs set game = '{}' where day = $1", [today]);
  await fails(as("server", `update public.climbs set result = '{"metres":9999}' where user_id = $1 and day = $2`, [B, today]), /check constraint/);
});

test("on a later day: yesterday can still be saved, older days can't, and old climbs freeze", async () => {
  const real = (await db.query("select pg_get_functiondef('public.ascent_today'::regproc) as d")).rows[0].d;
  await db.exec(`create or replace function public.ascent_today() returns integer language sql stable set search_path = '' as $$ select 10 $$`);
  try {
    await as(A, "insert into public.climbs (day, game) values (9, '{\"n\":9}')");
    await fails(as(A, "insert into public.climbs (day, game) values (8, '{}')"), /older days/);
    await fails(as(A, "insert into public.climbs (day, game) values (11, '{}')"), /isn't open yet/);
    await db.exec(`create or replace function public.ascent_today() returns integer language sql stable set search_path = '' as $$ select 11 $$`);
    const r = await as(A, "update public.climbs set game = '{\"n\":\"late\"}' where day = 9 returning game");
    assert.deepEqual(r.rows[0].game, { n: 9 }, "two days on, a climb's words are frozen");
  } finally {
    await db.exec(real);
  }
});
