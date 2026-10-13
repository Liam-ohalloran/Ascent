# Ascent

A daily word climb. One mountain a day, the same for everyone, changing at midnight Perth time.

**Play:** https://liam-ohalloran.github.io/Ascent/ (also https://ascent-ruddy-pi.vercel.app/)

## How to play

- **Pitches 1 to 4.** Type any word that fits between the clues (SUN + FIRE → LIGHT, or STONE). No letter count, no single right answer.
- **Height = fit × rarity.** A pitch is worth up to 1,000 m. Each clue your word genuinely links earns its share. Rarer words keep more of it: a very common word keeps 60%, a rare one 100%.
- **Two tries per pitch.** The better one counts. The second try is worth 70%. After a partial hold you can keep it and move on.
- **The rope.** The intended link word becomes the first clue of the next pitch.
- **Summit.** An uncommon word with three definitions, broad to clear. Exact word: 1,000 / 700 / 400 m. With the AI judge on, close guesses are flagged and the closest can earn up to 300 m.
- **Maximum:** 5,000 m. Tiers every 1,000 m: Base camp, Treeline, Snowline, Ridge, High camp, and Summit (summit word plus at least 4,000 m).

There is no hint button. It was removed at the owner's request.

## Architecture

Static site (no build step, plain ES modules) on GitHub Pages and Vercel, plus one optional Vercel Function.

```
index.html               page shell, dialogs, labelled word field
css/style.css            all styling: phone first, two columns from 900px, light and dark
js/rules.js              every scoring rule and input normalisation (pure, unit tested)
js/daily.js              Perth date keys, server-time sync, puzzle selection
js/puzzles.js            the daily puzzles, mountain names, validation
js/game.js               game loop with explicit phases, rendering, input, dialogs
js/judge.js              dictionary judge, optional AI judge, error texts
js/stats.js              versioned save, validation, migration, streaks
js/climb.js              mountain, rope, route labels, climber
js/share.js              spoiler-free share text, share sheet or clipboard
api/score.js             Vercel Function: AI judge (off until AI Gateway is active)
data/links.json          generated: words that link each clue
data/freq.json           generated: how common each word is
scripts/build_links.py   builds the two data files
scripts/phrase_links.json  two-word phrases and excluded name fragments
tests/unit/              node:test unit tests (rules, dates, storage, judge, API)
tests/e2e/journeys.py    Playwright journeys and layout checks
```

## Judging

1. **Dictionary.** `data/links.json` lists words that form a real compound or common phrase with each clue. It is built from English word frequencies (`wordfreq`) plus hand-written phrases. Name fragments such as BALLINA or CASTLETON are excluded. Plurals count as their singular and score with the singular's rarity, so BALLS can't beat BALL. This is deterministic, so every player gets the same verdict.
2. **AI judge (optional).** `api/score.js` asks a model through Vercel AI Gateway about clues the dictionary didn't link, and rates summit near-misses. It is **switched off** (`JUDGE_ENABLED = false` in `js/judge.js`) because AI Gateway needs a credit card on the Vercel account. To turn it on, add the card in Vercel and set the flag to `true`.
   - Inputs are A–Z words only, so a guess can't carry instructions. Replies are parsed and validated field by field, and only explicit `true` counts.
   - CORS allows only the game's own sites. Each IP gets 30 calls a minute. Errors return a plain code, and details go only to the server log.
3. **Failures never cost a try.** If the word list or the judge can't be reached, the guess isn't stored, the word stays in the box, and the player is told to press Enter again.

## Days, saving and streaks

- **Day boundary:** midnight in Australia/Perth (UTC+8, no daylight saving), for every player wherever they are. Puzzle No. 1 is 2026-10-13.
- **Clock:** the game reads the server's `Date` header from a small same-origin request, so changing the device clock doesn't unlock future puzzles. If that request fails, it falls back to the device clock. Future days can't be opened by URL.
- **Rollover:** at Perth midnight an untouched or finished climb moves to the new mountain. A climb in progress stays on screen with a "new mountain is ready" banner. **A climb counts for stats only if it's finished on its own Perth day.** Finishing after midnight keeps it as a replay.
- **Save:** `localStorage["ascent"]`, version 3. It is validated on load: a damaged game is dropped on its own and the player sees a notice. Older saves (`ascent:v1`, `ascent:v2`) are migrated with their results, streaks and tutorial flag, and left in place. If storage is blocked, the game runs in memory and says so. Other tabs' saves are picked up through the `storage` event.
- **Stats:** derived from stored results (one per day, never overwritten). Includes streak, best streak, best and average height, summit rate and average tries. Replays never count.
- **Note:** local storage can be edited by anyone, so none of this should back a competitive leaderboard.

## Adding puzzles

Append to `js/puzzles.js` (give the mountain a name that gives nothing away), then rebuild the word data:

```
pip install wordfreq
npm run build:words
npm test        # checks every puzzle validates
```

Puzzles loop once the list runs out. Each day maps by number, never by load order.

## Tests

```
npm test            # 43 unit tests, no network
npm run test:tz     # date tests under Los Angeles and Kiribati device clocks
npm run test:e2e    # 107 browser checks: journeys, failures, refresh, rollover, layouts 320–1440, light/dark
```

The e2e run needs `pip install playwright && python3 -m playwright install chromium`. It freezes the clock and blocks the time sync, so results don't depend on today's date or the network. Screenshots go to `tests/e2e/out/`.

## Deployment

Pushing to `main` deploys both GitHub Pages (static files) and Vercel (static files plus `api/score.js`). The GitHub Pages site calls the function on the Vercel production URL. Vercel deployments call their own `/api/score`. No secrets exist in the repo: the function authenticates to AI Gateway with Vercel's OIDC token.

**Design:** [Figma file](https://www.figma.com/design/tIzXwD9WkiC6m9KrQ1w3i5) (earlier glacier palette, layout still current).
