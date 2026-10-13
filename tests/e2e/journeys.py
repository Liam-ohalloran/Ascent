"""End-to-end journeys for Ascent in a real browser (Playwright, Chromium).

Runs against a local static server. The clock is frozen at a known instant and
the server-time sync gets no Date header, so every run sees the same daily
puzzle no matter when it's run.

  pip install playwright && python3 -m playwright install chromium
  python3 tests/e2e/journeys.py            # screenshots go to tests/e2e/out/
"""
import asyncio, functools, http.server, json, pathlib, re, sys, threading
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).with_name("out")
OUT.mkdir(exist_ok=True)
PORT = 8790
URL = f"http://localhost:{PORT}/"
DAY1 = "2026-10-13T04:00:00Z"   # noon in Perth, puzzle No. 1
DAY2 = "2026-10-14T04:00:00Z"
DAY3 = "2026-10-15T04:00:00Z"
THEMES = ["The Foothills", "The Forest", "The Frozen Ridge", "The Storm Wall", "The Summit"]

results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

FAKE_STATE = {"users": {}, "rows": [], "otp": [], "down": False}

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
        # Shared account state for tests/e2e/fake_supabase.js in shared mode.
        def do_GET(self):
            if self.path.startswith("/__fake/state"):
                body = json.dumps(FAKE_STATE).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
                return
            super().do_GET()
        def do_PUT(self):
            if self.path.startswith("/__fake/state"):
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                FAKE_STATE.clear(); FAKE_STATE.update(data)
                self.send_response(204); self.end_headers()
                return
            self.send_response(405); self.end_headers()
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def seed_state(**extra):
    return {"ascent": json.dumps({"version": 3, "games": {}, "attempts": {}, "results": {}, "seenHelp": True, **extra})}

FAKE_SUPABASE = (ROOT / "tests/e2e/fake_supabase.js").read_text()

async def open_page(browser, when=DAY1, tz="Australia/Perth", width=390, height=844, scheme="light", storage=None, ctx=None, account=None, accounts_down=False):
    ctx = ctx or await browser.new_context(viewport={"width": width, "height": height}, timezone_id=tz, color_scheme=scheme)
    page = await ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
    await page.clock.install(time=when)
    await page.route("**/data/freq.json?clock=*", lambda r: r.fulfill(status=204, headers={}))
    await page.route(re.compile(r"\.supabase\.co/"), lambda r: r.abort())
    if accounts_down:
        await page.route(re.compile(r"supabase-js@"), lambda r: r.abort())
    else:
        await page.route(re.compile(r"supabase-js@"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=FAKE_SUPABASE))
    if account is not None:
        await page.add_init_script("window.__fakeAccount = " + json.dumps({"session": None, "rows": [], "upserts": [], "otp": [], **account}) + ";")
    seed = seed_state() if storage is None else storage
    if seed:
        await page.add_init_script(
            "if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');"
            + "".join(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});" for k, v in seed.items()) + "}")
    await page.goto(URL)
    await page.wait_for_selector("#stage .ready, #stage .pitch, #stage .result, #stage .error-state")
    return page

async def word(page, w):
    await page.fill("#guess", w)
    await page.press("#guess", "Enter")
    await page.wait_for_function("document.body.dataset.phase !== 'judging'")
    await settle(page)

async def fresh(page):
    """True if the pitch timer shows a fresh 20 seconds. The page clock also
    runs in real time while the test waits, so one tick may have passed."""
    t = await page.inner_text("#timer")
    return "0:20" in t or "0:19" in t

async def settle(page):
    """Waits for the guess animations (js/fx.js) to finish."""
    await page.wait_for_function("document.body.dataset.fx !== 'busy'")

async def save(page):
    return await page.evaluate("JSON.parse(localStorage.getItem('ascent'))")

async def begin(page):
    await page.click("#beginBtn")
    await page.wait_for_selector("#stage .pitch")

async def climb(page, words=("LIGHT", "GREEN", "ROOM", "MATE"), summit=("PETRICHOR",), think=0):
    """Plays one word per link pitch (keeping it if it doesn't fit), then the summit.
    think: seconds spent on each pitch before answering."""
    for w in words:
        if think:
            await page.clock.run_for(think * 1000)
        await word(page, w)
        if await page.locator("#keepBtn").count():
            await page.click("#keepBtn")
        await page.click("#nextBtn")
    if think:
        await page.clock.run_for(think * 1000)
    for w in summit:
        await word(page, w)
    if await page.locator("#nextBtn").count():
        await page.click("#nextBtn")
    await page.wait_for_selector("#stage .result")

