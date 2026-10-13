# Ascent

A daily word climb. One mountain a day, the same for everyone.

**Play:** https://liam-ohalloran.github.io/Ascent/

## How it works

- **Pitches 1 to 4:** find one word that links the clues (SUN + FIRE → LIGHT). Three guesses each.
- **The rope:** each answer is carried up and becomes the first clue of the next pitch, so the day is one chain.
- **Summit:** an uncommon word. You start with a vague definition and get a clearer one after each wrong guess. Four guesses.
- **Metres:** each pitch is worth up to 1,000 m (1,000 / 700 / 400 by guess, summit 1,000 / 750 / 500 / 250). Showing the first letter costs 200 m. A perfect day is 5,000 m.
- **Tiers:** Base camp, Treeline, Snowline, Ridge, High camp, Summit.

Also: emoji share card, streaks and stats, archive of past days, a how-to-play sheet on first visit, light and dark mode. No accounts, everything is saved in the browser.

## Files

```
index.html        page shell and dialogs
css/style.css     all styling
js/puzzles.js     the daily puzzles (edit this to add days)
js/daily.js       picks today's puzzle from the date
js/game.js        game loop, input, rendering
js/climb.js       mountain, rope and climber drawing
js/stats.js       localStorage, streaks, tiers
js/share.js       share text
assets/           favicon and social image
```

## Adding puzzles

Open `js/puzzles.js` and append a block:

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

Rules for a good chain: the answer must pair with **every** clue as a real compound or common phrase, and only one word of that length should fit. Add `alt: ["OTHER"]` if a second answer is fair.

Puzzle No. 1 is 13 October 2026. When the list runs out it loops back to the start, so keep adding days. You can edit the file straight on github.com and Pages redeploys in about a minute.

## Run locally

It uses ES modules, so open it through a server rather than double-clicking:

```
npx serve .
```
