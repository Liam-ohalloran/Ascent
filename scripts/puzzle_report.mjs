// Puzzle quality report: for every pitch, how the intended answer links each
// clue, and how many other words fit. Run after npm run build:words:
//   node scripts/puzzle_report.mjs        (all puzzles)
//   node scripts/puzzle_report.mjs 3 14   (puzzles 3 to 14)
import fs from "node:fs";
import { PUZZLES, buildDay } from "../js/puzzles.js";
import { LINK_TYPES } from "../js/rules.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const assoc = read("assoc.json");
const freq = read("freq.json");
const strong = (t) => LINK_TYPES[t]?.strength === 1;

export function pitchReport(pitch) {
  const tables = pitch.clues.map((c) => assoc.links[c] || {});
  const words = Object.keys(tables[0]).filter((w) => !pitch.clues.includes(w));
  const fits = words.filter((w) => tables.every((t) => t[w]));
  const strongFits = fits.filter((w) => tables.every((t) => strong(t[w])));
  const types = pitch.clues.map((c, k) => tables[k][pitch.answer] || "-");
  return { types, fits, strongFits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from = 1, to = PUZZLES.length] = process.argv.slice(2).map(Number);
  for (let n = from; n <= to; n++) {
    const day = buildDay(PUZZLES[n - 1]);
    console.log(`#${n} ${day.name}`);
    day.pitches.forEach((p, i) => {
      const r = pitchReport(p);
      const alt = r.strongFits.filter((w) => w !== p.answer)
        .sort((a, b) => (freq[b] ?? 0) - (freq[a] ?? 0)).slice(0, 8);
      console.log(`  ${i + 1}. ${p.clues.join(" + ")} -> ${p.answer} [${r.types.join(",")}]` +
        `  fits ${r.fits.length}, strong ${r.strongFits.length}: ${alt.join(" ")}`);
    });
  }
}
