-- Ascent accounts: who may write what in public.climbs.
--
-- One row per player per day: { user_id, day, started_at, game, result }.
--   * Each player reads and writes only their own rows (row-level security).
--   * started_at is stamped by the server on the first save and never moves.
--   * result is written ONLY by the finish-climb Edge Function (server key),
--     after it has judged every word again, and only once. Anything a player
--     sends as a result is ignored.
--   * A finished climb's game is frozen. Rows can't be deleted, so a day
--     can't be wiped and replayed.
--   * Players can open today's mountain (and yesterday's, for a climb that
--     ran past midnight), never a future one, and can't backfill older days.
--   * A climb's words can be saved until the end of the day after its own,
--     replacing the earlier "7 minutes past the start" rule, which per-pitch
--     timers made too short.
--
-- This replaces whatever triggers and policies the table had before.

-- The Perth day number: day 1 is 2026-10-13, changing at midnight Perth time
-- (UTC+8, no daylight saving). Matches js/daily.js.
create or replace function public.ascent_today()
returns integer
language sql stable
set search_path = ''
as $$
  select ((now() at time zone 'Australia/Perth')::date - date '2026-10-13') + 1
$$;

-- True for the server's own key (the Edge Function) and database admins.
create or replace function public.ascent_is_server()
returns boolean
language sql stable
set search_path = ''
as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin')
$$;

do $$
declare r record;
begin
  for r in select tgname from pg_trigger
           where tgrelid = 'public.climbs'::regclass and not tgisinternal loop
    execute format('drop trigger %I on public.climbs', r.tgname);
  end loop;
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'climbs' loop
    execute format('drop policy %I on public.climbs', r.policyname);
  end loop;
end $$;

alter table public.climbs enable row level security;

create policy climbs_read_own on public.climbs
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy climbs_add_own on public.climbs
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy climbs_save_own on public.climbs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No delete policy: nobody but the server can delete a row.

revoke all on public.climbs from anon;
revoke delete, truncate on public.climbs from authenticated;

-- security invoker, so current_user is whoever is writing.
create or replace function public.climbs_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.ascent_is_server() then
    if tg_op = 'UPDATE' and old.result is not null and new.result is distinct from old.result then
      raise exception 'this day''s result is already recorded';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    if new.day > public.ascent_today() then
      raise exception 'that mountain isn''t open yet';
    end if;
    if new.day < public.ascent_today() - 1 then
      raise exception 'older days can''t be added';
    end if;
    new.started_at := now();
    new.result := null;
  else
    if new.user_id <> old.user_id or new.day <> old.day then
      raise exception 'a climb can''t change owner or day';
    end if;
    new.started_at := old.started_at;  -- the server's stamp never moves
    new.result := old.result;          -- only the server records results
    if old.result is not null or old.day < public.ascent_today() - 1 then
      new.game := old.game;            -- finished, or too late to change
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger climbs_guard
  before insert or update on public.climbs
  for each row execute function public.climbs_guard();
