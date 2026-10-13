# Ascent

A daily word climb. One mountain a day, the same for everyone.

**Play:** https://liam-ohalloran.github.io/Ascent/ or https://ascent-ruddy-pi.vercel.app/

**Design:** [Figma file](https://www.figma.com/design/tIzXwD9WkiC6m9KrQ1w3i5)

## How it works

- **Pitches 1 to 4:** type any word that links the clues (SUN + FIRE → LIGHT). No letter count is shown.
- **Fit and rarity decide your height.** A pitch is worth up to 1,000 m. Fit: each clue your word genuinely links earns its share, so the best words sit right between all the clues (TORCH for SUN + FIRE only links FIRE, so half). Rarity: niche words climb higher. A very common word keeps 60% of its height and a rare one keeps 100% (STONE beats LIGHT for SUN + FIRE). Any word can be guessed.
- **Two tries.** You keep the better one, and the second is worth 70%. After a partial hold you can bank it and climb on.
- **The rope:** the intended link word is carried up and becomes the first clue of the next pitch, so the day is one chain.
- **Summit:** an uncommon word. A vague definition gets clearer after each miss, three tries. Exact word: 1,000 / 700 / 400 m. Close guesses are flagged, and if you never get it the closest one earns up to 300 m.
- **Your metres are your height.** The rope and climber stop exactly where your score puts you, and each word you played is labelled at the height it reached. After each pitch you see the rarest words that would have fit.
- **Tiers:** Base camp, Treeline, Snowline, Ridge, High camp, Summit.

Also: emoji share card, streaks and stats, archive of past days, light and dark mode, a two-column layout on laptops. No accounts, everything is saved in the browser.

## How guesses are judged

1. **Dictionary first.** `data/freq.json` holds how common each word is (for the rarity bonus). `data/links.json` lists, for every clue, the words that form a real compound with it (SUN → LIGHT, SET, FLOWER, BURN…). It's built from English word frequencies by `scripts/build_links.py`, plus hand-written two-word phrases in `scripts/phrase_links.json` (QUEEN SIZE, BEAUTY SLEEP). This settles most guesses instantly.
2. **Then the judge.** Clues the dictionary didn't link are sent to `api/score.js`, a Vercel Function that asks an AI model through Vercel AI Gateway whether the pair is a real compound or common phrase. It also rates summit near-misses. It signs in with the deployment's OIDC token, so no API key is stored.
3. **Fallback.** If the judge can't be reached, the dictionary result stands and the game says so.

The GitHub Pages site calls the function on the Vercel production URL. Vercel deploys use their own `/api/score`.

## Files

```
index.html               page shell and dialogs
css/style.css            all styling (phone layout, plus two columns from 900px)
js/puzzles.js            the daily puzzles (edit this to add days)
js/daily.js              picks today's puzzle from the date
js/game.js               game loop, input, scoring, rendering
js/judge.js              dictionary check, then calls the judge
js/climb.js              mountain, rope, route labels and climber
js/stats.js              localStorage, streaks, tiers
js/share.js              share text
api/score.js             Vercel Function: AI judge for links and near-misses
data/links.json          generated link dictionary
data/freq.json           generated word rarity (Zipf scale)
scripts/build_links.py   builds data/links.json
scripts/phrase_links.json  two-word phrases the dictionary can't see
assets/                  favicon and social image
```

## Adding puzzles

1. Append a day to `js/puzzles.js`:

```js
{
  pitches: [
    { clues: ["SUN", "FIRE"], answer: "LIGHT" },
    { clues: ["HOUSE"], answer: "GREEN" },   // LIGHT is added automatically
    { clues: ["BACK"], answer: "ROOM" },
    { clues: ["CHECK", "PLAY"], answer: "MATE" },
  ],
  summit: {
    answer: "PETRICHOR",
    clues: ["broad clue", "narrower clue", "the actual definition"],
  },
},
```

2. Rebuild the dictionary and rarity data so the new clues can be scored:

```
pip install wordfreq
python3 scripts/build_links.py
```

Puzzle No. 1 is 13 October 2026. When the list runs out it loops back to the start, so keep adding days.

## Run locally

```
npx serve .
```

The judge only runs on Vercel. Locally the game uses the dictionary alone.