async def main():
    srv = serve()
    async with async_playwright() as pw:
        b = await pw.chromium.launch()

        # 1. New player: onboarding once, practice box doesn't touch the day.
        p = await open_page(b, storage={})
        check("onboarding opens on first visit", await p.evaluate("document.querySelector('#help').open"))
        await p.fill("#tryInput", "stone"); await p.press("#tryInput", "Enter")
        await p.wait_for_function("document.querySelector('#tryResult').textContent.length > 0")
        check("practice box scores a word", "STONE links SUN" in await p.inner_text("#tryResult"))
        await p.screenshot(path=OUT / "01-onboarding.png")
        await p.click("#help [data-close]")
        s = await save(p)
        check("practice saved no climb", not s["games"] and not s["attempts"])
        await p.reload(); await p.wait_for_selector("#stage .ready")
        check("onboarding not shown again", not await p.evaluate("document.querySelector('#help').open"))
        await p.context.close()

        # 2. Today's climb screen, then begin: the timer starts and the themes run in order.
        p = await open_page(b)
        text = await p.inner_text("#stage")
        check("ready screen shows today's mountain", "Today's climb" in text and "Kestrel Spire" in text and "Start climb" in text)
        track = await p.inner_text("#track")
        check("ready screen lists the five zones in order", all(t in track for t in ("Foothills", "Forest", "Ridge", "Storm", "Summit")) and track.index("Foothills") < track.index("Summit"), track)
        check("main menu shows streak, personal best and the reset countdown",
              "Streak" in text and "Personal best" in text and re.search(r"Next mountain\s*\d\d:\d\d:\d\d", text) is not None, text)
        check("no word field before the climb begins", await p.locator("#entryForm").is_hidden())
        await p.screenshot(path=OUT / "02-ready.png")
        await begin(p)
        check("timer shows 20 seconds for the first pitch", await fresh(p))
        check("first pitch is The Foothills", THEMES[0] in await p.inner_text("#stage"))
        s = await save(p)
        check("attempt recorded once", s["attempts"].get("1") and s["games"]["1"]["startedAt"])
        await p.screenshot(path=OUT / "03-first-pitch.png")

        # 3. The scoring ladder: every real word climbs, gibberish is refused.
        await word(p, "asdfg")
        msg = await p.inner_text("#formMsg")
        check("gibberish refused without using a try", "isn't a word we know" in msg and "wasn't used" in msg, msg)
        await word(p, "pencil")
        card = await p.locator(".guess-card").last.inner_text()
        check("unrelated real word earns a 100 m foothold", "+100 m" in card and "foothold" in card, card)
        for text, msg in [("", "Type a word first"), ("light2", "Use letters only"), ("sun", "one of the clues"), ("pencil", "already tried")]:
            await p.fill("#guess", text); await p.press("#guess", "Enter")
            got = await p.inner_text("#formMsg")
            check(f"invalid input {text!r} explained", msg in got, got)
        await word(p, "stone")
        check("second try fit, scored at 70%", "+430 m" in await p.inner_text("#stage"))
        await p.screenshot(path=OUT / "04-pitch-done.png")
        s = await save(p)
        g = s["games"]["1"]
        check("pitch keeps its best try", g["pitches"][0]["points"] == 430 and len(g["pitches"][0]["guesses"]) == 2, g["pitches"][0])
        check("refused word counted as rejected", g["rejected"] == 1, g["rejected"])
        check("the next pitch waits: no clock during the result", g["pitchStarts"][1] is None, g["pitchStarts"])
        await p.click("#nextBtn")
        check("second pitch is The Forest", THEMES[1] in await p.inner_text("#stage"))
        check("unused time doesn't carry over: the Forest gets exactly 20 seconds", await fresh(p))

        # 4. Refreshing keeps the climb and the pitch's deadline.
        await p.clock.run_for(5_000)
        await p.reload(); await p.wait_for_selector("#stage .pitch")
        t = await p.inner_text("#timer")
        check("refresh keeps the pitch deadline (timer not reset)", "0:15" in t, t)
        check("refresh resumes on The Forest", THEMES[1] in await p.inner_text("#stage"))
        check("refresh keeps the height", await p.inner_text("#altNum") == "430")
        await word(p, "moon")
        card = await p.locator(".guess-card").last.inner_text()
        check("partial link earns part of the pitch", "Holds on LIGHT" in card, card)
        await p.context.close()

        # 5. Rapid repeated submits record one guess.
        p = await open_page(b)
        await begin(p)
        await p.fill("#guess", "STONE")
        await p.evaluate("""() => { const f = document.querySelector('#entryForm');
            f.requestSubmit(); f.requestSubmit(); document.querySelector('#climbBtn').click(); f.requestSubmit(); }""")
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        g = (await save(p))["games"]["1"]
        check("rapid submits record exactly one guess", len(g["pitches"][0]["guesses"]) == 1 and g["current"] == 1)
        check("rapid submits don't start or extend a clock", g["pitchStarts"][0] == g["startedAt"] and g["pitchStarts"][1] is None, g["pitchStarts"])
        await p.clock.run_for(1_700)
        await p.wait_for_function("document.body.dataset.phase === 'playing'")
        check("the next pitch starts by itself after the result", THEMES[1] in await p.inner_text("#stage") and await fresh(p))
        await p.context.close()

        # 6. Word lists unavailable: clear error, no try used, retry works.
        p = await open_page(b)
        await p.route("**/data/words.txt", lambda r: r.abort())
        await p.evaluate("location.reload()"); await p.wait_for_selector("#stage .ready")
        await begin(p)
        await word(p, "STONE")
        msg = await p.inner_text("#formMsg")
        check("data failure shows a clear error", "didn't load" in msg and "wasn't used" in msg, msg)
        check("data failure keeps the typed word", await p.input_value("#guess") == "STONE")
        await p.screenshot(path=OUT / "05-network-error.png")
        await p.unroute("**/data/words.txt")
        await p.press("#guess", "Enter")
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        check("retry after failure scores once", len((await save(p))["games"]["1"]["pitches"][0]["guesses"]) == 1)
        await p.context.close()

        # 7. A full climb: results become the day's screen; it can't be restarted.
        p = await open_page(b, width=1440, height=900)
        await begin(p)
        await climb(p, think=5)
        text = await p.inner_text("#stage")
        check("results screen after the climb", "Finished at" in text and "Kestrel Spire" in text and "No. 1" in text, text[:120])
        check("finishing all five isn't the summit with common words", "Summit reached" not in text)
        check("results show pitches, time, words and refused", all(x in text for x in ("5/5", "0:25", "Words", "Refused")), text[:400])
        check("results show streaks and the next-mountain countdown", "Streak" in text and "next mountain appears in" in text.lower())
        check("no restart button on results", await p.locator("#beginBtn").count() == 0 and await p.locator("#entryForm").is_hidden())
        await p.screenshot(path=OUT / "06-results-desktop.png")
        r = (await save(p))["results"]["1"]
        check("result recorded with the climb's details", r["pitches"] == 5 and r["time"] == 25 and r["summitWord"] and not r["summit"], r)
        for _ in range(2):
            await p.reload(); await p.wait_for_selector("#stage .result")
        s = await save(p)
        check("revisiting results doesn't change or duplicate them", s["results"]["1"] == r and len(s["results"]) == 1)
        check("still no way to climb again after refresh", await p.locator("#beginBtn").count() == 0)
        await p.goto(URL + "?day=1"); await p.wait_for_selector("#stage .result")
        check("?day= can't reopen a climb", await p.locator("#beginBtn").count() == 0)
        await p.context.grant_permissions(["clipboard-read", "clipboard-write"])
        await p.click("#shareBtn")
        clip = await p.evaluate("navigator.clipboard.readText()")
        check("share text has the day, height, pitches, time, summit and streak",
              all(x in clip for x in ("Ascent #1", "m / 5,000 m", "Pitches: 5 / 5", "Time: 0:25", "Summit: Not reached", "Streak: 1 day")), clip)
        check("share text reveals no answers", not any(w in clip for w in ("LIGHT", "GREEN", "ROOM", "MATE", "PETRICHOR")), clip)
        check("no console errors in a full climb", not p.errors, p.errors)
        await p.context.close()

        # 8. Rare fits climb higher than common ones.
        p = await open_page(b)
        await begin(p)
        await climb(p, words=("STONE", "OPERA", "PAPER", "MATE"))
        m = int((await save(p))["games"]["1"]["metres"])
        # Intended words climb 3,790 m; rarer strong fits (OPERA, PAPER) go higher.
        check("rare fits climb higher", m > 3790, m)
        await p.screenshot(path=OUT / "07-rare-climb.png")
        await p.context.close()

        # 9. A pitch's timer runs out: it keeps its best try and the climb moves on.
        p = await open_page(b)
        await begin(p)
        await word(p, "spot")
        spot = (await save(p))["games"]["1"]["pitches"][0]["guesses"][0]["points"]
        await p.clock.run_for(19_000)
        check("a wrong guess doesn't reset the timer", "0:01" in await p.inner_text("#timer"), await p.inner_text("#timer"))
        await p.clock.run_for(1_500)
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        text = await p.inner_text("#stage")
        g = (await save(p))["games"]["1"]
        check("time-out ends the pitch, not the climb", not g["done"] and g["current"] == 1 and g["pitches"][0]["timedOut"], g)
        check("the timed-out pitch keeps its best try", g["pitches"][0]["points"] == spot, g["pitches"][0])
        check("the time-out is shown", "Out of time" in text)
        await p.screenshot(path=OUT / "08-pitch-timeout.png")
        await p.clock.run_for(1_700)
        await p.wait_for_function("document.body.dataset.phase === 'playing'")
        check("the next pitch gets a fresh 20 seconds", THEMES[1] in await p.inner_text("#stage") and await fresh(p))
        for k in range(2, 6):   # let every remaining pitch run out, one at a time
            await p.clock.run_for(22_000)
            await p.wait_for_function(f"JSON.parse(localStorage.ascent).games['1'].current >= {k}")
        g = (await save(p))["games"]["1"]
        check("five time-outs finish the climb", g["done"] and g["endReason"] == "finished" and all(x.get("timedOut") for x in g["pitches"] + [g["summit"]]), g)
        check("the score is the one word that was played", g["metres"] == spot, g["metres"])
        await p.click("#nextBtn"); await p.wait_for_selector("#stage .result")
        text = await p.inner_text("#stage")
        check("results say time ran out on five pitches", "Time ran out on 5 pitches" in text and "1:40" in text, text[:300])
        check("only one clock ran: the climb took 5 x 20 seconds", (await save(p))["results"]["1"]["time"] == 100)
        await p.context.close()

        # 10. Closing the page and coming back later.
        p = await open_page(b)
        await begin(p)
        await word(p, "light")
        await p.click("#nextBtn")     # the Forest's clues are now on screen, its clock running
        ctx = p.context
        await p.close()
        p = await open_page(b, when="2026-10-13T04:10:00Z", ctx=ctx, storage={})
        g = (await save(p))["games"]["1"]
        check("late return: the running pitch ended at its deadline", g["pitches"][1]["timedOut"] and g["pitches"][1]["endedAt"] == g["pitchStarts"][1] + 20_000, g["pitches"][1])
        check("late return: the next pitch hasn't started (its clues were never shown)", g["current"] == 2 and g["pitchStarts"][2] is None, g["pitchStarts"])
        await p.clock.run_for(1_700)
        await p.wait_for_function("document.body.dataset.phase === 'playing'")
        check("late return: the next pitch then gets its 20 seconds", THEMES[2] in await p.inner_text("#stage") and await fresh(p))
        await ctx.close()

        # 10b. Refresh in the transition, hidden tabs and a clock set backwards.
        p = await open_page(b)
        await begin(p)
        await word(p, "light")
        await p.reload(); await p.wait_for_selector("#stage .feedback")
        check("refresh during the transition shows the result again", "LIGHT" in await p.inner_text("#stage"))
        await p.clock.run_for(1_700)
        await p.wait_for_function("document.body.dataset.phase === 'playing'")
        first = (await save(p))["games"]["1"]["pitchStarts"][1]
        await p.clock.run_for(4_000)
        await p.reload(); await p.wait_for_selector("#stage .pitch")
        g = (await save(p))["games"]["1"]
        check("refresh mid-pitch keeps the pitch's start", g["pitchStarts"][1] == first and "0:16" in await p.inner_text("#timer"), await p.inner_text("#timer"))
        await p.clock.set_system_time("2026-10-13T03:00:00Z")    # an hour backwards
        await p.clock.run_for(1_000)
        check("setting the clock back doesn't add time", "0:15" in await p.inner_text("#timer"), await p.inner_text("#timer"))
        hide = "(h) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }"
        await p.evaluate(hide, True)
        await p.clock.run_for(40_000)
        await p.evaluate(hide, False)
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        g = (await save(p))["games"]["1"]
        check("a hidden tab doesn't pause the pitch", g["pitches"][1]["timedOut"] and g["current"] == 2, g["pitches"][1])
        await p.evaluate(hide, True)
        await p.clock.run_for(30_000)
        g = (await save(p))["games"]["1"]
        check("the next pitch doesn't start while the page is hidden", g["pitchStarts"][2] is None, g["pitchStarts"])
        await p.evaluate(hide, False)
        await p.clock.run_for(1_700)
        await p.wait_for_function("document.body.dataset.phase === 'playing'")
        t = await p.inner_text("#timer")   # the page clock also runs in real time, so allow a tick
        check("it starts with 20 seconds once the page is seen", THEMES[2] in await p.inner_text("#stage") and ("0:20" in t or "0:19" in t), t)
        # This pitch began on the game's own clock, an hour ahead of the device
        # clock set back above. Reloading offline can't turn that into extra time.
        await p.reload(); await p.wait_for_selector("#stage .feedback, #stage .pitch")
        g = (await save(p))["games"]["1"]
        check("reloading with the clock set back ends the pitch instead of adding time", g["pitches"][2].get("timedOut") and g["current"] == 3, g["pitches"][2])
        check("no console errors in the timer journeys", not p.errors, p.errors)
        await p.context.close()

        # 11. Midnight: countdown reaches zero, the new mountain loads, the old result stays.
        p = await open_page(b, when="2026-10-13T15:50:00Z")
        await begin(p)
        await climb(p)
        r1 = (await save(p))["results"]["1"]
        await p.clock.run_for(10 * 60_000 + 2_000)
        await p.wait_for_selector("#stage .ready", timeout=8000)
        check("new mountain appears at Perth midnight without a refresh", "No. 2" in await p.text_content("#dayLine"))
        check("yesterday's result is untouched", (await save(p))["results"]["1"] == r1)
        await p.screenshot(path=OUT / "09-new-day.png")
        await p.context.close()

        # 12. Streaks and missed days; the calendar is read-only history.
        state = seed_state(attempts={"1": 1791864000000}, results={"1": {"metres": 3100, "pitches": 5, "summitWord": True}})
        p = await open_page(b, when=DAY3, storage=state)
        before = (await save(p))["results"]
        await p.click("[data-open=stats]")
        st = await p.inner_text("#statsBody")
        check("a missed day breaks the streak", re.search(r"Streak\s*0\b", st) is not None, st[:80])
        await p.click("#calBtn")
        await p.wait_for_selector(".cal-day")
        statuses = await p.evaluate("[...document.querySelectorAll('.cal-day')].map(b => b.className)")
        check("calendar marks finished, missed and today",
              any("c-done" in c for c in statuses) and any("c-missed" in c for c in statuses) and any("c-today" in c for c in statuses), statuses)
        await p.click(".cal-day.c-done")
        detail = await p.inner_text("#calDetail")
        check("past day opens as results only", "No. 1" in detail and await p.locator("#calDetail #beginBtn, #calDetail input").count() == 0, detail[:120])
        await p.click(".cal-day.c-missed")
        check("missed day keeps answers hidden until asked", await p.locator("#reveal").is_hidden())
        await p.click("#revealBtn")
        check("answers shown on request", "DEFENESTRATION" in await p.inner_text("#calDetail"))
        await p.screenshot(path=OUT / "10-calendar.png")
        check("viewing history changed nothing", (await save(p))["results"] == before)
        await p.context.close()

        # 13. Damaged and old saves.
        p = await open_page(b, storage={"ascent": "{oops"})
        if await p.evaluate("document.querySelector('#help').open"):
            await p.click("#help [data-close]")
        check("damaged save shows a notice", "couldn't be read" in await p.inner_text("#banner"))
        await begin(p)
        await word(p, "light")
        check("game playable after damaged save", await p.evaluate("document.body.dataset.phase") == "feedback")
        await p.context.close()
        p = await open_page(b, storage={"ascent:v1": json.dumps({"games": {}, "results": {"1": {"metres": 3000, "summit": True, "tier": "Ridge"}}, "seenHelp": True})}, when=DAY2)
        check("v1 player isn't shown the tutorial again", not await p.evaluate("document.querySelector('#help').open"))
        await p.click("[data-open=stats]")
        st = await p.inner_text("#statsBody")
        check("v1 stats carried over", "3,000" in st, st[:200])
        await p.context.close()

        # 14. Same instant, same mountain everywhere.
        seen = set()
        for tz in ("Australia/Perth", "America/Los_Angeles", "Europe/London", "Pacific/Kiritimati"):
            p = await open_page(b, when="2026-10-13T20:00:00Z", tz=tz)
            seen.add(re.search(r"No\. \d+", await p.text_content("#dayLine")).group(0))
            await p.context.close()
        check("every timezone gets the same mountain", seen == {"No. 2"}, seen)

        # 15. Keyboard only.
        p = await open_page(b, width=1024, height=768)
        await p.focus("#beginBtn"); await p.keyboard.press("Enter")
        await p.wait_for_selector("#stage .pitch")
        check("word field focused when the climb begins", await p.evaluate("document.activeElement.id") == "guess")
        await p.keyboard.type("stone"); await p.keyboard.press("Enter")
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        check("next button gets focus after a pitch", await p.evaluate("document.activeElement.id") == "nextBtn")
        await p.keyboard.press("Enter")
        check("Enter continues to The Forest", THEMES[1] in await p.inner_text("#stage"))
        check("focus returns to the word field", await p.evaluate("document.activeElement.id") == "guess")
        await p.context.close()

        # 16. Layout at every test width, light and dark.
        for w, h in ((320, 640), (375, 667), (390, 844), (430, 932), (768, 1024), (1024, 768), (1440, 900)):
            for scheme in ("light", "dark"):
                p = await open_page(b, width=w, height=h, scheme=scheme)
                await begin(p)
                await word(p, "pencil")
                over = await p.evaluate("document.documentElement.scrollWidth - innerWidth")
                inp = await p.locator("#guess").bounding_box()
                kb = await p.locator("#keyboard").bounding_box()
                clues = await p.locator(".chips").first.bounding_box()
                check(f"{w}x{h} {scheme}: no sideways scroll", over <= 0, over)
                check(f"{w}x{h} {scheme}: word field on screen", inp and 0 <= inp["y"] and inp["y"] + inp["height"] <= h, inp)
                check(f"{w}x{h} {scheme}: clues on screen", clues and clues["y"] >= 0 and clues["y"] + clues["height"] <= inp["y"], clues)
                check(f"{w}x{h} {scheme}: keyboard below the field", not kb or kb["y"] >= inp["y"] + inp["height"] - 1)
                small = await p.evaluate("""[...document.querySelectorAll('button:not([tabindex="-1"])')].filter(b => b.offsetParent)
                    .map(b => b.getBoundingClientRect()).filter(r => r.height < 40 || r.width < 40).length""")
                check(f"{w}x{h} {scheme}: tap targets at least 40px", small == 0, small)
                await p.screenshot(path=OUT / f"layout-{w}-{scheme}.png")
                await p.context.close()

        # 17. Sign-in is optional, and signing in syncs climbs between devices.
        p = await open_page(b, account={})
        await p.click("#accountBtn")
        await p.wait_for_selector("#emailInput")
        body = await p.inner_text("#accountBody")
        check("account: signed-out dialog offers password and email link", "Email me a sign-in link" in body and "Create account" in body and "optional" in body, body)
        await p.fill("#emailInput", "not-an-email"); await p.click("#sendLinkBtn")
        check("account: a bad email is caught", "Enter your email" in await p.inner_text("#signInMsg"))
        await p.fill("#emailInput", "climber@example.com"); await p.click("#sendLinkBtn")
        await p.wait_for_selector("text=Check your email")
        check("account: link requested for the email", await p.evaluate("window.__fakeAccount.otp") == ["climber@example.com"])
        await p.screenshot(path=OUT / "account-signed-out.png")
        await p.keyboard.press("Escape")
        check("account: the game still works signed out", await p.locator("#beginBtn").count() == 1)
        await p.context.close()

        user = {"user": {"id": "u1", "email": "climber@example.com"}}
        started = "2026-10-14T03:59:00Z"   # one minute before DAY2, on "another device"
        other = {"pitches": [{"guesses": [{"word": "LIGHT", "linked": ["SUN", "FIRE"], "zipf": 5.5, "points": 620}], "done": True, "points": 620},
                             {"guesses": [], "done": False}, {"guesses": [], "done": False}, {"guesses": [], "done": False}],
                 "summit": {"guesses": [], "done": False}, "startedAt": 1791950340000, "endReason": None,
                 "pitchStarts": [1791950340000, 1791950395000, None, None, None]}   # the Forest began 5 s ago
        local = seed_state(results={"1": {"metres": 2100, "pitches": 5, "summitWord": False}}, attempts={"1": 1791864000000})
        p = await open_page(b, when=DAY2, storage=local, account={"session": user, "rows": [{"day": 2, "started_at": started, "game": other, "result": None}]})
        await p.wait_for_selector("#stage .pitch")
        check("account: a climb begun on another device continues here", THEMES[1] in await p.inner_text("#stage"))
        check("account: its timer keeps running from the other device's start", "0:15" in await p.inner_text("#timer"), await p.inner_text("#timer"))
        await p.wait_for_function("window.__fakeAccount.upserts.length > 0")
        ups = await p.evaluate("window.__fakeAccount.upserts")
        check("account: yesterday's climb from this browser is added to the account", any(u["day"] == 1 for u in ups), ups)
        check("account: the browser never sends a result itself", all("result" not in u for u in ups), ups)
        check("account: signed-in dot shows", await p.evaluate("document.querySelector('#accountBtn').classList.contains('signed-in')"))
        await climb(p, words=("PARK", "SIDE", "SHOW"), summit=("DEFENESTRATION",))
        await p.wait_for_function("window.__fakeAccount.rows.some(r => r.day === 2 && r.result)")
        row = await p.evaluate("window.__fakeAccount.rows.find(r => r.day === 2)")
        check("account: the finished climb is saved to the account", row["result"]["metres"] == (await save(p))["results"]["2"]["metres"], row["result"])
        await p.click("#accountBtn")
        check("account: dialog shows who is signed in", "climber@example.com" in await p.inner_text("#accountBody"))
        await p.screenshot(path=OUT / "account-signed-in.png")
        await p.click("#signOutBtn")
        await p.wait_for_selector("#emailInput")
        check("account: signing out keeps this browser's climbs", (await save(p))["results"].get("2"))
        check("no console errors with an account", not p.errors, p.errors)
        await p.context.close()

        p = await open_page(b, accounts_down=True)
        await p.click("#accountBtn")
        await p.wait_for_selector("text=can't be reached")
        check("account: if accounts are down the game still plays", await p.locator("#beginBtn").count() == 1)
        await p.context.close()

        # 18. Test mode: tomorrow's mountain now, on a throwaway save.
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, timezone_id="Australia/Perth")
        p = await ctx.new_page()
        await p.clock.install(time=DAY1)
        await p.route("**/data/freq.json?clock=*", lambda r: r.fulfill(status=204, headers={}))
        await p.route(re.compile(r"supabase"), lambda r: r.abort())
        await p.add_init_script("localStorage.setItem('ascent', JSON.stringify({version:3,games:{},attempts:{},results:{},seenHelp:true}))")
        await p.goto(URL + "?test"); await p.wait_for_selector("#stage .ready")
        check("test mode: plain ?test opens tomorrow's mountain", "No. 2" in await p.text_content("#dayLine"))
        check("test mode: says so", "Test mode" in await p.inner_text("#banner"))
        await begin(p); await word(p, "BALL")
        real = await save(p)
        check("test mode: real save untouched", not real["games"] and not real["attempts"])
        await p.click("#testReset"); await p.wait_for_selector("#stage .ready")
        check("test mode: can start again", await p.locator("#beginBtn").count() == 1)
        await p.goto(URL + "?test=1&at=23:59"); await p.wait_for_selector("#stage .ready")
        await p.clock.run_for(90_000)
        await p.wait_for_function("document.querySelector('#dayLine').textContent.includes('No. 2')", timeout=15000)
        check("test mode: midnight rollover can be watched", True)
        await ctx.close()

        # 19. Reduced motion.
        ctx = await b.new_context(reduced_motion="reduce")
        p = await ctx.new_page()
        await p.route(re.compile(r"supabase-js@|\.supabase\.co/"), lambda r: r.abort())
        await p.goto(URL); await p.wait_for_selector("#stage")
        dur = await p.evaluate("getComputedStyle(document.querySelector('.climber') || document.body).transitionDuration")
        check("reduced motion shortens transitions", dur in ("1e-05s", "0.00001s", "0s"), dur)
        await ctx.close()

        # 22. Accounts across two separate browser sessions (shared fake service).
        async def device(storage=None):
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, timezone_id="Australia/Perth")
            p = await ctx.new_page()
            p.errors = []
            p.on("pageerror", lambda e: p.errors.append(str(e)))
            p.on("console", lambda m: p.errors.append(m.text) if m.type == "error" and "Ascent finish-climb" not in m.text else None)
            await p.clock.install(time=DAY1)
            await p.route("**/data/freq.json?clock=*", lambda r: r.fulfill(status=204, headers={}))
            await p.route(re.compile(r"\.supabase\.co/"), lambda r: r.abort())
            await p.route(re.compile(r"supabase-js@"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=FAKE_SUPABASE))
            await p.add_init_script("window.__fakeShared = true;")
            seed = storage if storage is not None else seed_state()
            await p.add_init_script("if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');"
                + "".join(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});" for k, v in seed.items()) + "}")
            await p.goto(URL); await p.wait_for_selector("#stage .ready, #stage .result")
            return p
        async def account_form(p):
            await p.click("#accountBtn")
            await p.wait_for_selector("#passwordInput")
        async def submit_account(p, email, password, which):
            await p.fill("#emailInput", email); await p.fill("#passwordInput", password)
            await p.click(which)
            await p.wait_for_function("!document.querySelector('#signInForm') || document.querySelector('#signInMsg').textContent.length > 0 || !document.querySelector('#signInForm button:disabled')")
            await p.wait_for_timeout(100)
        FAKE_STATE.clear(); FAKE_STATE.update({"users": {}, "rows": [], "otp": [], "down": False})
        EMAIL, PW = "climber@example.com", "rope-and-carabiner"

        # A guest plays today's climb, and edits their save to claim a huge score.
        p1 = await device()
        await begin(p1)
        await climb(p1, words=("PENCIL", "PENCIL", "PENCIL", "PENCIL"), summit=("RAIN", "MUD", "SOIL"))
        honest = (await save(p1))["results"]["1"]["metres"]
        await p1.evaluate("""() => { const s = JSON.parse(localStorage.ascent);
            const g = s.games['1']; g.pitches.forEach(p => { p.points = 1000; p.guesses.forEach(x => x.points = 1000); });
            g.metres = 5000; s.results['1'].metres = 5000; s.results['1'].summit = true; localStorage.ascent = JSON.stringify(s); }""")
        await p1.reload(); await p1.wait_for_selector("#stage .result")
        check("guest: plays without an account", (await save(p1))["results"]["1"]["metres"] == 5000)

        await account_form(p1)
        await submit_account(p1, EMAIL, "short", "#registerBtn")
        check("register: a short password is explained", "at least 8 characters" in await p1.inner_text("#signInMsg"))
        await submit_account(p1, EMAIL, PW, "#registerBtn")
        await p1.wait_for_selector("text=confirm your account")
        check("register: asks to confirm the email", EMAIL in await p1.inner_text("#accountBody"))
        await p1.click("#otherEmailBtn"); await p1.wait_for_selector("#passwordInput")
        await submit_account(p1, EMAIL, PW, "#signInBtn")
        check("sign in: unconfirmed email is explained", "Confirm your email first" in await p1.inner_text("#signInMsg"))
        st = await p1.evaluate("fetch('/__fake/state').then(r => r.json())")
        st["users"][EMAIL]["confirmed"] = True
        await p1.evaluate("(st) => fetch('/__fake/state', { method: 'PUT', body: JSON.stringify(st) })", st)
        await submit_account(p1, EMAIL, PW, "#registerBtn")
        check("register: an existing account says to sign in", "already an account" in await p1.inner_text("#signInMsg"))
        await submit_account(p1, EMAIL, "wrong-password", "#signInBtn")
        check("sign in: a wrong password is explained", "don't match" in await p1.inner_text("#signInMsg"))
        await submit_account(p1, EMAIL, PW, "#signInBtn")
        await p1.wait_for_selector("#signOutBtn")
        check("sign in: signed in with email and password", EMAIL in await p1.inner_text("#accountBody"))
        await p1.wait_for_function("fetch('/__fake/state').then(r => r.json()).then(s => s.rows.some(r => r.day === 1 && r.result))")
        await p1.wait_for_function(f"JSON.parse(localStorage.ascent).results['1'].metres === {honest}")
        st = await p1.evaluate("fetch('/__fake/state').then(r => r.json())")
        row = next(r for r in st["rows"] if r["day"] == 1)
        check("migration: the guest climb was added to the account", row["game"] and row["result"])
        check("server scoring: the edited 5,000 m became the honest score", row["result"]["metres"] == honest and row["result"]["verified"], (row["result"]["metres"], honest))
        await p1.keyboard.press("Escape")
        await p1.reload(); await p1.wait_for_selector("#stage .result")
        await p1.wait_for_function("document.querySelector('#accountBtn').classList.contains('signed-in')")
        check("refresh: still signed in", True)
        check("refresh: this browser shows the server's score", f"{honest:,} m" in await p1.inner_text("#stage"))

        # A second device signs in and gets the same record.
        p2 = await device(storage=seed_state())
        check("second device: today's climb is open as a guest", await p2.locator("#beginBtn").count() == 1)
        await account_form(p2)
        await submit_account(p2, EMAIL, PW, "#signInBtn")
        await p2.wait_for_selector("#signOutBtn")
        await p2.keyboard.press("Escape")
        await p2.wait_for_selector("#stage .result", timeout=10000)
        check("sync: the second device shows the finished climb, no replay", await p2.locator("#beginBtn").count() == 0)
        await p2.click("[data-open=stats]")
        st2 = await p2.inner_text("#statsBody")
        check("sync: streak and personal best arrive on the second device", re.search(r"Streak\s*1\b", st2) and f"{honest:,}" in st2, st2[:200])
        await p2.keyboard.press("Escape")
        await p2.click("#accountBtn"); await p2.click("#signOutBtn")
        await p2.wait_for_selector("#passwordInput")
        check("sign out: back to guest, this browser keeps its copy", (await save(p2))["results"].get("1"))
        st = await p2.evaluate("fetch('/__fake/state').then(r => r.json())")
        st["down"] = True
        await p2.evaluate("(st) => fetch('/__fake/state', { method: 'PUT', body: JSON.stringify(st) })", st)
        await submit_account(p2, EMAIL, PW, "#signInBtn")
        check("network failure: explained, nothing breaks", "Couldn't reach the account service" in await p2.inner_text("#signInMsg"))
        check("no console errors on either device", not p1.errors and not p2.errors, p1.errors + p2.errors)
        await p1.context.close(); await p2.context.close()

        # 20. Guess feedback: checking, reveal, score, climb, next pitch.
        async def slow(route):
            await asyncio.sleep(1.5)
            await route.continue_()
        for label, opts in (("desktop", {"width": 1440, "height": 900}), ("phone", {"width": 390, "height": 844})):
            ctx = await b.new_context(viewport={"width": opts["width"], "height": opts["height"]}, timezone_id="Australia/Perth",
                                      has_touch=label == "phone", is_mobile=label == "phone")
            p = await ctx.new_page()
            p.errors = []
            p.on("pageerror", lambda e: p.errors.append(str(e)))
            p.on("console", lambda m: p.errors.append(m.text) if m.type == "error" else None)
            await p.clock.install(time=DAY1)
            await p.route("**/data/freq.json?clock=*", lambda r: r.fulfill(status=204, headers={}))
            await p.route(re.compile(r"\.supabase\.co/"), lambda r: r.abort())
            await p.route(re.compile(r"supabase-js@"), lambda r: r.fulfill(status=200, content_type="text/javascript", body=FAKE_SUPABASE))
            await p.route("**/data/assoc.json", slow)
            await p.add_init_script("if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s','1'); localStorage.setItem('ascent', JSON.stringify({version:3,games:{},attempts:{},results:{},seenHelp:true})); }")
            await p.goto(URL); await p.wait_for_selector("#stage .ready")
            await begin(p)
            await p.fill("#guess", "LIGHT"); await p.press("#guess", "Enter")
            check(f"fx {label}: the word shows as checking at once", await p.locator("#pendingCard").count() == 1 and await p.evaluate("document.body.dataset.phase") == "judging")
            await p.press("#guess", "Enter"); await p.press("#guess", "Enter")
            check(f"fx {label}: the climb button is locked while checking", await p.locator("#climbBtn").is_disabled())
            await p.wait_for_function("document.body.dataset.phase !== 'judging'")
            check(f"fx {label}: the checking card is replaced by the result", await p.locator("#pendingCard").count() == 0 and await p.locator(".guess-card.reveal.fit").count() == 1)
            await settle(p)
            g = (await save(p))["games"]["1"]
            check(f"fx {label}: Enter pressed while checking scored nothing extra", len(g["pitches"][0]["guesses"]) == 1, g["pitches"][0])
            mismatches = []
            async def compare(where):
                await settle(p)
                g = (await save(p))["games"]["1"]
                shown = int((await p.inner_text("#altNum")).replace(",", ""))
                meter = int(await p.get_attribute("#altMeter", "aria-valuenow"))
                if shown != g["metres"] or meter != g["metres"]:
                    mismatches.append((where, shown, meter, g["metres"]))
                cards = await p.evaluate("[...document.querySelectorAll('.guess-card .g-pts')].map(e => e.textContent)")
                pts = [f"+{x['points']:,} m" for x in (g['pitches'][g['current'] - 1]['guesses'] if 0 < g['current'] <= 4 else [])]
                if g["current"] <= 4 and cards and cards != pts:
                    mismatches.append((where, cards, pts))
            await compare("pitch 1")
            check(f"fx {label}: the zone changes with the pitch", await p.evaluate("document.body.dataset.zone") == "forest")
            for k, w in enumerate(("GREEN", "ROOM", "MATE"), start=2):
                await p.wait_for_function("document.body.dataset.phase === 'playing'", timeout=10000)
                await word(p, w)
                await compare(f"pitch {k}")
            await p.wait_for_function("document.body.dataset.phase === 'playing'", timeout=10000)
            await word(p, "PETRICHOR")
            await compare("summit")
            await p.screenshot(path=OUT / f"fx-{label}-summit.png")
            await p.click("#nextBtn"); await p.wait_for_selector("#stage .result")
            g = (await save(p))["games"]["1"]
            text = await p.inner_text("#stage")
            check(f"fx {label}: displayed height matches the game after every pitch", not mismatches, mismatches)
            check(f"fx {label}: results show the saved height", f"{g['metres']:,} m" in text, g["metres"])
            check(f"fx {label}: no console errors through all five pitches", not p.errors, p.errors)
            await ctx.close()

        # 21. Refused words get quick feedback; reduced motion shows end states at once.
        p = await open_page(b)
        await begin(p)
        await word(p, "qzxwv")
        dur = await p.evaluate("getComputedStyle(document.querySelector('#guess')).animationDuration")
        check("fx: a refused word gets a quick shake", dur == "0.18s", dur)
        await p.context.close()
        ctx = await b.new_context(reduced_motion="reduce", timezone_id="Australia/Perth")
        p = await ctx.new_page()
        await p.clock.install(time=DAY1)
        await p.route("**/data/freq.json?clock=*", lambda r: r.fulfill(status=204, headers={}))
        await p.route(re.compile(r"supabase"), lambda r: r.abort())
        await p.add_init_script("localStorage.setItem('ascent', JSON.stringify({version:3,games:{},attempts:{},results:{},seenHelp:true}))")
        await p.goto(URL); await p.wait_for_selector("#stage .ready")
        await begin(p)
        await p.fill("#guess", "LIGHT"); await p.press("#guess", "Enter")
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        g = (await save(p))["games"]["1"]
        check("reduced motion: no animation is pending", await p.evaluate("document.body.dataset.fx") != "busy")
        check("reduced motion: the height shows at once", (await p.inner_text("#altNum")).replace(",", "") == str(g["metres"]))
        check("reduced motion: the score shows at once", f"+{g['pitches'][0]['points']} m" in await p.inner_text("#stage"))
        await ctx.close()

        await b.close()
    srv.shutdown()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed. Screenshots in {OUT}")
    sys.exit(0 if passed == len(results) else 1)

if __name__ == "__main__":
    asyncio.run(main())
