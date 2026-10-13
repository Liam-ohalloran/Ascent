"""Build the word data the judge uses (js/judge.js):

  data/assoc.json  for every clue and pitch answer, the words that associate
                   with it and HOW (one letter per link, see TYPES below).
  data/freq.json   how common each linking word is in written English
                   (wordfreq Zipf scale). Corpus data, not player data.
  data/words.txt   every real word a player might type. A guess outside this
                   list is refused without using a try.

Association types, strongest first. Strength values live in js/rules.js.

  strong
    i  intended    the puzzle's own answer (printed below if no rule found it)
    x  curated     hand-checked link: scripts/context_links.json or a pitch's alt
    p  phrase      common two-word phrase (WordNet collocation or
                   scripts/phrase_links.json), e.g. QUEEN SIZE, HOT DOG
    c  compound    a closed compound whose WordNet definition mentions one of
                   its halves, e.g. SUNLIGHT ("the rays of the sun")
    s  synonym     shares a WordNet sense, e.g. FAST / RAPID
    a  antonym     WordNet antonym, e.g. HOT / COLD
  moderate
    r  related     one is a kind of, part of or close sense of the other
                   (WordNet hypernym, hyponym, meronym, holonym, similar-to)
    g  defined-by  a noun in the clue's main WordNet definition
                   (SUN: "the star that is the source of light and heat")
    u  compound    a closed compound with no definition support (could be a
                   coincidence of spelling, like CAR + PET)

Rules that keep nonsense out:
  * a word that contains the clue (SUNSHINE for SUN) is not a link;
  * only the headword of a related sense counts (ACCELERATOR, not its slang GUN);
  * every linking word must be a lower-case (not proper-noun) WordNet lemma,
    at least 3 letters, and common enough to know (Zipf >= MIN_WORD);
  * a closed compound only counts if the joined word is itself in WordNet,
    so CARMICHAEL, SNAPS+HOT (snapshot) and similar string accidents are gone;
  * scripts/phrase_links.json "_exclude" and "_exclude_pairs" remove the rest.

Run after adding or changing puzzles:
  pip install wordfreq nltk
  python3 -m nltk.downloader wordnet
  npm run build:words
"""
import json, os, re, subprocess, pathlib
from collections import defaultdict
from wordfreq import zipf_frequency, top_n_list
from nltk.corpus import wordnet as wn

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_WORD = 2.8      # how common a linking word must be to be fair
MIN_KNOWN = 2.0     # how common any typed word must be to count as real
SENSES = 3          # WordNet senses per part of speech to draw links from
GLOSS_SENSES = 1    # senses whose definitions feed "defined-by" links
GLOSS_MAX = 5.0     # definition words more common than this are too generic
STRONG = set("ixpcsa")
ORDER = "pcsaxirug"  # tie-break: the most specific true type wins; curated next

# Definition words too generic to be a fair association.
GLOSS_STOP = set("""
act activity amount any area being body cause certain change characteristic
common condition consisting containing especially etc event form function
general group having especially kind large least made make making manner
member more most much name number object often one other part particular
person place point portion process property quality related relating
resembling set several small something sometimes specific state such
system thing time type typically used usually various way whole without
within young state one two three four five six seven eight nine ten
hundred thousand human animal feeling causing giving
""".split())

# Word endings that join to a clue as spelling, not as an association
# (SUN + LESS, HOT + NESS, CAR + TING).
FRAGMENTS = {"ING", "ISH", "EST", "ERS", "IER", "IES", "NESS", "ITY", "IAN", "ISM",
             "IST", "ITE", "ATE", "ERY", "ARY", "ORY", "OUS", "IVE", "IZE", "ISE",
             "ABLE", "IBLE", "MENT", "SHIP", "HOOD", "DOM", "WARD", "WARDS", "LIKE",
             "LESS", "TING", "PING", "NING", "LING", "TON", "PUS"}

PROFANE = {"SHIT", "WHORE", "FUCK", "CUNT", "BITCH", "SLUT", "PISS", "DICK",
           "COCK", "ASS", "ARSE", "BASTARD", "CRAP", "TIT", "TITS", "NIGGER", "FAG"}

z = lambda w: zipf_frequency(w.lower(), "en")

