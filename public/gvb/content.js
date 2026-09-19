/* Good Vibe Beats — the game as data.
 *
 * GVB, everywhere it is abbreviated: the directory, the save key, the test
 * file. Good Vibe Beats, singular Vibe, like the site.
 *
 * Four pads and a song. Nothing tells you what to play: the game listens to
 * where your hits land against the song's own grid and pays you for the ones
 * that are interesting. Hitting the beat is worth the least it can be worth
 * and still be worth something; the "and" pays half again, the "e" and the "a"
 * pay double, and anticipating a beat while leaving the beat itself empty pays
 * a bonus on top. That is the whole game: it is a rhythm game about the spaces
 * rather than about a scrolling highway of notes to catch.
 *
 * Everything below is data and pure functions over it — no DOM, no audio, no
 * clock, no storage, no randomness — so the scoring can be driven from a test
 * with no browser anywhere near it. `audio.js` makes the noise and `play.html`
 * owns the clock and the save; between them they ask this file every question
 * about what a hit was worth.
 *
 * --- Time is measured in beats, never in seconds -----------------------------
 *
 * Every function here takes `rel` (seconds since the song's first downbeat)
 * and `spb` (seconds per beat) and immediately divides one by the other. That
 * is deliberate: the same lick at 84 and at 104 BPM has to score the same, and
 * a window written in milliseconds is a window that quietly gets stricter as
 * the tempo rises. The timing windows are the one exception — they ARE in
 * milliseconds, because they are about a human hand and a device's audio
 * latency, neither of which cares what the tempo is.
 *
 * --- Two grids at once -------------------------------------------------------
 *
 * Hits snap to the nearest sixteenth OR the nearest eighth-note triplet,
 * whichever is closer, and the triplet only wins if it is clearly closer AND
 * is not sitting on a beat anyway. Without the triplet grid a swung groove
 * reads as a player who cannot keep time; with it, swing is a thing the game
 * can see and pay for. `SNAP_EDGE` is what "clearly" means, and it is small
 * on purpose — the two grids are 1/48th of a beat apart at their closest, so
 * a wide margin would hand every sixteenth to the triplet grid.
 */

/* ------------------------------------------------------------------ the kit */

/* Four to begin with, and the other two earned by playing. Not sold: the whole
   progression is XP, and a pad you can buy is a pad the game cannot use as a
   reason to keep going. */
export const PADS = [
  { id: 'kick',  label: 'Kick',  key: 'f' },
  { id: 'snare', label: 'Snare', key: 'g' },
  { id: 'hat',   label: 'Hat',   key: 'h' },
  { id: 'clap',  label: 'Clap',  key: 'j' },
  { id: 'tom',   label: 'Tom',   key: 'd', unlock: 2 },
  { id: 'crash', label: 'Crash', key: 'k', unlock: 3 },
];

export const PAD_IDS = PADS.map(p => p.id);
export const PAD_BY_ID = Object.fromEntries(PADS.map(p => [p.id, p]));

/* The pads that hold a groove down, and which beats of the bar they hold. Read
   by the scorer to pay the anchor bonus, and written here rather than inline
   there because "kick on one and three, backbeat on two and four" is a fact
   about drumming, not about scoring. */
export const ANCHORS = {
  kick:  [0, 2],
  snare: [1, 3],
  clap:  [1, 3],
};

export const XP_PER_LEVEL = 500;
export const levelOf = xp => 1 + Math.floor(Math.max(0, num(xp)) / XP_PER_LEVEL);
export const padUnlocked = (pad, xp) => !pad.unlock || levelOf(xp) >= pad.unlock;
export const padsAt = xp => PADS.filter(p => padUnlocked(p, xp));

/* Which pads to put on screen. Four while four is all there is, and all six the
   moment any extra one is earned — the locked one stays visible and dimmed,
   because a pad that appears out of nowhere is a pad nobody was working
   towards. */
export const padLayout = xp =>
  PADS.some(p => p.unlock && padUnlocked(p, xp)) ? PADS : PADS.slice(0, 4);

/* A number off a save file, or the default. Saves get edited, truncated by a
   full disk and written by older versions of this file, and every one of those
   arrives as a string or a NaN. */
const num = (value, fallback = 0) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/* -------------------------------------------------------------- the grid */

export const BEATS_PER_BAR = 4;     // everything below assumes four, and says so
export const STEPS_PER_BEAT = 4;    // sixteenths
export const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;
export const TRIPLETS_PER_BEAT = 3;

