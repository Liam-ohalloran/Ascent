"""End-to-end journeys for Ascent in a real browser (Playwright, Chromium).

Runs against a local static server. The clock is frozen at a known instant and
the server-time sync is blocked, so every run sees the same daily puzzle.

  pip install playwright && python3 -m playwright install chromium
  python3 tests/e2e/journeys.py            # screenshots go to tests/e2e/out/
"""
import asyncio, functools, http.server, json, pathlib, sys, threading
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).with_name("out")
OUT.mkdir(exist_ok=True)
PORT = 8790
URL = f"http://localhost:{PORT}/"
DAY1 = "2026-10-13T04:00:00Z"   # noon in Perth, puzzle No. 1
DAY3 = "2026-10-15T04:00:00Z"   # puzzle No. 3

results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

async def open_page(browser, when=DAY1, tz="Australia/Perth", width=390, height=844, scheme="light", storage=None, help_seen=True):
    ctx = await browser.new_context(viewport={"width": width, "height": height}, timezone_id=tz, color_scheme=scheme)
    page = await ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" else None)
    await page.clock.install(time=when)
    # Block the server-time sync so the frozen clock decides the day.
    await page.route("**/data/freq.json?clock=*", lambda r: r.fulfill(status=204, headers={}))
    seed = storage or ({"ascent": json.dumps({"version": 3, "games": {}, "results": {}, "seenHelp": True})} if help_seen else {})
    if seed:
        await page.add_init_script(
            "if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');"
            + "".join(f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});" for k, v in seed.items()) + "}")
    await page.goto(URL)
    await page.wait_for_selector("#stage .pitch, #stage .result, #stage .error-state")
    return page

async def word(page, w):
    await page.fill("#guess", w)
    await page.press("#guess", "Enter")
    await page.wait_for_function("document.body.dataset.phase !== 'judging'")

async def save(page):
    return await page.evaluate("JSON.parse(localStorage.getItem('ascent'))")

async def next_step(page):
    await page.click("#nextBtn")

async def play_to_summit(page, words=("LIGHT", "GREEN", "ROOM", "MATE")):
    for w in words:
        await word(page, w)
        if await page.locator("#keepBtn").count():
            await page.click("#keepBtn")
        await next_step(page)

