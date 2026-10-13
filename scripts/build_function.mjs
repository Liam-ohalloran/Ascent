// Copies the game's shared code into the server function
// (supabase/functions/finish-climb/shared/), so the server judges with
// exactly the same files as the browser. Run after changing js/ or data/:
//   npm run build:function
// tests/unit/verify.test.js fails if the copies are out of date.
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const out = new URL("supabase/functions/finish-climb/shared/", root);
fs.mkdirSync(out, { recursive: true });
for (const f of ["rules.js", "judge-core.js", "verify.js", "stats.js", "daily.js", "puzzles.js"]) {
  fs.copyFileSync(new URL(`js/${f}`, root), new URL(f, out));
}
console.log("finish-climb/shared: 6 modules copied");
