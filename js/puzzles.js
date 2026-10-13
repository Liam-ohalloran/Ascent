// Daily puzzles. Puzzle 1 is the launch day (see LAUNCH in daily.js).
//
// Each day has five pitches.
// Pitches 1 to 4 are bridges: find ONE word that associates with every
// clue. Any defensible association counts: synonym (QUIET, CALM -> STILL),
// opposite (DAY -> NIGHT), related meaning (SKELETON -> BONE), shared
// context (KING -> CROWN), common phrase (WAR ZONE) or compound word
// (SNOWSTORM). Mix the types: no mountain should lean on compounds alone.
// The answer to each pitch is carried up the rope and becomes the
// first clue of the next pitch. "alt" lists other answers a fair-minded
// player would accept as fitting every clue; they score like the answer.
//
// Puzzles that have already been played must never change, so every player
// on a given day sees the same mountain (tests/unit/puzzles.test.js locks them).
// Pitch 5 is the summit: an uncommon word revealed through three
// definition clues, broad to specific.
//
// To add a day, copy a block and append it. Each mountain has a made-up
// name that gives nothing away. Words are upper case A to Z.

export const PUZZLES = [
  {
    name: "Kestrel Spire",
    pitches: [
      { clues: ["SUN", "FIRE"], answer: "LIGHT" },
      { clues: ["HOUSE"], answer: "GREEN" },
      { clues: ["BACK"], answer: "ROOM" },
      { clues: ["CHECK", "PLAY"], answer: "MATE" },
    ],
    summit: {
      answer: "PETRICHOR",
      clues: [
        "A sensation you notice outdoors",
        "It arrives when a dry spell ends",
        "The earthy smell of the ground after rain",
      ],
    },
  },
  {
    name: "Mount Brindle",
    pitches: [
      { clues: ["SNOW", "BASKET"], answer: "BALL" },
      { clues: ["CAR"], answer: "PARK" },
      { clues: ["WAY"], answer: "SIDE" },
      { clues: ["ROAD", "SLIDE"], answer: "SHOW" },
    ],
    summit: {
      answer: "DEFENESTRATION",
      clues: [
        "An act that involves a building",
        "Someone or something leaves very suddenly",
        "Throwing a person or thing out of a window",
      ],
    },
  },
  {
    name: "Cinder Horn",
    pitches: [
      { clues: ["QUIET", "CALM"], answer: "STILL", alt: ["TRANQUIL", "PEACEFUL"] },
      { clues: ["DEATH"], answer: "LIFE", alt: ["BIRTH"] },
      { clues: ["CLOCK"], answer: "TIME" },
      { clues: ["DAY", "DARK"], answer: "NIGHT" },
    ],
    summit: {
      answer: "SONDER",
      clues: [
        "A feeling, not an object",
        "It often comes while watching strangers",
        "Realising every passer-by has a life as vivid as your own",
      ],
    },
  },
  {
    name: "Wren Peak",
    pitches: [
      { clues: ["ICE", "SNOW"], answer: "STORM" },
      { clues: ["RAIN"], answer: "CLOUD", alt: ["WATER"] },
      { clues: ["FOG"], answer: "MIST", alt: ["HAZE"] },
      { clues: ["HAIR", "SEA"], answer: "SPRAY" },
    ],
    summit: {
      answer: "PALIMPSEST",
      clues: [
        "Something linked to old writing",
        "It has been used more than once",
        "A page scraped clean and written over, with traces of the original still showing",
      ],
    },
  },
  {
    name: "Mount Alder",
    pitches: [
      { clues: ["BIG", "LARGE"], answer: "SMALL", alt: ["LITTLE", "TINY", "HUGE", "GIANT"] },
      { clues: ["CHAT"], answer: "TALK", alt: ["GOSSIP"] },
      { clues: ["FRONT"], answer: "BACK", alt: ["SHOP"] },
      { clues: ["SKELETON", "DRY"], answer: "BONE" },
    ],
    summit: {
      answer: "SOLILOQUY",
      clues: [
        "Something you might see on a stage",
        "Only one person is involved",
        "A speech where a character says their thoughts aloud, alone",
      ],
    },
  },
  {
    name: "Saltback Ridge",
    pitches: [
      { clues: ["SWEET", "SOUR"], answer: "BITTER", alt: ["SALTY", "SAVOURY", "SAVORY", "TART"] },
      { clues: ["RIVAL"], answer: "ENEMY", alt: ["FOE"] },
      { clues: ["PAL"], answer: "FRIEND", alt: ["BUDDY", "MATE", "CHUM", "ALLY"] },
      { clues: ["WAR", "TIME"], answer: "ZONE" },
    ],
    summit: {
      answer: "OSSIFY",
      clues: [
        "It describes a slow change",
        "It can happen to bones and to ideas",
        "To turn into bone, or to become rigid and unwilling to change",
      ],
    },
  },
  {
    name: "The Lantern",
    pitches: [
      { clues: ["CANDLE", "LAMP"], answer: "LIGHT", alt: ["WICK", "OIL", "FLAME"] },
      { clues: ["HEAVY"], answer: "WEIGHT", alt: ["METAL", "INDUSTRY", "RAIN", "DUTY"] },
      { clues: ["BURDEN"], answer: "LOAD", alt: ["PRESSURE"] },
      { clues: ["FIRE", "LORRY"], answer: "TRUCK" },
    ],
    summit: {
      answer: "MELLIFLUOUS",
      clues: [
        "A word used to describe a sound",
        "It is pleasant to listen to",
        "Sweet and smooth, like flowing honey",
      ],
    },
  },
  {
    name: "Mount Quill",
    pitches: [
      { clues: ["PEN", "PENCIL"], answer: "WRITE", alt: ["DRAW", "SKETCH"] },
      { clues: ["ENVELOPE"], answer: "LETTER", alt: ["ADDRESS", "CARD"] },
      { clues: ["NEWS"], answer: "PAPER" },
      { clues: ["SHEET", "PAGE"], answer: "BLANK", alt: ["WHITE"] },
    ],
    summit: {
      answer: "EPHEMERAL",
      clues: [
        "A way of describing time",
        "A mayfly is a good example",
        "Lasting for only a very short time",
      ],
    },
  },
  {
    name: "Harrow Peak",
    pitches: [
      { clues: ["EAR", "HEAD"], answer: "PHONE" },
      { clues: ["CALL"], answer: "RING" },
      { clues: ["ALARM"], answer: "BELL", alt: ["CLOCK"] },
      { clues: ["CHURCH", "CLOCK"], answer: "TOWER" },
    ],
    summit: {
      answer: "QUIXOTIC",
      clues: [
        "It describes a person or a plan",
        "It comes from a famous Spanish novel",
        "Wildly idealistic and unrealistic",
      ],
    },
  },
  {
    name: "Mount Ember",
    pitches: [
      { clues: ["HONEY", "HIVE"], answer: "BEE", alt: ["COMB"] },
      { clues: ["MONARCH"], answer: "QUEEN", alt: ["BUTTERFLY"] },
      { clues: ["KING"], answer: "CROWN", alt: ["THRONE", "PALACE", "ROYAL"] },
      { clues: ["GEM", "TREASURE"], answer: "JEWEL" },
    ],
    summit: {
      answer: "VERISIMILITUDE",
      clues: [
        "A quality that a story can have",
        "Writers chase it to make fiction convincing",
        "The appearance of being true or real",
      ],
    },
  },
  {
    name: "Larkspur Dome",
    pitches: [
      { clues: ["SKATE", "SURF"], answer: "BOARD" },
      { clues: ["PLANK"], answer: "WALK", alt: ["WOOD", "TIMBER"] },
      { clues: ["STROLL"], answer: "WANDER", alt: ["AMBLE", "SAUNTER", "RAMBLE"] },
      { clues: ["ROVE", "DRIFT"], answer: "ROAM" },
    ],
    summit: {
      answer: "LACONIC",
      clues: [
        "It describes a way of speaking",
        "The ancient Spartans were famous for it",
        "Using very few words",
      ],
    },
  },
  {
    name: "Granite Sister",
    pitches: [
      { clues: ["EYE", "FIRE"], answer: "BALL" },
      { clues: ["DANCE"], answer: "PARTY" },
      { clues: ["GUEST"], answer: "HOST", alt: ["LIST"] },
      { clues: ["GAME", "TALK"], answer: "SHOW" },
    ],
    summit: {
      answer: "OBFUSCATE",
      clues: [
        "Something you can do with information",
        "Bad instructions often do it by accident",
        "To deliberately make something unclear",
      ],
    },
  },
  {
    name: "Mount Corrie",
    pitches: [
      { clues: ["TEA", "COFFEE"], answer: "POT" },
      { clues: ["PLANT"], answer: "FLOWER", alt: ["HERB"] },
      { clues: ["BLOOM"], answer: "BLOSSOM", alt: ["FLOURISH", "BUD"] },
      { clues: ["CHERRY", "APPLE"], answer: "TREE" },
    ],
    summit: {
      answer: "MAGNANIMOUS",
      clues: [
        "It describes someone's character",
        "Good winners often show it",
        "Generous and forgiving, especially towards a rival",
      ],
    },
  },
  {
    name: "Falcon Tor",
    pitches: [
      { clues: ["FALCON", "HAWK"], answer: "EAGLE", alt: ["KITE", "OSPREY", "OWL", "VULTURE", "BIRD"] },
      { clues: ["NAKED"], answer: "EYE", alt: ["BALD"] },
      { clues: ["LOOK"], answer: "SIGHT", alt: ["VIEW", "VISION"] },
      { clues: ["SMELL", "TASTE"], answer: "SENSE" },
    ],
    summit: {
      answer: "PERIPATETIC",
      clues: [
        "It describes a lifestyle or habit",
        "Aristotle's school was named after it",
        "Travelling from place to place, never settling",
      ],
    },
  },
];

