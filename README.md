# Ascent

A daily word climb. One mountain a day, the same for everyone, changing at midnight Perth time.

**Play:** https://liam-ohalloran.github.io/Ascent/ (also https://ascent-ruddy-pi.vercel.app/)

## How to play

One climb a day, the same mountain for everyone. The game never ends, only the day's climb does.

1. **Today's climb.** Open Ascent to see today's mountain and its five themed pitches: The Foothills, The Forest, The Frozen Ridge, The Storm Wall, The Summit.
2. **Begin climb.** Starts a **6-minute** timer. There's one scored climb a day and no restarts.
3. **Pitches 1 to 4.** Type any word that associates with every clue. Synonyms (QUIET + CALM → STILL or TRANQUIL), opposites (BIG + LARGE → SMALL), related meanings, shared context (QUEEN + KING → CROWN), common phrases and compound words all count. No letter count. Two tries, the better one counts, and the second is worth 70%.
4. **The summit word.** An uncommon word with three definitions, broad to clear: 1,000, 700 or 400 m.
5. **Results.** These become the day's screen, with a countdown to the next mountain at midnight Perth time.

### Height (deterministic: same puzzle + same word = same height)

A link pitch scores three things separately: **validity** (is it a real word?), **association** (how strongly it links each clue) and **rarity** (how uncommon the word is in written English, from the `wordfreq` corpus, not from player answers). Height = 1,000 m × association × rarity, never below the foothold. Strong links (synonym, opposite, phrase, compound, hand-checked context) count fully; looser ones (related meaning, a word in the clue's definition, an unverified compound) count 60%. The pitch's own answer and listed alternatives always count fully.

| Your word | Height, first try |
|---|---|
| Strongly links every clue | 600 to 1,000 m (rarer words keep more) |
| Links every clue, some loosely | 360 to 1,000 m |
| Links some clues | that share of it, e.g. 300 to 500 m for one of two |
| Close to the best word (compounds with it, or shares its root) | 200 m |
| Any other real English word | 100 m |
| Not a word we know (typo, gibberish) | refused, no try used |

Summit-word misses earn 100 m, or 200 m if close. The **summit is 4,500 m**: finishing all five pitches with common words lands around 3,000 to 3,800 m, so reaching it takes rare, exact play. There is no hint button, removed at the owner's request.

### Days, streaks and stats

- **Reset:** midnight in Australia/Perth (UTC+8, no daylight saving), for every player. Day *n* is the *n*th Perth calendar day since 2026-10-13. A unit test walks 730 midnights to prove no day is skipped or repeated.
- **Daily identifier:** the puzzle number, derived from the Perth date, so it's the same on every device. Puzzles loop once the list runs out.
- **One attempt:** "Begin climb" saves the start time. The deadline is always start + 6 minutes (a stored deadline is never trusted), so refreshing can't reset it. Closing the page and coming back late ends the climb at its deadline. A finished day shows only its results. `?day=` links can't open a climb.
- **Across midnight:** a climb under way keeps its 6 minutes and is saved to the day it began. The new mountain then appears automatically.
- **Streak:** +1 for each Perth day whose climb is finished (all five pitches or the timer ran out). A day without one resets it. Revisiting results never adds to it.
- **Stats:** current and longest streak, climbs begun and finished, summits, best and average height, average pitches, recent climbs, and a calendar of finished, summit, missed and unfinished days. Past days can be viewed, not replayed. Missed days can reveal their answers on request.
- **Share:** `Ascent #n, name / Height / Pitches + colour row / Time / Summit / Streak / link`. No words or answers.

### Test mode

Add `?test` to the link to play tomorrow's mountain now. `?test=5` plays No. 5, and `&at=23:58` starts at that Perth time so you can watch midnight pass. Test mode uses a throwaway save in that tab only, turns accounts off, and never touches real streaks or stats. Use the banner to start again or go back to today.

### Accounts (optional)

The person icon opens sign-in. It's an emailed link (Supabase Auth), so there's no password. Signing in saves each day's climb to your account, so your streak, stats and calendar follow you to other devices. A climb begun on one device carries on, with the same timer, on another. Climbs already finished in the browser are added on first sign-in. Signing out keeps the browser's copy. If accounts can't be reached, the game plays exactly as before and syncs next time.

The account table (`climbs`, one row per player per day) enforces what the browser can't:

- **Row-level security:** each player can read and write only their own rows.
- **Start time:** stamped by the server and can't be moved later, so the 6-minute limit can't be stretched by syncing.
- **Results:** a finished result is write-once and can't be edited.
- **Deletes and future days:** rows can't be deleted, so a day can't be wiped and replayed, and future days can't be opened.
- **Timer:** a climb more than 7 minutes past its start can only be closed, not continued.

### What the browser alone can and can't protect

Without an account, everything is enforced in the browser. That stops refreshes, double submits, URL tricks and changed device clocks (time comes from the server's `Date` header). It **can't** stop someone who edits or clears their local storage, uses a private window, or plays on a second device. Signed-in players get the server-side rules above. Scores are still computed in the browser, so a determined player could submit an invented height. A public leaderboard would need scoring moved to the server.

## Architecture

Static site (no build step, plain ES modules) on GitHub Pages and Vercel, plus one optional Vercel Function.

```
index.html               page shell, dialogs, labelled word field
css/style.css            all styling: phone first, two columns from 900px, light and dark
js/rules.js              every rule: themes, timer, height ladder, summit, input (pure, unit tested)
js/daily.js              Perth date keys, server-time sync, puzzle selection
js/puzzles.js            the daily puzzles, mountain names, validation
js/game.js               game loop with explicit phases, rendering, input, dialogs
js/judge.js              dictionary judge, optional AI judge, error texts
js/stats.js              versioned save, validation, migration, streaks, account merge
js/account.js            optional sign-in (Supabase, email link) and sync
js/climb.js              mountain, rope, route labels, climber
js/share.js              spoiler-free share text, share sheet or clipboard
api/score.js             Vercel Function: AI judge (off until AI Gateway is active)
data/assoc.json          generated: words that link each clue, and how (link type)
data/freq.json           generated: how common each word is
data/words.txt           generated: 57,000 real words (typos are refused, real words earn a foothold)
scripts/build_links.py   builds the three data files
scripts/phrase_links.json  two-word phrases and excluded name fragments
scripts/context_links.json hand-checked context links WordNet doesn't record
scripts/puzzle_report.mjs  per-pitch link types and alternative answers
tests/unit/              node:test unit tests (rules, dates, storage, judge, API)
tests/e2e/journeys.py    Playwright journeys and layout checks
```

## Judging

1. **Dictionary.** `data/assoc.json` lists, for each clue, the words that associate with it and how: compound, phrase, synonym, opposite, related meaning, defined-by, or hand-checked context. It is built by `scripts/build_links.py` from WordNet, English word frequencies (`wordfreq`), `scripts/phrase_links.json` and `scripts/context_links.json`. A linking word must be a real, common-noun WordNet entry, a closed compound must itself be a dictionary word, and a word containing the clue (SUNSHINE for SUN) doesn't count, so string accidents like CAR + PET (carpet) or HOT + SNAPS (snapshot) no longer score as full links. Plurals count as their singular and score with the singular's rarity, so BALLS can't beat BALL. Words with no frequency data get no rarity bonus. This is deterministic, so every player gets the same verdict.
2. **AI judge (optional).** `api/score.js` asks a model through Vercel AI Gateway about clues the dictionary didn't link, and rates summit near-misses. It is **switched off** (`JUDGE_ENABLED = false` in `js/judge.js`) because AI Gateway needs a credit card on the Vercel account. To turn it on, add the card in Vercel and set the flag to `true`.
   - Inputs are A–Z words only, so a guess can't carry instructions. Replies are parsed and validated field by field, and only explicit `true` counts.
   - CORS allows only the game's own sites. Each IP gets 30 calls a minute. Errors return a plain code, and details go only to the server log.
3. **Failures never cost a try.** If the word list or the judge can't be reached, the guess isn't stored, the word stays in the box, and the player is told to press Enter again.

## Saving

`localStorage["ascent"]`, version 3: the day's climb (`games`), when each climb began (`attempts`), and finished results (`results`, written once per day). It is validated on load. A damaged entry is dropped on its own and a notice is shown. Older saves (`ascent:v1`, `ascent:v2`) are migrated, keeping results and streaks, and left in place. If storage is blocked, the game runs in memory and says so. Other tabs' saves are picked up through the `storage` event.

## Adding puzzles

Append to `js/puzzles.js` (give the mountain a name that gives nothing away). Mix association types: the tests allow at most two compound or phrase-only pitches per mountain and require each two-clue pitch to have more than one fair answer. List other fair answers in `alt`. Then rebuild the word data and check:

```
pip install wordfreq nltk && python3 -m nltk.downloader wordnet
npm run build:words           # prints any intended link no rule could justify
node scripts/puzzle_report.mjs # link types and alternatives per pitch
npm test                       # validates, checks variety, locks published puzzles
```

An intended link the rules can't justify needs a fair entry in `scripts/context_links.json`. Published puzzles are locked by hash in `tests/unit/puzzles.test.js`: never edit one that has been played.

Puzzles loop once the list runs out. Each day maps by number, never by load order.

## Tests

```
npm test            # 87 unit tests, no network
npm run test:tz     # date tests under Los Angeles and Kiribati device clocks
npm run test:e2e    # 152 browser checks: the full daily cycle, timer, refresh, rollover, calendar, layouts 320–1440, light/dark
```

The e2e run needs `pip install playwright && python3 -m playwright install chromium`. It freezes the clock and blocks the time sync, so results don't depend on today's date or the network. Screenshots go to `tests/e2e/out/`. Accounts are tested against a stand-in client (`tests/e2e/fake_supabase.js`), and the real Supabase project is blocked during runs.

## Deployment

Pushing to `main` deploys both GitHub Pages (static files) and Vercel (static files plus `api/score.js`). The GitHub Pages site calls the function on the Vercel production URL. Vercel deployments call their own `/api/score`. Supabase is project `smkxqwgikxpiaptyszrd` (Sydney). Its publishable key is in `js/account.js` by design, and row-level security protects the data. Its Auth settings must list both sites as redirect URLs. No secrets exist in the repo: the function authenticates to AI Gateway with Vercel's OIDC token.

**Design:** [Figma file](https://www.figma.com/design/tIzXwD9WkiC6m9KrQ1w3i5) (earlier glacier palette, layout still current).
