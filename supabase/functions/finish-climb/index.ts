// finish-climb: records a signed-in player's verified result for one day.
//
// POST /functions/v1/finish-climb   { "day": 1 }   (with the player's session)
//   200 { day, started_at, game, result }   result scored by the server
//   4xx { error }                            nothing recorded
//
// The browser saves its climb (the words played, and when) to its own row
// in public.climbs. This function reads that row with the server key, judges
// every word again with the game's own code (shared/, copied by
// npm run build:function), and writes the result. Players can't write
// results themselves (see supabase/migrations), so a height edited into a
// browser save never reaches the account.
//
// The word data (about 0.6 MB) is read once per instance from the game's own
// site, so the server always judges with the same files players load.
// Deploy the site first, then this function (see README, Deployment).
//
// Secrets: none in the repo. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided to every Supabase Edge Function.
// ASCENT_DATA_URL (optional) points at another copy of data/.
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import { verifyClimb } from "./shared/verify.js";
import { puzzleFor, todayNumber } from "./shared/daily.js";

const DATA_URL = Deno.env.get("ASCENT_DATA_URL") ?? "https://liam-ohalloran.github.io/Ascent/data/";
type Data = { assoc: unknown; freq: unknown; words: Set<string> };
let dataPromise: Promise<Data> | null = null;
function loadData(): Promise<Data> {
  const get = async (name: string) => {
    const r = await fetch(DATA_URL + name, { headers: { "Cache-Control": "no-cache" } });
    if (!r.ok) throw new Error(`${name} ${r.status}`);
    return r;
  };
  dataPromise ||= Promise.all([get("assoc.json"), get("freq.json"), get("words.txt")])
    .then(async ([a, f, w]) => ({
      assoc: await a.json(),
      freq: await f.json(),
      words: new Set((await w.text()).split("\n").filter(Boolean)),
    }))
    .catch((err) => { dataPromise = null; throw err; });
  return dataPromise;
}

const ORIGINS = [
  "https://liam-ohalloran.github.io",
  "https://ascent-ruddy-pi.vercel.app",
];
const allowed = (o: string | null) =>
  !!o && (ORIGINS.includes(o) || /^https:\/\/ascent-[a-z0-9-]+\.vercel\.app$/.test(o) || /^http:\/\/localhost:\d+$/.test(o));

function reply(req: Request, status: number, body: unknown) {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = { "Content-Type": "application/json", Vary: "Origin" };
  if (allowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin!;
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(req, 204, null);
  if (req.method !== "POST") return reply(req, 405, { error: "method" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") || "";
  const asPlayer = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asPlayer.auth.getUser();
  const user = who?.user;
  if (!user) return reply(req, 401, { error: "signed-out" });

  let day: number;
  try {
    day = Number((await req.json())?.day);
  } catch {
    return reply(req, 400, { error: "day" });
  }
  if (!Number.isInteger(day) || day < 1 || day > todayNumber(new Date())) return reply(req, 400, { error: "day" });

  const server = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: row, error } = await server.from("climbs")
    .select("day, started_at, game, result").eq("user_id", user.id).eq("day", day).maybeSingle();
  if (error) {
    console.error("finish-climb read", error.message);
    return reply(req, 503, { error: "unavailable" });
  }
  if (!row) return reply(req, 404, { error: "no-climb" });
  if (row.result) return reply(req, 200, row); // already recorded: results are write-once

  let data: Data;
  try {
    data = await loadData();
  } catch (err) {
    console.error("finish-climb data", (err as Error).message);
    return reply(req, 503, { error: "unavailable" });
  }
  const checked = verifyClimb(row.game, puzzleFor(day), data);
  if ("error" in checked) return reply(req, 422, { error: checked.error, detail: checked.detail });

  const { data: saved, error: upErr } = await server.from("climbs")
    .update({ game: checked.game, result: checked.result })
    .eq("user_id", user.id).eq("day", day).is("result", null)
    .select("day, started_at, game, result").maybeSingle();
  if (upErr) {
    console.error("finish-climb write", upErr.message);
    return reply(req, 503, { error: "unavailable" });
  }
  return reply(req, 200, saved ?? row);
});