const WORD = /^[A-Z]{2,16}$/;

// Returns a description of the first problem with a day, or null if it's fine.
// Checked before a day is played, so bad data shows an error, not a crash.
export function validateDay(raw) {
  if (!raw || typeof raw !== "object") return "missing";
  if (typeof raw.name !== "string" || !raw.name) return "no name";
  if (!Array.isArray(raw.pitches) || raw.pitches.length !== 4) return "needs 4 link pitches";
  for (const [i, p] of raw.pitches.entries()) {
    if (!WORD.test(p?.answer || "")) return `pitch ${i + 1} answer`;
    const want = i === 0 || i === 3 ? 2 : 1; // new clues (pitch 4 has three in total)
    if (!Array.isArray(p.clues) || p.clues.length !== want || !p.clues.every((c) => WORD.test(c))) {
      return `pitch ${i + 1} clues`;
    }
    if (p.alt !== undefined && (!Array.isArray(p.alt) || !p.alt.every((w) => WORD.test(w) && w !== p.answer))) {
      return `pitch ${i + 1} alt`;
    }
  }
  const s = raw.summit;
  if (!WORD.test(s?.answer || "")) return "summit answer";
  if (!Array.isArray(s.clues) || s.clues.length !== 3 || !s.clues.every((c) => typeof c === "string" && c)) {
    return "summit needs 3 clues";
  }
  return null;
}

// Pitches 2 to 4 list only their NEW clues. The carried rope word
// (the previous answer) is added in front automatically.
export function buildDay(raw) {
  const pitches = raw.pitches.map((p, i) => ({
    clues: i === 0 ? [...p.clues] : [raw.pitches[i - 1].answer, ...p.clues],
    carried: i === 0 ? null : raw.pitches[i - 1].answer,
    answer: p.answer,
    alt: p.alt || [],
  }));
  return { name: raw.name, pitches, summit: { ...raw.summit, alt: raw.summit.alt || [] } };
}
