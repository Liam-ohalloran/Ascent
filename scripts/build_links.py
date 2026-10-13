"""Build data/links.json: for every clue in js/puzzles.js, the words that
genuinely link to it. Used by api/score.js to score any guess.

W links to clue C when CW or WC is a real word or compound in English
(checked with the wordfreq library), or when the pair is listed in
scripts/phrase_links.json (two-word phrases like QUEEN SIZE).

Run after adding puzzles:
  pip install wordfreq && python3 scripts/build_links.py
"""
import json, subprocess, pathlib
from wordfreq import zipf_frequency as z, top_n_list

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_COMPOUND = 1.8   # how common the joined word must be
MIN_WORD = 3.0       # how common the guess itself must be
# Word endings that make a real word but are not a fair "link".
FRAGMENTS = {"ING", "ISH", "EST", "ERS", "IER", "IES", "NESS", "ITY", "IAN", "ISM",
             "IST", "ITE", "ATE", "ERY", "ARY", "ORY", "OUS", "IVE", "IZE", "ISE",
             "ABLE", "IBLE", "MENT", "SHIP", "HOOD", "DOM", "WARD", "WARDS", "LIKE"}

days = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e",
     "const m = await import('./js/puzzles.js');"
     "console.log(JSON.stringify(m.PUZZLES.map(m.buildDay)))"],
    cwd=ROOT))

extra = json.loads((ROOT / "scripts/phrase_links.json").read_text())
extra.pop("_note", None)

clues = sorted({c for d in days for p in d["pitches"] for c in p["clues"]})
vocab = [w for w in top_n_list("en", 50000)
         if w.isalpha() and w.isascii() and len(w) >= 3 and z(w, "en") >= MIN_WORD
         and w.upper() not in FRAGMENTS]

links = {}
for c in clues:
    lc = c.lower()
    found = set()
    for w in vocab:
        if w == lc:
            continue
        if z(lc + w, "en") >= MIN_COMPOUND or z(w + lc, "en") >= MIN_COMPOUND:
            found.add(w.upper())
    found |= {w.upper() for w in extra.get(c, [])}
    for other, words in extra.items():
        if c in words:
            found.add(other)
    links[c] = found

missing = []
for i, d in enumerate(days, 1):
    for j, p in enumerate(d["pitches"], 1):
        for c in p["clues"]:
            if p["answer"] not in links[c]:
                missing.append(f"day {i} pitch {j}: {p['answer']} + {c}")
            links[c].add(p["answer"])

out = {c: sorted(ws) for c, ws in links.items()}
path = ROOT / "data/links.json"
path.write_text(json.dumps(out, separators=(",", ":")))
print(f"{len(clues)} clues, {sum(map(len, out.values()))} links, {path.stat().st_size // 1024} KB")
if missing:
    print("Intended answers the dictionary missed (added anyway):")
    print("\n".join("  " + m for m in missing))