async def main():
    srv = serve()
    async with async_playwright() as pw:
        b = await pw.chromium.launch()

        # 1. New player: onboarding shows once, practice doesn't touch the game.
        p = await open_page(b, help_seen=False)
        check("onboarding opens on first visit", await p.evaluate("document.querySelector('#help').open"))
        await p.fill("#tryInput", "stone"); await p.press("#tryInput", "Enter")
        await p.wait_for_function("document.querySelector('#tryResult').textContent.length > 0")
        check("practice box scores a word", "STONE fits both" in await p.inner_text("#tryResult"), await p.inner_text("#tryResult"))
        await p.screenshot(path=OUT / "01-onboarding.png")
        await p.click("#help [data-close]")
        s = await save(p)
        check("practice didn't save a game", not s["games"], s["games"])
        await p.reload(); await p.wait_for_selector("#stage .pitch")
        check("onboarding not shown again", not await p.evaluate("document.querySelector('#help').open"))
        await p.screenshot(path=OUT / "02-first-pitch.png")
        await p.context.close()

        # 2. Input validation never consumes a try.
        p = await open_page(b)
        cases = [("", "Type a word first"), ("   ", "Type a word first"), ("light2", "Use letters only"),
                 ("sun", "one of the clues"), ("a", "too short"), ("supercalifragilistic", "under 17")]
        for text, msg in cases:
            await p.fill("#guess", text); await p.press("#guess", "Enter")
            got = await p.inner_text("#formMsg")
            check(f"invalid input {text!r} explained", msg in got, got)
        s = await save(p)
        check("invalid input used no tries", not s["games"].get("1"), s["games"])
        await p.screenshot(path=OUT / "03-invalid-input.png")

        # 3. Partial link, keep it, refresh keeps progress.
        await word(p, "spot")
        card = await p.inner_text(".guess-card")
        check("partial link explained", "Holds on SUN" in card and "+370 m" in card, card)
        await p.screenshot(path=OUT / "04-partial.png")
        await word(p, "spot")
        check("duplicate word refused", "already tried" in await p.inner_text("#formMsg"))
        await p.click("#keepBtn")
        check("keep moves to feedback", await p.evaluate("document.body.dataset.phase") == "feedback")
        await p.screenshot(path=OUT / "05-pitch-done.png")
        await p.reload(); await p.wait_for_selector("#stage .pitch")
        check("refresh resumes on pitch 2", "Pitch 2" in await p.inner_text("#pitchTitle"))
        check("refresh keeps the height", (await p.inner_text("#altNum")) == "370", await p.inner_text("#altNum"))
        await p.context.close()

        # 4. Rapid repeated submits record one guess.
        p = await open_page(b)
        await p.fill("#guess", "STONE")
        await p.evaluate("""() => { const f = document.querySelector('#entryForm');
            f.requestSubmit(); f.requestSubmit(); document.querySelector('#climbBtn').click(); f.requestSubmit(); }""")
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        g = (await save(p))["games"]["1"]
        check("rapid submits record exactly one guess", len(g["pitches"][0]["guesses"]) == 1 and g["current"] == 1, g["pitches"][0])
        await p.click("#nextBtn"); await p.click("#nextBtn") if await p.locator("#nextBtn").count() else None
        g = (await save(p))["games"]["1"]
        check("double-click continue doesn't skip a pitch", g["current"] == 1, g["current"])
        await p.context.close()

        # 5. Word list unavailable: clear error, try not used, word kept, retry works.
        p = await open_page(b)
        await p.evaluate("caches && 0")
        await p.route("**/data/links.json", lambda r: r.abort())
        await p.evaluate("location.reload()")
        await p.wait_for_selector("#stage .pitch")
        await word(p, "STONE")
        msg = await p.inner_text("#formMsg")
        check("data failure shows a clear error", "didn't load" in msg and "wasn't used" in msg, msg)
        check("data failure keeps the typed word", await p.input_value("#guess") == "STONE")
        s = await save(p)
        check("data failure used no try", not (s["games"].get("1") or {}).get("pitches", [{}])[0].get("guesses"), s["games"])
        await p.screenshot(path=OUT / "06-network-error.png")
        await p.unroute("**/data/links.json")
        await p.press("#guess", "Enter")
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        check("retry after failure scores once", len((await save(p))["games"]["1"]["pitches"][0]["guesses"]) == 1)
        await p.context.close()

        # 6. Refresh while a guess is being checked: nothing is scored twice.
        p = await open_page(b)
        async def slow(route):
            await asyncio.sleep(1.5)
            await route.continue_()
        await p.route("**/data/links.json", slow)
        await p.evaluate("location.reload()")
        await p.wait_for_selector("#stage .pitch")
        await p.fill("#guess", "STONE"); await p.press("#guess", "Enter")
        check("button shows checking state", "Checking" in await p.inner_text("#climbBtn"))
        await p.reload(); await p.wait_for_selector("#stage .pitch")
        s = await save(p)
        check("unchecked guess dropped on refresh", not (s["games"].get("1") or {}).get("pitches", [{}])[0].get("guesses"), s["games"].get("1"))
        await p.context.close()

        # 7. Full climb to the summit, refresh, share.
        p = await open_page(b, width=1440, height=900)
        await play_to_summit(p)
        await word(p, "rain")
        check("summit miss reveals the next clue", await p.locator(".def:not(.locked)").count() == 2)
        await p.screenshot(path=OUT / "07-summit.png")
        await word(p, "petrichor")
        await p.screenshot(path=OUT / "08-summit-reached.png")
        await next_step(p)
        text = await p.inner_text("#stage")
        check("victory screen", "Summit reached" in text and "Kestrel Spire" in text, text[:120])
        await p.screenshot(path=OUT / "09-results-desktop.png")
        s = await save(p)
        r = s["results"].get("1")
        check("result recorded once with stats", r and r["summit"] and r["tries"] == 6 and r["linked"] == 4, r)
        await p.reload(); await p.wait_for_selector("#stage .result")
        shown = await p.inner_text("#altNum")
        check("results survive refresh", "Summit reached" in await p.inner_text("#stage") and shown == f"{r['metres']:,}", (shown, r["metres"]))
        check("result not recorded twice", (await save(p))["results"]["1"] == r)
        await p.context.grant_permissions(["clipboard-read", "clipboard-write"])
        await p.click("#shareBtn")
        clip = await p.evaluate("navigator.clipboard.readText()")
        check("share text is spoiler-free", clip.startswith("Ascent No. 1") and "PETRICHOR" not in clip and "LIGHT" not in clip, clip)
        await p.click("[data-open=stats]")
        await p.screenshot(path=OUT / "10-stats.png")
        check("stats show the climb", "Climbs" in await p.inner_text("#statsBody"))
        check("no console errors in full climb", not p.errors, p.errors)
        await p.context.close()

        # 8. Failing the summit never claims success.
        p = await open_page(b)
        await play_to_summit(p)
        for w in ("rain", "mud", "dew"):
            await word(p, w)
        await next_step(p)
        text = await p.inner_text("#stage")
        check("failed summit shows 'Climb over'", "Climb over" in text and "Summit reached" not in text, text[:80])
        check("failed summit tier isn't Summit", "Summit" != await p.inner_text("#altTier"))
        await p.screenshot(path=OUT / "11-climb-over.png")
        await p.context.close()

        # 9. Replaying an old mountain doesn't touch today or the stats.
        p = await open_page(b, when=DAY3)
        await p.goto(URL + "?day=1"); await p.wait_for_selector("#stage .pitch")
        check("replay is labelled", "Replay" in await p.inner_text("#dayLine"))
        await play_to_summit(p)
        await word(p, "petrichor"); await next_step(p)
        s = await save(p)
        check("replay not counted in stats", "1" not in s["results"], s["results"])
        check("today's game untouched by replay", "3" not in s["games"])
        await p.goto(URL + "?day=99"); await p.wait_for_selector("#stage .pitch")
        check("future puzzles can't be opened by URL", "No. 3" in await p.inner_text("#dayLine"))
        await p.click("[data-open=archive]")
        check("archive lists real days only", await p.locator(".arch").count() == 3)
        await p.screenshot(path=OUT / "12-archive.png")
        await p.context.close()

        # 10. Damaged and old saves.
        p = await open_page(b, storage={"ascent": "{oops"})
        check("damaged save shows a notice", "couldn't be read" in await p.inner_text("#banner"))
        if await p.evaluate("document.querySelector('#help').open"):
            await p.click("#help [data-close]")
        await word(p, "light")
        check("game still playable after damaged save", await p.evaluate("document.body.dataset.phase") == "feedback")
        await p.context.close()
        p = await open_page(b, storage={"ascent:v1": json.dumps({"games": {}, "results": {"1": {"metres": 3000, "summit": True, "tier": "Ridge"}}, "seenHelp": True})}, help_seen=False)
        check("v1 player isn't shown the tutorial again", not await p.evaluate("document.querySelector('#help').open"))
        await p.click("[data-open=stats]")
        check("v1 stats carried over", "1" in await p.inner_text("#statsBody") and "Climbs" in await p.inner_text("#statsBody"))
        await p.context.close()

        # 11. Same instant, same puzzle in every timezone.
        seen = set()
        for tz in ("Australia/Perth", "America/Los_Angeles", "Europe/London", "Pacific/Kiritimati"):
            p = await open_page(b, when="2026-10-13T20:00:00Z", tz=tz)
            import re
            seen.add(re.search(r"No\. \d+", await p.inner_text("#dayLine")).group(0))
            await p.context.close()
        check("every timezone gets the same mountain", seen == {"No. 2"}, seen)

        # 12. Midnight rollover moves an untouched game to the new day.
        p = await open_page(b, when="2026-10-13T15:59:50Z")
        check("before midnight: No. 1", "No. 1" in await p.inner_text("#dayLine"))
        await p.clock.run_for(15000)
        await p.wait_for_function("document.querySelector('#dayLine').textContent.includes('No. 2')", timeout=5000)
        check("after Perth midnight: No. 2", "No. 2" in await p.inner_text("#dayLine"))
        await p.context.close()

        # 13. Keyboard only.
        p = await open_page(b, width=1024, height=768)
        await p.keyboard.press("Tab")
        for _ in range(8):
            if await p.evaluate("document.activeElement.id") == "guess":
                break
            await p.keyboard.press("Tab")
        check("Tab reaches the word field", await p.evaluate("document.activeElement.id") == "guess")
        await p.keyboard.type("stone"); await p.keyboard.press("Enter")
        await p.wait_for_function("document.body.dataset.phase === 'feedback'")
        check("next button gets focus after a pitch", await p.evaluate("document.activeElement.id") == "nextBtn")
        await p.keyboard.press("Enter")
        check("Enter continues to pitch 2", "Pitch 2" in await p.inner_text("#pitchTitle"))
        check("focus returns to the word field", await p.evaluate("document.activeElement.id") == "guess")
        await p.context.close()

        # 14. Layout at every test width, light and dark.
        for w, h in ((320, 640), (375, 667), (390, 844), (430, 932), (768, 1024), (1024, 768), (1440, 900)):
            for scheme in ("light", "dark"):
                p = await open_page(b, width=w, height=h, scheme=scheme)
                await word(p, "spot")
                over = await p.evaluate("document.documentElement.scrollWidth - innerWidth")
                inp = await p.locator("#guess").bounding_box()
                kb = await p.locator("#keyboard").bounding_box()
                visible = inp and inp["y"] + inp["height"] <= h and inp["y"] >= 0
                check(f"{w}x{h} {scheme}: no sideways scroll", over <= 0, over)
                check(f"{w}x{h} {scheme}: word field on screen", visible, inp)
                check(f"{w}x{h} {scheme}: keyboard doesn't cover the field", not kb or kb["y"] >= inp["y"] + inp["height"] - 1, (inp, kb))
                small = await p.evaluate("""[...document.querySelectorAll('button:not([tabindex="-1"])')].filter(b => b.offsetParent)
                    .map(b => b.getBoundingClientRect()).filter(r => r.height < 40 || r.width < 40).length""")
                check(f"{w}x{h} {scheme}: tap targets at least 40px", small == 0, small)
                await p.screenshot(path=OUT / f"layout-{w}-{scheme}.png")
                await p.context.close()

        # 15. Reduced motion is respected.
        ctx = await b.new_context(reduced_motion="reduce")
        p = await ctx.new_page(); await p.goto(URL); await p.wait_for_selector("#stage")
        dur = await p.evaluate("getComputedStyle(document.querySelector('.climber') || document.body).transitionDuration")
        check("reduced motion shortens transitions", dur in ("1e-05s", "0.00001s", "0s"), dur)
        await ctx.close()

        await b.close()
    srv.shutdown()
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed. Screenshots in {OUT}")
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