# ---------------------------------------------------------------- puzzles
days = json.loads(subprocess.check_output(
    ["node", "--input-type=module", "-e",
     "const m = await import('./js/puzzles.js');"
     "console.log(JSON.stringify(m.PUZZLES.map(m.buildDay)))"],
    cwd=ROOT))

phrases = json.loads((ROOT / "scripts/phrase_links.json").read_text())
phrases.pop("_note", None)
EXCLUDE = set(phrases.pop("_exclude", [])) | PROFANE
EXCLUDE_PAIRS = {tuple(sorted(p)) for p in phrases.pop("_exclude_pairs", [])}
context = json.loads((ROOT / "scripts/context_links.json").read_text())
context.pop("_note", None)

clues = sorted({c for d in days for p in d["pitches"] for c in p["clues"] + [p["answer"]]})
# Puzzle writing: ASCENT_EXPLORE=WORD,WORD builds links for candidate clues
# too and writes everything to ASCENT_OUT instead of data/ (nothing shipped).
EXPLORE = [w.strip().upper() for w in os.environ.get("ASCENT_EXPLORE", "").split(",") if w.strip()]
OUT = pathlib.Path(os.environ["ASCENT_OUT"]) if os.environ.get("ASCENT_OUT") else ROOT / "data"
clues = sorted(set(clues) | set(EXPLORE))

# ---------------------------------------------------------------- WordNet
common_lemmas = set()   # lower-case single-word lemmas (proper nouns excluded)
collocations = set()    # multi-word lemmas, e.g. "hot_dog"
for syn in wn.all_synsets():
    for lem in syn.lemmas():
        name = lem.name()
        if name != name.lower():
            continue
        if "_" in name:
            if name.count("_") == 1 and all(part.isalpha() for part in name.split("_")):
                collocations.add(name)
        elif name.isalpha() and name.isascii():
            common_lemmas.add(name)

def fair(word):
    """A word that may count as a link: real, common enough, not a name."""
    w = word.lower()
    return (w.isalpha() and w.isascii() and len(w) >= 3 and w in common_lemmas
            and z(w) >= MIN_WORD and word.upper() not in EXCLUDE)

def base(token):
    """Dictionary form of a definition word (stars -> star)."""
    return wn.morphy(token) or token

def gloss_words(synset):
    return {base(t) for t in re.findall(r"[a-z]+", synset.definition().lower())}

def senses(word):
    """The first few senses of a word for each part of speech."""
    out, seen = [], defaultdict(int)
    for s in wn.synsets(word.lower()):
        if seen[s.pos()] < SENSES:
            out.append(s)
            seen[s.pos()] += 1
    return out

# ---------------------------------------------------------------- links
links = defaultdict(dict)

def contains(a, b):
    """SUNSHINE for SUN gives the clue away rather than associating with it."""
    return len(a) >= 3 and len(b) >= 3 and (a in b or b in a)

def add(a, b, code):
    a, b = a.upper(), b.upper()
    if a == b or tuple(sorted((a, b))) in EXCLUDE_PAIRS:
        return
    if code not in "ix" and contains(a, b):
        return
    for x, y in ((a, b), (b, a)):
        old = links[x].get(y)
        if old is None or ORDER.index(code) < ORDER.index(old):
            links[x][y] = code

vocab = sorted(w for w in common_lemmas if fair(w))

def compound_supported(joined, part_a, part_b):
    for s in wn.synsets(joined)[:2]:
        words = gloss_words(s) | {l.name() for h in s.hypernyms() for l in h.lemmas()}
        if part_a in words or part_b in words:
            return True
    return False