/* How much closer the triplet grid has to be before it wins, in seconds. The
   two grids converge to a 48th of a beat apart, so this is deliberately tiny:
   at 4 ms it decides only the hits that are genuinely swung, and every hit that
   is merely near a sixteenth stays a sixteenth. */
export const SNAP_EDGE = 0.004;

/* Where a hit landed, on whichever of the two grids it is nearest.
 *
 *   grid  's' for sixteenths, 't' for eighth-note triplets
 *   idx   how many of that unit since the first downbeat — negative before it
 *   err   how far off that line the hit was, in seconds
 *   beat  which beat of the song, counting from zero
 *   sub   which subdivision within the beat: 0 the beat, 2 the "and", 1 and 3
 *         the "e" and the "a"; on the triplet grid, 1 and 2 are the swung ones
 *   s16   the same position expressed in sixteenths, so a triplet and a
 *         sixteenth can be compared for "was this bar like the last one"
 */
export function snap(rel, spb){
  const b = rel / spb;

  const n16 = Math.round(b * STEPS_PER_BEAT);
  const e16 = Math.abs(b * STEPS_PER_BEAT - n16) * spb / STEPS_PER_BEAT;

  const n3 = Math.round(b * TRIPLETS_PER_BEAT);
  const e3 = Math.abs(b * TRIPLETS_PER_BEAT - n3) * spb / TRIPLETS_PER_BEAT;

  /* The triplet grid only takes a hit that is off the beat. On the beat the two
     grids agree exactly, and handing those to the triplet grid would pay a
     swing multiplier for playing straight down the middle. */
  if(n3 % TRIPLETS_PER_BEAT !== 0 && e3 < e16 - SNAP_EDGE){
    return {
      grid: 't', idx: n3, err: e3,
      beat: Math.floor(n3 / TRIPLETS_PER_BEAT),
      sub: ((n3 % TRIPLETS_PER_BEAT) + TRIPLETS_PER_BEAT) % TRIPLETS_PER_BEAT,
      s16: Math.round(n3 * STEPS_PER_BEAT / TRIPLETS_PER_BEAT),
    };
  }
  return {
    grid: 's', idx: n16, err: e16,
    beat: Math.floor(n16 / STEPS_PER_BEAT),
    sub: ((n16 % STEPS_PER_BEAT) + STEPS_PER_BEAT) % STEPS_PER_BEAT,
    s16: n16,
  };
}

/* One hit's address, for the "you already played that" check. Two pads on the
   same sixteenth are two hits; the same pad twice on it is one. */
export const slotKey = (snapped, pad) => `${snapped.grid}${snapped.idx}${pad}`;

/* ---------------------------------------------------------------- scoring */

/* In milliseconds, because these are about a hand and an audio driver rather
   than about the tempo. Past GOOD_MS a hit is off the grid: it still makes its
   noise, it just does not score. Nothing is ever deducted — the game is no-fail
   and a scoreboard that goes down teaches people to stop playing. */
export const PERFECT_MS = 35;
export const GOOD_MS = 80;

export const PERFECT_POINTS = 100;
export const GOOD_POINTS = 50;

export const ANCHOR_BONUS = 20;     // kick on 1 and 3, backbeat on 2 and 4
export const UPBEAT_MULT = 1.5;     // the "and"
export const SYNCOPE_MULT = 2;      // the "e" and the "a", and anything swung

export const PUSH_POINTS = 300 / 4; // 75
export const FILL_POINTS = 300;
export const FRESH_POINTS = 100;
export const LOCKED_POINTS = 30;

/* How many hits inside one beat is playing, and past which it is mashing. Six
   is a thirty-second-note roll with room to spare; the curve past it is square
   rather than linear so that doubling the mashing quarters the pay. */
export const BUSY_FROM = 6;
export const busyScale = hits => hits <= BUSY_FROM ? 1 : Math.pow(BUSY_FROM / hits, 2);

/* Why a hit scored nothing. Refusals name themselves rather than returning a
   bare false, because the page prints two of them differently. */
export const OUT_OF_SONG = 'out';
export const ALREADY_PLAYED = 'again';
export const OFF_THE_GRID = 'off';

/* What a hit was worth.
 *
 * `rel` is seconds since the song's first downbeat and may be negative — the
 * count-in is playable, and a hit half a beat before the song starts is an
 * anticipation of the first beat rather than a mistake.
 *
 * Returns either { ok: false, why } or the full account of the hit, so the
 * caller never has to re-derive any of it to draw the feedback.
 */