for clue in clues:
    c = clue.lower()
    # Compounds and two-word phrases, before or after the clue.
    for w in vocab:
        if w == c:
            continue
        for joined, first, second in ((c + w, c, w), (w + c, w, c)):
            if joined in common_lemmas and z(joined) >= 1.5 and w.upper() not in FRAGMENTS:
                add(clue, w, "c" if compound_supported(joined, first, second) else "u")
        if f"{c}_{w}" in collocations or f"{w}_{c}" in collocations:
            add(clue, w, "p")
    # Meaning: synonyms, antonyms and close relations from the main senses.
    for s in senses(c):
        for lem in s.lemmas():
            if fair(lem.name()):
                add(clue, lem.name(), "s")
            for ant in lem.antonyms():
                if fair(ant.name()):
                    add(clue, ant.name(), "a")
        related = (s.hypernyms() + s.hyponyms() + s.part_meronyms() + s.member_meronyms()
                   + s.substance_meronyms() + s.part_holonyms() + s.member_holonyms()
                   + s.substance_holonyms() + s.similar_tos() + s.entailments() + s.attributes())
        # Only each related sense's headword: ACCELERATOR, not its slang GUN.
        for r in related:
            head = r.lemmas()[0].name()
            if fair(head):
                add(clue, head, "r")
    # Defined-by: nouns in the clue's own main definitions (SUN: star, heat).
    for s in wn.synsets(c)[:GLOSS_SENSES]:
        for t in gloss_words(s):
            if t not in GLOSS_STOP and fair(t) and z(t) <= GLOSS_MAX and wn.synsets(t, pos=wn.NOUN):
                add(clue, t, "g")

# Hand-written phrases and context links (two-way).
for clue, words in phrases.items():
    for w in words:
        add(clue, w, "p")
for clue, words in context.items():
    for w in words:
        add(clue, w, "x")

# Each pitch's listed alternatives fit every clue on that pitch.
for d in days:
    for p in d["pitches"]:
        for alt in p.get("alt", []):
            for c in p["clues"]:
                add(c, alt, "x")

# Intended answers always link; report any that no rule could justify.
unjustified = []
for i, d in enumerate(days, 1):
    for j, p in enumerate(d["pitches"], 1):
        for c in p["clues"]:
            if p["answer"] not in links[c]:
                unjustified.append(f"day {i} pitch {j}: {p['answer']} + {c}")
                add(c, p["answer"], "i")

# Keep only what the judge needs: links FROM clues and pitch answers.
out = {c: dict(sorted(links[c].items())) for c in clues}

# Summit near-misses: words that share a sense with the summit word.
summit_near = {}
for d in days:
    ans = d["summit"]["answer"]
    near = set()
    for s in wn.synsets(ans.lower()):
        for r in [s] + s.similar_tos() + s.also_sees():
            for lem in r.lemmas():
                n = lem.name()
                if n == n.lower() and n.isalpha() and len(n) >= 3 and n.upper() != ans:
                    near.add(n.upper())
    summit_near[ans] = sorted(near)

# ---------------------------------------------------------------- words.txt
known = {w.upper() for w in top_n_list("en", 60000)
         if w.isalpha() and w.isascii() and 2 <= len(w) <= 16 and z(w) >= MIN_KNOWN}
known |= {w.upper() for w in common_lemmas if 2 <= len(w) <= 16 and z(w) >= MIN_KNOWN}
for d in days:
    for p in d["pitches"]:
        known.update(p["clues"] + [p["answer"]] + p.get("alt", []))
    known.add(d["summit"]["answer"])
for words in out.values():
    known |= set(words)
for words in summit_near.values():
    known |= set(words)
known -= {w for w in known if not (2 <= len(w) <= 16)}
(OUT / "words.txt").write_text("\n".join(sorted(known)) + "\n")

# ---------------------------------------------------------------- freq.json
# A plural scores like its singular, so BALLS can't beat BALL by being rarer.
def base_freq(w):
    f = z(w)
    for single in ((w[:-1], w[:-2]) if w.endswith("ES") else (w[:-1],) if w.endswith("S") else ()):
        if len(single) >= 3:
            f = max(f, z(single))
    return round(f, 2)

scoring = set(clues) | {w for ws in out.values() for w in ws} | {w for ws in summit_near.values() for w in ws}
freq = {w: base_freq(w) for w in sorted(scoring)}
(OUT / "freq.json").write_text(json.dumps(freq, separators=(",", ":")))

path = OUT / "assoc.json"
path.write_text(json.dumps({"version": 1, "links": out, "summit": summit_near}, separators=(",", ":")))
counts = defaultdict(int)
for ws in out.values():
    for code in ws.values():
        counts[code] += 1
print(f"{len(clues)} clues, {sum(counts.values())} links {dict(sorted(counts.items()))}, "
      f"{path.stat().st_size // 1024} KB; {len(known)} known words")
if unjustified:
    print("Intended answers no rule could justify (added as 'i'):")
    print("\n".join("  " + m for m in unjustified))