export function scoreHit(pad, rel, spb, { span = Infinity, recent = 0, taken = null } = {}){
  if(rel < -spb / 2 || rel > span) return { ok: false, why: OUT_OF_SONG };

  const at = snap(rel, spb);
  const key = slotKey(at, pad);
  if(taken && taken.has(key)) return { ok: false, why: ALREADY_PLAYED };

  const ms = at.err * 1000;
  if(ms > GOOD_MS) return { ok: false, why: OFF_THE_GRID, at };

  const quality = ms <= PERFECT_MS ? 'perfect' : 'good';
  const base = quality === 'perfect' ? PERFECT_POINTS : GOOD_POINTS;
  const beatInBar = ((at.beat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR;

  let type = 'down', mult = 1, bonus = 0, label = '', kind = '';
  if(at.grid === 't'){
    type = 'sync'; mult = SYNCOPE_MULT; label = 'Swing'; kind = 'sync';
  } else if(at.sub === 0){
    /* On the beat. Worth the plain rate, plus a little for the two placements
       that hold a groove together — otherwise the game would be telling people
       never to play a backbeat, which is not the lesson. */
    if((ANCHORS[pad] || []).includes(beatInBar)){ bonus = ANCHOR_BONUS; kind = 'groove'; }
  } else if(at.sub === 2){
    type = 'up'; mult = UPBEAT_MULT; kind = 'up';
  } else {
    type = 'sync'; mult = SYNCOPE_MULT; label = 'Syncopated'; kind = 'sync';
  }

  const busy = busyScale(recent + 1);
  return {
    ok: true, key, at, quality, type, mult, bonus, label, kind, busy,
    points: Math.round((base * mult + bonus) * busy),
  };
}

/* ------------------------------------------------- the phrase, after the fact
 *
 * Three of the five bonuses cannot be judged when the hit lands, because they
 * are about what you did NOT play, or about what the bar before this one looked
 * like. They are settled a beat or a bar late instead, off the list of hits.
 */

/* A hit exactly on beat `b`, on either grid. */
export const onBeat = (hits, b) =>
  hits.some(h => (h.grid === 's' && h.idx === b * STEPS_PER_BEAT)
              || (h.grid === 't' && h.idx === b * TRIPLETS_PER_BEAT));

/* A push: something landing in the last two sixteenths before a beat, with the
   beat itself left alone. Leaving it alone is the whole point — anticipating
   the one and then also playing the one is just playing the one. */
export function pushedInto(hits, b){
  const d = b * STEPS_PER_BEAT;
  const early = hits.some(h => (h.grid === 's' && (h.idx === d - 1 || h.idx === d - 2))
                            || (h.grid === 't' && h.idx === b * TRIPLETS_PER_BEAT - 1));
  return early && !onBeat(hits, b);
}

/* How many beats a phrase is. A fill is judged over the turn of a phrase, not
   the turn of a bar, because a fill every bar is not a fill, it is the groove. */
export const PHRASE_BEATS = 16;
export const FILL_SPOTS = 5;

/* A fill: the last two beats of a four-bar phrase busy across at least five
   distinct sixteenths, and then landing on the next one. The landing is what
   separates a fill from falling over. */
export function filledInto(hits, b){
  if(b % PHRASE_BEATS !== 0) return false;
  const d = b * STEPS_PER_BEAT;
  const spots = new Set(hits.filter(h => h.s16 >= d - 8 && h.s16 < d).map(h => h.s16));
  return spots.size >= FILL_SPOTS && onBeat(hits, b);
}

/* What a bar looked like: which sixteenth, which pad, as a set. Position and
   pad both, so moving the same pattern onto different drums counts as a
   change — because it sounds like one. */
export const barSignature = (hits, n) => new Set(
  hits.filter(h => h.s16 >= n * STEPS_PER_BAR && h.s16 < (n + 1) * STEPS_PER_BAR)
      .map(h => `${h.s16 - n * STEPS_PER_BAR}:${h.pad}`)
);

/* Jaccard, so a bar with three hits and a bar with twelve can be compared. */
export function likeness(a, b){
  if(!a.size && !b.size) return 1;
  let both = 0;
  a.forEach(x => { if(b.has(x)) both++; });
  return both / (a.size + b.size - both);
}

export const FRESH_UNDER = 0.5;
export const LOCKED_OVER = 0.85;
export const BAR_MIN_HITS = 3;

/* What bar `n` earns against bar `n - 1`: something for changing it and
   something, less, for holding it. Both, because a game that only paid for
   variation would be telling drummers that repeating themselves is a fault,
   and repeating yourself is most of the job. A bar with almost nothing in it is
   neither — two hits are not a pattern to have kept or broken. */
export function barBonus(hits, n){
  if(n < 1) return null;
  const cur = barSignature(hits, n), prev = barSignature(hits, n - 1);
  if(cur.size < BAR_MIN_HITS || prev.size < BAR_MIN_HITS) return null;
  const sim = likeness(cur, prev);
  if(sim < FRESH_UNDER) return { kind: 'fresh', points: FRESH_POINTS, label: 'Fresh', type: 'up' };
  if(sim >= LOCKED_OVER) return { kind: 'locked', points: LOCKED_POINTS, label: 'Locked in', type: 'down' };
  return null;
}

/* ------------------------------------------------------------------ lessons */

/* One bar each, positions in sixteenths. The order is a ladder: two limbs
   moving together, then the hand filling in, then the first note that is not on
   a beat at all, then that note standing in for the beat it anticipates, and so
   on up to a clave nobody would guess by ear alone.
 */
export const LESSONS = [
  { id: 'backbone',  name: 'Backbone',       bpm: 88, notes: { kick: [0, 8], snare: [4, 12] } },
  { id: 'hats',      name: 'Eighth hats',    bpm: 88, notes: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { id: 'and',       name: 'The "and"',      bpm: 90, notes: { kick: [0, 6, 8], snare: [4, 12] } },
  { id: 'push',      name: 'The push',       bpm: 90, notes: { kick: [0, 10], snare: [4, 12] } },
  { id: 'offclaps',  name: 'Off-beat claps', bpm: 92, notes: { kick: [0, 8], clap: [2, 6, 10, 14] } },
  { id: 'sixteenth', name: 'Sixteenths',     bpm: 86, notes: { kick: [0, 3, 8, 11], snare: [4, 12] } },
  { id: 'tresillo',  name: 'Tresillo',       bpm: 90, notes: { kick: [0, 6, 12], hat: [2, 10] } },
  { id: 'clave',     name: 'Clave',          bpm: 88, notes: { kick: [0, 8], clap: [0, 3, 6, 10, 12] } },
];

export const LESSON_BY_ID = Object.fromEntries(LESSONS.map(l => [l.id, l]));

/* Every note in a lesson, flattened, in the order the bar plays them. */
export function lessonNotes(lesson){
  const out = [];
  for(const [pad, steps] of Object.entries(lesson.notes)) for(const s of steps) out.push({ pad, s });
  return out.sort((a, b) => a.s - b.s || a.pad.localeCompare(b.pad));
}

/* Copying is judged wider than jamming is. A lesson asks you to play a shape
   you have heard once; a jam asks you to land where you meant to. Ninety
   milliseconds is about a sixteenth at 160 BPM, which is as tight as a phone
   screen is worth being. */
export const LESSON_MS = 90;

export const STAR_AT = [0.4, 0.7, 0.9];    // one, two and three stars

/* How well a bar was copied.
 *
 * Each expected note is matched against at most one hit, so playing a
 * sixteenth four times does not four-count it. Extra hits cost half a note
 * each rather than a whole one: playing a note that was not there is a smaller
 * sin than missing one that was.
 */
export function gradeLesson(expected, hits){
  const used = new Set();
  let matched = 0;
  for(const want of expected){
    const k = hits.findIndex((h, i) =>
      !used.has(i) && h.pad === want.pad && h.n === want.s && h.err <= LESSON_MS / 1000);
    if(k >= 0){ used.add(k); matched++; }
  }
  const extras = hits.length - used.size;
  const accuracy = expected.length ? matched / (expected.length + 0.5 * extras) : 0;
  let stars = 0;
  for(const bar of STAR_AT) if(accuracy >= bar) stars++;
  return { matched, extras, accuracy, stars };
}

/* --------------------------------------------------------------------- XP */

export const XP_PER_STAR = 10;
export const XP_PER_NEW_STAR = 40;
export const JAM_XP_PER_POINT = 1 / 50;

/* Replaying a lesson you have already three-starred still pays, just much less.
   Grinding the easiest bar for levels should be the slowest way to get them. */
export const learnXp = (stars, had = 0) =>
  Math.max(0, stars - had) * XP_PER_NEW_STAR + stars * XP_PER_STAR;

export const jamXp = score => Math.round(Math.max(0, num(score)) * JAM_XP_PER_POINT);

/* ------------------------------------------------------------------ worlds */

/* Worlds are genres. Each carries its own song and, eventually, its own kit.
 *
 * These two are stand-ins and are marked as such: they are synthesised here,
 * from bass, keys and a shaker, because the game this is a prototype of plays
 * over real recordings with the drums taken out. What a real one will carry is
 * the same header — bpm, beatsPerBar, bars — plus the file and the seconds to
 * its first downbeat, and the scorer above will not know the difference: it
 * never hears the music, it only ever sees `rel` and `spb`.
 *
 * `beatsPerBar` is on the record rather than assumed, because a five-four world
 * is a thing this will want and the only places that would need to change are
 * the ones that read this field.
 */
export const TRACKS = [
  {
    id: 'lofi', kind: 'synth', world: 'Lo-fi world', title: 'Dusty Keys',
    bpm: 84, beatsPerBar: 4, bars: 24, colour: 'up',
    roots: [38, 43, 36, 45],
    chords: [[53, 57, 60, 64], [53, 57, 59, 64], [52, 55, 59, 62], [55, 59, 60, 64]],
    bass: r => [[0, r, 3], [7, r, 1], [10, r + 7, 2], [14, r + 12, 1.5]],
    keys: [[0, 10, 0.07], [10, 5, 0.05]],
  },
  {
    id: 'funk', kind: 'synth', world: 'Funk world', title: 'Pocket Change',
    bpm: 104, beatsPerBar: 4, bars: 24, colour: 'sync',
    roots: [40, 40, 45, 40],
    chords: [[56, 62, 66, 71], [56, 62, 66, 71], [61, 67, 71, 73], [56, 62, 66, 71]],
    bass: r => [[0, r, 2], [3, r + 12, 1], [6, r, 1], [8, r + 7, 1], [10, r + 10, 1], [11, r + 12, 1], [14, r, 1]],
    keys: [[2, 1, 0.06], [6, 1, 0.06], [11, 1, 0.06], [14, 1, 0.05]],
  },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map(t => [t.id, t]));

export const secondsPerBeat = bpm => 60 / bpm;
export const trackSpan = track => track.bars * track.beatsPerBar * secondsPerBeat(track.bpm);

/* ------------------------------------------------------------------ saving */

export const SAVE_VERSION = 1;

export function toSave(state){
  return {
    version: SAVE_VERSION,
    xp: state.xp,
    stars: { ...state.stars },
    offset: state.offset,
  };
}

/* Merged onto a fresh run rather than trusted, so a save from an older version
   — or one naming a lesson that has since been renamed — loads with the parts
   it still has and defaults for the rest. */
export function fromSave(raw){
  const state = { xp: 0, stars: {}, offset: null };
  if(!raw || typeof raw !== 'object') return state;
  state.xp = Math.max(0, Math.floor(num(raw.xp)));
  for(const [id, n] of Object.entries(raw.stars || {})){
    if(LESSON_BY_ID[id]) state.stars[id] = Math.min(3, Math.max(0, Math.floor(num(n))));
  }
  /* Null is a real value here and means "use whatever the device reports", so
     it cannot go through `num`. Outside the clamp it is not a calibration, it
     is a stuck key or a hand-edited save. */
  const off = raw.offset;
  if(typeof off === 'number' && Number.isFinite(off) && off >= OFFSET_MIN && off <= OFFSET_MAX){
    state.offset = off;
  }
  return state;
}

/* What a calibration is allowed to come out as. Below zero means the player
   taps before the click they are copying, which happens and is small; the top
   end is a Bluetooth speaker, which is genuinely a third of a second. */
export const OFFSET_MIN = -0.05;
export const OFFSET_MAX = 0.3;

export const CAL_CLICKS = 16;
export const CAL_INTERVAL = 0.5;      // 120 BPM
export const CAL_WARMUP = 4;          // the first four are not counted
export const CAL_NEAR = 0.25;         // a tap further than this is not a tap at a click
export const CAL_MIN_TAPS = 6;

/* The median, not the mean: one tap missed entirely would drag a mean across
   the whole calibration, and the median does not care. */
export function calibrationFrom(taps){
  if(!Array.isArray(taps) || taps.length < CAL_MIN_TAPS) return null;
  const sorted = taps.slice().sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, mid));
}
