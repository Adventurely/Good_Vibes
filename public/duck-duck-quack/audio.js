/* Duck Duck Quack — music.
 *
 * Synthesised on the fly, the way Good Vibes does it: no file to fetch, a
 * look-ahead scheduler queueing notes a little ahead of the audio clock
 * because `setTimeout` drifts and a beat makes drift obvious immediately.
 * Each level gets its own track, keyed by level id — the park, the warren
 * and the orchard don't feel like the same place, so they shouldn't sound
 * like it either — but all three are built to be busy about it: Lemmings'
 * tunes are what this is chasing, and what makes a tracker loop like that
 * work is a bassline with more going on than the chord tones, not a
 * fuller chord.
 *
 * PARK_SONG: a minor walking down to E, funk-shaped: the bass does not
 * just sit on the root, it hits the root, its octave and its fifth in a
 * syncopated pattern that repeats under every chord, and the lead is one
 * riff transposed to whichever root is under it rather than four different
 * melodies — which is exactly the trick a two-channel tracker used to make
 * eight bars feel like one idea instead of four. WARREN_SONG, ORCHARD_SONG,
 * GROVE_SONG, AERIE_SONG, SPIRE_SONG and FALLS_SONG below follow the same
 * eight-bar, call-and-response shape, but differ in tempo, swing, register
 * and waveform on purpose: a tunnel is not a park, an orchard is not either
 * of them, a level with a goose that does not give up is not any of the
 * three, a floating island is not on the ground at all, a hundred and
 * twenty pixels of rock is not a climb any of the other five ever ask for,
 * and a level that spends its whole length going downhill does not sound
 * like one that mostly doesn't.
 *
 * Nothing plays until a user gesture, because autoplay policy decides that,
 * not us. The mute choice persists per browser, under its own key so it
 * cannot collide with any other game's.
 */

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

/* ------------------------------------------------------------------ song --- */

const QUALITIES = {
  maj:  [0, 4, 7],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
};

/* Eight bars, four chords twice through: Am7 - G7 - Fmaj - E7, the classic
 * minor walk-down. The second pass is not a plain repeat, though — a tracker
 * loop that plays note-for-note identical bars a second time announces its
 * own loop point, which is the fastest way for a background track to start
 * sounding like a background track. Three things break that up:
 *
 *   - the lead answers itself. Bars 0-3 play `lead`, the call; bars 4-5
 *     play `leadResponse`, pitched higher and syncopated differently — a
 *     real second phrase, not the same hook moved an octave.
 *   - the chord's own quality gets heard. `bass` and `lead` only ever
 *     needed a bar's root, so QUALITIES — the min7/dom7/maj shape of each
 *     chord — sat in the data and never once reached the speaker. `stabAt`
 *     now plays the *other* notes of that chord (everything but the root,
 *     which the bass already owns) as a short off-beat stab, so an Am7
 *     and an E7 finally sound like different chords rather than different
 *     bass notes under the same lead line.
 *   - the last bar gets a pickup: a short snare roll across its last four
 *     steps, the turnaround a live band would play into bar 1 rather than
 *     just stopping and starting over.
 */
export const PARK_SONG = {
  bpm: 124,
  swing: 0.12,          // a 16th-note shuffle, which is most of what "funky" is
  bars: [
    { chord: [57, 'min7'] }, { chord: [55, 'dom7'] },
    { chord: [53, 'maj'] },  { chord: [52, 'dom7'] },
    { chord: [57, 'min7'], lead: 'response' }, { chord: [55, 'dom7'], lead: 'response' },
    { chord: [53, 'maj'],  lead: 'response' }, { chord: [52, 'dom7'], lead: 'response', fill: true },
  ],

  // Root, root, octave, root, fifth, root, octave, root — the "on the one"
  // shape under all eight bars, an octave below the chord's own root.
  bass: [
    [0, 0, 3], [3, 0, 1], [4, 12, 2], [6, 0, 2],
    [8, 7, 2], [10, 0, 1], [12, 12, 2], [14, 0, 2],
  ],
  /* Triangle rather than sawtooth or square, and both filtered — a saw and
     a square are the two waveforms that read as "video game" before a
     single note plays, because they carry every harmonic at full strength;
     a triangle only carries the odd ones and carries them quietly, which is
     most of the difference between a chiptune and a synth bass. */
  bassType: 'triangle',
  bassCut: 700,          // low-passed for a rounder, less buzzy low end
  bassLevel: 0.17,

  // The call: a short hook an octave above the root, syncopated against
  // the bass rather than doubling it — the two only land together on the
  // downbeat.
  lead: [
    [0, 12, 2], [2, 15, 1], [6, 19, 2], [9, 17, 1], [12, 15, 3],
  ],
  // The response: starts on the "and" of beat 1 instead of the downbeat,
  // climbs to a 9th the call never reaches, and resolves down through a
  // passing tone instead of holding — a real answer, not an echo.
  leadResponse: [
    [3, 15, 1], [4, 19, 2], [8, 22, 1], [10, 19, 2], [13, 17, 1], [14, 15, 2],
  ],
  leadType: 'triangle',
  leadCut: 3400,
  leadLevel: 0.08,

  // The stab: every chord tone but the root, on the off-beat, quiet and
  // low-passed — a rhythm-guitar skank sitting between the bass and lead
  // registers, not a pad.
  stabAt: [3, 11],
  stabType: 'sawtooth',
  stabCut: 1100,
  stabLevel: 0.045,

  kickAt: [0, 6, 8, 14],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [15],
};

/* The Warren: underground, mechanical, a digging machine's steady chug
 * rather than a groove. Square wave instead of triangle for a grittier
 * core, heavily low-passed so it reads as gritty-but-warm rather than
 * harsh; a steady four-on-the-floor pulse on the bass root instead of
 * Park's syncopated root/octave/fifth pattern, because a tunnel does not
 * swing. Minor throughout, lower register, barely any swing at all.
 */
export const WARREN_SONG = {
  bpm: 96,
  swing: 0.04,
  bars: [
    { chord: [48, 'min7'] }, { chord: [44, 'maj'] },
    { chord: [51, 'maj'] },  { chord: [46, 'dom7'] },
    { chord: [48, 'min7'], lead: 'response' }, { chord: [44, 'maj'], lead: 'response' },
    { chord: [51, 'maj'],  lead: 'response' }, { chord: [46, 'dom7'], lead: 'response', fill: true },
  ],

  // A steady chug on the root, quarter notes, an octave down — an engine's
  // pulse, not a funk pattern.
  bass: [
    [0, 0, 2], [4, 0, 2], [8, 0, 2], [12, 0, 2],
  ],
  bassType: 'square',
  bassCut: 500,
  bassLevel: 0.14,

  // Sparse, mechanical calls rather than a hook — space is part of the
  // sound of a tunnel.
  lead: [
    [0, 12, 3], [8, 12, 3], [12, 15, 2],
  ],
  leadResponse: [
    [2, 10, 2], [6, 12, 1], [10, 17, 2], [13, 15, 1],
  ],
  leadType: 'square',
  leadCut: 1200,
  leadLevel: 0.06,

  // One stab per bar, not two — sparser than Park across the board.
  stabAt: [7],
  stabType: 'square',
  stabCut: 900,
  stabLevel: 0.035,

  kickAt: [0, 4, 8, 12],
  snareAt: [8],
  hatAt: [2, 10],
  openHatAt: [],
};

/* The Orchard: bright, bouncy, a I-V-vi-IV daylight progression instead of
 * a minor walk-down. Triangle bass keeps Park's warmth but skips through
 * root-octave-fifth-octave instead of a syncopated funk pattern; the lead
 * sits an octave higher and the filters open up (both cutoffs well above
 * Park's) for a lighter, more open top end; the hats are dense and lively
 * rather than sparse, for a daytime-orchard feel instead of a park-at-dusk
 * one.
 */
export const ORCHARD_SONG = {
  bpm: 132,
  swing: 0.18,
  bars: [
    { chord: [60, 'maj'] },  { chord: [55, 'dom7'] },
    { chord: [57, 'min7'] }, { chord: [53, 'maj'] },
    { chord: [60, 'maj'], lead: 'response' },  { chord: [55, 'dom7'], lead: 'response' },
    { chord: [57, 'min7'], lead: 'response' }, { chord: [53, 'maj'], lead: 'response', fill: true },
  ],

  // A skipping root-octave-fifth-octave bounce, eight hits a bar — livelier
  // and denser than Park's syncopated funk pattern.
  bass: [
    [0, 0, 1], [2, 12, 1], [4, 7, 1], [6, 12, 1],
    [8, 0, 1], [10, 12, 1], [12, 7, 1], [14, 12, 1],
  ],
  bassType: 'triangle',
  bassCut: 1400,
  bassLevel: 0.15,

  lead: [
    [0, 19, 2], [3, 22, 1], [6, 24, 2], [10, 22, 1], [13, 19, 2],
  ],
  leadResponse: [
    [1, 22, 1], [4, 26, 2], [8, 24, 1], [11, 22, 2], [14, 19, 1],
  ],
  leadType: 'triangle',
  leadCut: 5000,
  leadLevel: 0.075,

  stabAt: [2, 6, 10, 14],
  stabType: 'sawtooth',
  stabCut: 2000,
  stabLevel: 0.04,

  kickAt: [0, 8],
  snareAt: [4, 12],
  hatAt: [0, 2, 4, 6, 8, 10, 12, 14],
  openHatAt: [7, 15],
};

/* The Grove: a goose that does not give up, so the music does not relax
 * either. Sawtooth rather than triangle or square, for the grittiest edge
 * of the four, and the fastest tempo with the tightest swing — driving
 * rather than funky or bouncy or mechanical. i-VII-VI-V7 instead of a plain
 * walk-down: that last chord is real dominant tension aimed back at the
 * first, which the other three songs never reach for, and it is what makes
 * the loop feel like it is chasing something instead of strolling past it.
 */
export const GROVE_SONG = {
  bpm: 140,
  swing: 0.06,
  bars: [
    { chord: [52, 'min7'] }, { chord: [50, 'dom7'] },
    { chord: [48, 'maj'] },  { chord: [47, 'dom7'] },
    { chord: [52, 'min7'], lead: 'response' }, { chord: [50, 'dom7'], lead: 'response' },
    { chord: [48, 'maj'],  lead: 'response' }, { chord: [47, 'dom7'], lead: 'response', fill: true },
  ],

  // A driving eighth-note pulse, root and fifth only — urgency, not funk.
  bass: [
    [0, 0, 1], [2, 0, 1], [4, 7, 1], [6, 0, 1],
    [8, 0, 1], [10, 0, 1], [12, 7, 1], [14, 0, 1],
  ],
  bassType: 'sawtooth',
  bassCut: 900,
  bassLevel: 0.13,

  // Short, repeated alarm-calls rather than a melody that resolves —
  // a lead that keeps circling back on itself instead of going anywhere.
  lead: [
    [0, 14, 1], [1, 14, 1], [6, 17, 1], [7, 17, 1], [11, 19, 2],
  ],
  leadResponse: [
    [2, 17, 1], [3, 17, 1], [8, 19, 1], [9, 19, 1], [12, 22, 2],
  ],
  leadType: 'sawtooth',
  leadCut: 2400,
  leadLevel: 0.06,

  stabAt: [5, 9, 13],
  stabType: 'sawtooth',
  stabCut: 1300,
  stabLevel: 0.04,

  kickAt: [0, 3, 6, 8, 11, 14],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [15],
};

/* The Aerie: open and unhurried where the other three are busy — a slower
 * tempo, a sparser bass (root and fifth only, each held out rather than
 * chopped into a pattern), and a sine lead in place of every other song's
 * triangle, square or sawtooth. A sine carries only its own note, no
 * harmonics riding along with it, which is what a chiptune waveform never
 * quite manages and what a wide-open sky sounds like next to a tunnel or an
 * orchard. Extra open hi-hats rather than extra kicks or snares, for the
 * same reason — air moving, not a beat landing.
 */
export const AERIE_SONG = {
  bpm: 108,
  swing: 0.15,
  bars: [
    { chord: [53, 'maj'] },  { chord: [60, 'maj'] },
    { chord: [62, 'min7'] }, { chord: [58, 'maj'] },
    { chord: [53, 'maj'], lead: 'response' },  { chord: [60, 'maj'], lead: 'response' },
    { chord: [62, 'min7'], lead: 'response' }, { chord: [58, 'maj'], lead: 'response', fill: true },
  ],

  // Root, then the fifth, each held for half a bar — open space between the
  // two hits rather than a pattern filling every step.
  bass: [
    [0, 0, 4], [8, 7, 4],
  ],
  bassType: 'triangle',
  bassCut: 1800,
  bassLevel: 0.13,

  // A slow rise and fall, sustained notes rather than a riff of short ones —
  // the other three songs' leads move about; this one drifts.
  lead: [
    [0, 19, 3], [4, 22, 2], [8, 24, 3], [12, 22, 2],
  ],
  leadResponse: [
    [2, 22, 2], [6, 26, 3], [10, 24, 2], [13, 19, 3],
  ],
  leadType: 'sine',
  leadLevel: 0.09,

  stabAt: [7, 15],
  stabType: 'triangle',
  stabCut: 2500,
  stabLevel: 0.035,

  kickAt: [0, 8],
  snareAt: [4, 12],
  hatAt: [2, 10],
  openHatAt: [6, 14],
};

/* The Spire: the one level tall and mean enough to earn a genuinely
 * sinister track. Where the other five stay diatonic — a walk-down, a
 * chug, a bright progression, a chase, an open drift — this one crawls
 * down by the half step, min7 to dom7 to min7 to dom7, each chord a
 * semitone under the last rather than a real cadence: four bars that never
 * resolve, only fall further, and the second pass falls the exact same
 * way again instead of climbing back to answer it. The lead sits a
 * dissonant minor second above its own chord as often as a chord tone,
 * which is the one interval the other five songs never reach for — an
 * uneasy clash by design, not a wrong note. Slower than every song but
 * The Aerie's, with almost no swing at all: not funky, not driving, just
 * heavy, the bass hooded under a low-pass cut darker than any other
 * track's. Sparse kick, an off-kilter snare that never lands where Park's
 * or Grove's does, and a hi-hat ticking like a clock rather than keeping
 * a groove — dread with a pulse, not a beat to nod along to.
 */
export const SPIRE_SONG = {
  bpm: 84,
  swing: 0.02,
  bars: [
    { chord: [45, 'min7'] }, { chord: [44, 'dom7'] },
    { chord: [43, 'min7'] }, { chord: [42, 'dom7'] },
    { chord: [45, 'min7'], lead: 'response' }, { chord: [44, 'dom7'], lead: 'response' },
    { chord: [43, 'min7'], lead: 'response' }, { chord: [42, 'dom7'], lead: 'response', fill: true },
  ],

  // Root only, twice a bar, nothing else moving under it — a thud rather
  // than a line, which is what keeps this from ever reading as a walk.
  bass: [
    [0, 0, 3], [3, 0, 1], [8, 0, 3], [11, 0, 1],
  ],
  bassType: 'square',
  bassCut: 380,
  bassLevel: 0.16,

  // A creeping half-step crawl above the chord — semis 12 and 13 sit a
  // minor second apart, the clash the rest of this file never writes.
  lead: [
    [0, 12, 2], [2, 13, 1], [4, 12, 2], [9, 15, 2], [13, 12, 3],
  ],
  leadResponse: [
    [1, 15, 1], [5, 13, 1], [6, 12, 2], [10, 18, 1], [12, 15, 2], [14, 12, 2],
  ],
  leadType: 'sawtooth',
  leadCut: 1500,
  leadLevel: 0.065,

  stabAt: [7, 15],
  stabType: 'square',
  stabCut: 700,
  stabLevel: 0.04,

  // Sparse and off-kilter on purpose — a snare that never lands with the
  // kick reads as uneasy in a way a steady backbeat cannot.
  kickAt: [0, 8],
  snareAt: [6, 14],
  hatAt: [2, 4, 10, 12],
  openHatAt: [15],
};

/* The Falls: the one level that is a descent from end to end, so the lead
 * is built to actually fall — a run of four or five notes tumbling down in
 * pitch within a single bar, rather than the held or rising phrases every
 * other song here uses. Where Park's own walk-down moves the chord under a
 * held lead, this moves the lead itself, bar after bar, the same cascade
 * repeating at a new height each time the chord changes under it — water
 * over three separate drops, not one. The bass answers in kind, a short
 * three-note run down by whole steps rather than a held root, so nothing
 * in the arrangement just sits still. Brighter and quicker than The
 * Spire's dread on purpose — a fall is not a threat lying in wait, it is
 * motion — with hi-hats open more often than closed, the closest this
 * palette gets to the sound of water actually landing.
 */
export const FALLS_SONG = {
  bpm: 118,
  swing: 0.08,
  bars: [
    { chord: [62, 'dom7'] }, { chord: [60, 'maj'] },
    { chord: [58, 'maj'] },  { chord: [57, 'dom7'] },
    { chord: [62, 'dom7'], lead: 'response' }, { chord: [60, 'maj'], lead: 'response' },
    { chord: [58, 'maj'],  lead: 'response' }, { chord: [57, 'dom7'], lead: 'response', fill: true },
  ],

  // A short run down by whole steps, twice a bar — the bass itself
  // cascading rather than holding a root under the lead's own fall.
  bass: [
    [0, 0, 1], [1, -2, 1], [2, -4, 2], [8, 0, 1], [9, -2, 1], [10, -4, 2],
  ],
  bassType: 'triangle',
  bassCut: 1200,
  bassLevel: 0.15,

  // The cascade itself: four notes tumbling down from a high start, twice
  // a bar, each run beginning a little differently than the last so it
  // reads as falling water rather than a repeated riff.
  lead: [
    [0, 24, 1], [1, 21, 1], [2, 19, 1], [3, 17, 2], [8, 26, 1], [9, 22, 1], [10, 19, 1], [11, 17, 2],
  ],
  leadResponse: [
    [0, 27, 1], [1, 24, 1], [2, 20, 1], [3, 17, 1], [4, 15, 2],
    [9, 24, 1], [10, 20, 1], [11, 17, 1], [12, 15, 2],
  ],
  leadType: 'triangle',
  leadCut: 4200,
  leadLevel: 0.08,

  stabAt: [6, 14],
  stabType: 'triangle',
  stabCut: 1800,
  stabLevel: 0.04,

  kickAt: [0, 8],
  snareAt: [4, 12],
  hatAt: [2, 6, 10],
  openHatAt: [3, 7, 11, 15],
};

/* Everything from The Hedgerow on had no song at all. `play()` looks the
 * level's id up in SONGS and quietly sets `song = null` when it misses, so
 * five levels ran in silence with a Music button that claimed to be on —
 * the failure mode of a lookup table that nobody made add up to the list it
 * is indexed by. There is a test now that the two match.
 */

/* Hops. Short notes, nothing held, the bass jumping off the beat as much as
   on it — the one level built entirely out of small leaps. */
export const HEDGEROW_SONG = {
  bpm: 126,
  swing: 0.1,
  bars: [
    { chord: [62, 'min7'] }, { chord: [67, 'dom7'] },
    { chord: [60, 'maj'] },  { chord: [57, 'dom7'] },
    { chord: [62, 'min7'], lead: 'response' }, { chord: [67, 'dom7'], lead: 'response' },
    { chord: [60, 'maj'],  lead: 'response' }, { chord: [57, 'dom7'], lead: 'response', fill: true },
  ],
  bass: [[0, 0, 1], [3, 0, 1], [6, 7, 1], [8, 0, 1], [11, 0, 1], [14, 5, 1]],
  bassType: 'triangle',
  bassCut: 1100,
  bassLevel: 0.15,
  lead: [[0, 12, 1], [2, 16, 1], [4, 19, 2], [8, 12, 1], [10, 16, 1], [12, 21, 2]],
  leadResponse: [[0, 19, 1], [2, 24, 1], [4, 21, 1], [6, 19, 2], [10, 16, 1], [12, 19, 1], [14, 24, 2]],
  leadType: 'square',
  leadCut: 3200,
  leadLevel: 0.05,
  stabAt: [5, 13],
  stabType: 'triangle',
  stabCut: 1700,
  stabLevel: 0.04,
  kickAt: [0, 8],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [7, 15],
};

/* Height and air. The slowest thing here, long held notes and open fifths,
   a kick that lands twice a bar and mostly gets out of the way. */
export const OVERLOOK_SONG = {
  bpm: 96,
  swing: 0.04,
  bars: [
    { chord: [65, 'maj'] },  { chord: [60, 'maj'] },
    { chord: [67, 'maj'] },  { chord: [57, 'min7'] },
    { chord: [65, 'maj'], lead: 'response' },  { chord: [60, 'maj'], lead: 'response' },
    { chord: [67, 'maj'], lead: 'response' },  { chord: [57, 'min7'], lead: 'response', fill: true },
  ],
  bass: [[0, 0, 4], [8, 7, 4]],
  bassType: 'sine',
  bassCut: 900,
  bassLevel: 0.16,
  lead: [[0, 12, 4], [4, 16, 4], [8, 19, 6]],
  leadResponse: [[0, 19, 4], [6, 24, 4], [12, 21, 4]],
  leadType: 'triangle',
  leadCut: 4600,
  leadLevel: 0.075,
  stabAt: [6, 14],
  stabType: 'triangle',
  stabCut: 2200,
  stabLevel: 0.035,
  kickAt: [0, 8],
  snareAt: [8],
  hatAt: [4, 12],
  openHatAt: [14],
};

/* The staircase, written as one: the bass walks up in whole steps and the
   lead climbs a scale a step at a time, then comes back down on the answer.
   The only tune here whose shape is the level's shape. */
export const STONES_SONG = {
  bpm: 110,
  swing: 0.08,
  bars: [
    { chord: [60, 'maj'] },  { chord: [62, 'min7'] },
    { chord: [65, 'maj'] },  { chord: [67, 'dom7'] },
    { chord: [60, 'maj'], lead: 'response' },  { chord: [62, 'min7'], lead: 'response' },
    { chord: [65, 'maj'], lead: 'response' },  { chord: [67, 'dom7'], lead: 'response', fill: true },
  ],
  bass: [[0, 0, 2], [4, 4, 2], [8, 7, 2], [12, 12, 2]],
  bassType: 'triangle',
  bassCut: 1000,
  bassLevel: 0.15,
  lead: [
    [0, 0, 1], [2, 2, 1], [4, 4, 1], [6, 5, 1],
    [8, 7, 1], [10, 9, 1], [12, 11, 1], [14, 12, 2],
  ],
  leadResponse: [
    [0, 12, 1], [2, 11, 1], [4, 9, 1], [6, 7, 2],
    [10, 4, 1], [12, 2, 1], [14, 0, 2],
  ],
  leadType: 'triangle',
  leadCut: 3800,
  leadLevel: 0.07,
  stabAt: [3, 11],
  stabType: 'triangle',
  stabCut: 1800,
  stabLevel: 0.04,
  kickAt: [0, 8],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [15],
};

/* A tower, so: bells. A tolling bass held half a bar at a time under a
   sparse, very high triangle, and almost no kit — one kick at the top of
   the bar and one snare in the middle, which is as close to a bell tower as
   four voices and a noise burst get. */
export const BELFRY_SONG = {
  bpm: 88,
  swing: 0,
  bars: [
    { chord: [57, 'min7'] }, { chord: [65, 'maj'] },
    { chord: [60, 'maj'] },  { chord: [67, 'dom7'] },
    { chord: [57, 'min7'], lead: 'response' }, { chord: [65, 'maj'], lead: 'response' },
    { chord: [60, 'maj'], lead: 'response' },  { chord: [67, 'dom7'], lead: 'response', fill: true },
  ],
  bass: [[0, 0, 6], [8, 0, 6]],
  bassType: 'sine',
  bassCut: 800,
  bassLevel: 0.17,
  lead: [[0, 24, 3], [4, 19, 3], [8, 28, 3], [12, 24, 3]],
  leadResponse: [[0, 31, 3], [4, 28, 3], [8, 24, 4], [14, 19, 2]],
  leadType: 'triangle',
  leadCut: 5200,
  leadLevel: 0.07,
  stabAt: [6, 14],
  stabType: 'sine',
  stabCut: 2400,
  stabLevel: 0.045,
  kickAt: [0],
  snareAt: [8],
  hatAt: [4, 12],
  openHatAt: [15],
};

/* One duckling walking a very long way round, so a walking bass — eight
   notes a bar, up and back down, never stopping — with a lead that strolls
   over the top of it rather than hurrying. */
export const ERRAND_SONG = {
  bpm: 104,
  swing: 0.12,
  bars: [
    { chord: [57, 'min7'] }, { chord: [62, 'dom7'] },
    { chord: [67, 'maj'] },  { chord: [64, 'min7'] },
    { chord: [57, 'min7'], lead: 'response' }, { chord: [62, 'dom7'], lead: 'response' },
    { chord: [67, 'maj'], lead: 'response' },  { chord: [64, 'min7'], lead: 'response', fill: true },
  ],
  bass: [
    [0, 0, 1], [2, 2, 1], [4, 4, 1], [6, 5, 1],
    [8, 7, 1], [10, 5, 1], [12, 4, 1], [14, 2, 1],
  ],
  bassType: 'triangle',
  bassCut: 1000,
  bassLevel: 0.15,
  lead: [[0, 7, 2], [3, 9, 1], [4, 12, 2], [8, 11, 1], [10, 9, 2], [13, 7, 3]],
  leadResponse: [[0, 12, 2], [3, 14, 1], [4, 16, 2], [8, 14, 1], [10, 12, 2], [13, 9, 3]],
  leadType: 'triangle',
  leadCut: 3600,
  leadLevel: 0.075,
  stabAt: [6, 14],
  stabType: 'triangle',
  stabCut: 1700,
  stabLevel: 0.04,
  kickAt: [0, 8],
  snareAt: [4, 12],
  hatAt: [2, 6, 10, 14],
  openHatAt: [7],
};

export const SONGS = {
  park: PARK_SONG, warren: WARREN_SONG, orchard: ORCHARD_SONG, grove: GROVE_SONG, aerie: AERIE_SONG,
  spire: SPIRE_SONG, falls: FALLS_SONG, hedgerow: HEDGEROW_SONG, overlook: OVERLOOK_SONG,
  stones: STONES_SONG, belfry: BELFRY_SONG, errand: ERRAND_SONG,
};

/* ------------------------------------------------------------------ engine --- */

export function createAudio(){
  let ctx = null, bus = null;
  let timer = null, step = 0, nextTime = 0;
  let song = null, songName = null;
  let muted = false;
  try{ muted = localStorage.getItem('ddq-muted') === '1'; }catch{ /* private mode */ }

  function ensure(){
    if(!ctx){
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      bus = ctx.createGain();
      bus.gain.value = muted ? 0 : 0.5;
      bus.connect(ctx.destination);
    }
    if(ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* One note. `cut` is optional — a low-pass cutoff that gives the funk bass
     its rounded, plucked shape instead of a raw sawtooth buzz. */
  function voice(freq, t, dur, type, vol, glideTo, cut){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if(glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if(cut){
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cut;
      f.Q.value = 1.2;
      o.connect(f);
      out = f;
    }
    out.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /* Filtered noise: kick's click aside, every drum here is one of these.
     `sweepTo` is optional — a filter that opens or closes as the noise
     plays, rather than sitting at one fixed cutoff, which is what turns a
     click into a puff of air with a shape to it. */
  function hit(t, dur, vol, cut, type = 'highpass', sweepTo){
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type;
    f.frequency.setValueAtTime(cut, t);
    if(sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t);
  }

  /* ---- the sequencer ---------------------------------------------------- */

  function scheduleStep(s, t){
    const cfg = song;
    const stepsPerBar = 16;
    const totalSteps = cfg.bars.length * stepsPerBar;
    const pos = s % totalSteps;
    const bar = Math.floor(pos / stepsPerBar);
    const inBar = pos % stepsPerBar;
    const stepLen = 60 / cfg.bpm / 4;
    const barCfg = cfg.bars[bar];
    const [root, quality] = barCfg.chord;

    for(const [at, semis, len] of cfg.bass){
      if(at === inBar) voice(midi(root - 12 + semis), t, stepLen * len * 0.92, cfg.bassType, cfg.bassLevel, null, cfg.bassCut);
    }

    const leadPattern = barCfg.lead === 'response' ? cfg.leadResponse : cfg.lead;
    for(const [at, semis, len] of leadPattern){
      if(at === inBar) voice(midi(root + semis), t, stepLen * len * 0.85, cfg.leadType, cfg.leadLevel, null, cfg.leadCut);
    }

    // The chord's own shape, finally audible — see the header note above.
    if(cfg.stabAt && cfg.stabAt.includes(inBar)){
      for(const interval of QUALITIES[quality]){
        if(interval === 0) continue; // the bass already has the root
        voice(midi(root + interval), t, stepLen * 0.9, cfg.stabType, cfg.stabLevel, null, cfg.stabCut);
      }
    }

    if(cfg.kickAt.includes(inBar)) voice(112, t, 0.09, 'sine', 0.2, 42);
    if(cfg.snareAt.includes(inBar)) hit(t, 0.09, 0.13, 2200);
    if(cfg.hatAt.includes(inBar)) hit(t, 0.035, 0.05, 8500);
    if(cfg.openHatAt.includes(inBar)) hit(t, 0.15, 0.045, 7500);
    // The turnaround: a quick pickup into the loop's start, on the last bar only.
    if(barCfg.fill && inBar >= 12) hit(t, 0.05, 0.085, 2600);
  }

  function pump(){
    const stepLen = 60 / song.bpm / 4;
    while(nextTime < ctx.currentTime + 0.12){
      // Swing on the off 16th only, which is what keeps a shuffle from
      // turning into a slower straight beat.
      const swing = (step % 2 === 1) ? song.swing * stepLen : 0;
      scheduleStep(step, nextTime + swing);
      step += 1;
      nextTime += stepLen;
    }
  }

  function play(name){
    if(songName === name) return;
    if(!ctx){ songName = name; song = SONGS[name] || null; return; } // starts on first gesture
    songName = name;
    song = SONGS[name] || null;
    clearInterval(timer);
    timer = null;
    if(!song) return;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(() => pump(), 40);
  }

  /* Called from the first user gesture: builds the context and starts
     whatever play() was asked for while the page had no audio yet. */
  function unlock(){
    ensure();
    if(song && !timer){
      step = 0;
      nextTime = ctx.currentTime + 0.05;
      timer = setInterval(() => pump(), 40);
    }
  }

  function stop(){
    clearInterval(timer);
    timer = null;
    song = null;
    songName = null;
  }

  function setMuted(next){
    muted = !!next;
    try{ localStorage.setItem('ddq-muted', muted ? '1' : '0'); }catch{ /* fine */ }
    if(bus) bus.gain.value = muted ? 0 : 0.5;
  }

  /* ---- sound effects ------------------------------------------------ */

  /* A quack, built out of what a duck actually is.
   *
   * The first pass at this was a sawtooth through three formants at
   * 850/1900/3000 Hz with the pitch swooping 430 -> 590 -> 240, which is a
   * human "a" vowel sung by a kazoo. It is not what a mallard does, and it
   * sounded like it. This one is built from the published acoustics
   * instead, and every number below is either measured from a bird or
   * derived from one:
   *
   *   Source. The syrinx is a pair of membranes slapping shut, so the
   *   source is a pulse train — near-flat in the harmonics, not a
   *   sawtooth's 6 dB an octave, which is why the old one had nothing left
   *   above 2 kHz and a quack has energy out past 6. F0 sits around 200 Hz
   *   and barely moves: 230 falling to 178 over the note. The old swoop up
   *   through 590 was most of why it read as cartoon rather than bird.
   *
   *   Filter. A mallard's trachea is 14-18 cm, open at one end, which is a
   *   quarter-wave tube: its resonances are the odd series c/4L, 3c/4L,
   *   5c/4L... At 16 cm that is 536, 1608, 2680 and 3752 Hz, and those are
   *   the formants. Their Q is low, because a tube is a broad resonator —
   *   narrow bands leave canyons between the formants that no animal has.
   *   The levels climb up the series to pay back the source's own rolloff:
   *   the tube does not favour its first resonance, the source does.
   *
   *   Rasp. A quack is broadband, roughly 0.1 to 8 kHz. A little noise
   *   around 2.2 kHz rides the same envelope, as its own layer rather than
   *   pushed through the formants — noise through narrow bandpasses comes
   *   out as a hum.
   *
   *   Shape. A hard onset, a brief hold and a decay. One note struck, not a
   *   syllable that dips in the middle the way the old one did; and the
   *   formants slide down a fifth over the note, which is the bill closing.
   */
  const TRACHEA_CM = 16;
  const QUACK_F1 = 34300 / (4 * TRACHEA_CM);   // 536 Hz, and the series off it

  /* [which resonance of the series, Q, level]. The Qs were picked by
     rendering the thing offline and looking at where the energy actually
     landed: at 2 and above there is a hole between the first and second
     resonances twenty-four decibels deep, which no animal has, and at 1.2
     the resonances smear together and the tube stops being a tube. At 1.6
     the spectrum runs unbroken from 250 Hz to 6 kHz — which is the band a
     mallard's quack is measured to occupy — with the series still legible
     in it. */
  const QUACK_TUBE = [[1, 1.6, 1], [3, 1.92, 0.9], [5, 2.24, 0.7], [7, 2.56, 0.45]];

  // Built once and reused: the harmonics of the syringeal pulse, rolled off
  // at 1/n^0.35 — about 3 dB an octave, near enough flat to carry the tube's
  // upper resonances.
  let quackWave = null;
  function pulseWave(){
    if(quackWave) return quackWave;
    const N = 40;
    const real = new Float32Array(N), imag = new Float32Array(N);
    for(let n = 1; n < N; n++) imag[n] = 1 / Math.pow(n, 0.35);
    quackWave = ctx.createPeriodicWave(real, imag);
    return quackWave;
  }

  function quackSyllable(t, dur, vol, f0 = 230, fEnd = 178){
    const out = ctx.createGain();
    out.gain.value = vol;
    out.connect(bus);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.006);
    env.gain.setValueAtTime(1, t + dur * 0.18);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(out);

    const o = ctx.createOscillator();
    o.setPeriodicWave(pulseWave());
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);

    // Jitter: a real pair of membranes never holds a perfectly steady
    // pitch, and a perfectly steady one is always a synth.
    const jitter = ctx.createOscillator();
    jitter.type = 'sine';
    jitter.frequency.value = 44;
    const jitterDepth = ctx.createGain();
    jitterDepth.gain.value = 12;
    jitter.connect(jitterDepth).connect(o.frequency);

    for(const [mult, q, level] of QUACK_TUBE){
      const f = QUACK_F1 * mult;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(f, t);
      band.frequency.exponentialRampToValueAtTime(f * 0.82, t + dur);
      band.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(band).connect(g).connect(env);
    }

    // The rasp.
    const nz = ctx.createBufferSource();
    const n = Math.floor(ctx.sampleRate * (dur + 0.05));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    nz.buffer = buf;
    const raspBand = ctx.createBiquadFilter();
    raspBand.type = 'bandpass';
    raspBand.frequency.value = 2200;
    raspBand.Q.value = 0.7;
    const raspGain = ctx.createGain();
    raspGain.gain.value = 0.12;
    nz.connect(raspBand).connect(raspGain).connect(env);

    o.start(t); o.stop(t + dur + 0.02);
    jitter.start(t); jitter.stop(t + dur + 0.02);
    nz.start(t); nz.stop(t + dur + 0.02);
  }

  /* The duckling that just made it.
   *
   * Loud on purpose, relative to the music bed it plays over (bassLevel
   * 0.17, leadLevel 0.08) — this is the one sound in the game that means
   * "a duckling just made it home", and it was getting lost under the
   * backing track instead of landing as a payoff.
   */
  const SFX = {
    // "Quack quack" — one call on its own reads as a blip; a duck actually
    // says it twice, the second call close on the heel of the first rather
    // than evenly spaced, and a little quieter and shorter — an echo of the
    // first, not a repeat of it.
    quack(t){
      /* The decrescendo call, which is the one a mallard is famous for: a
         run of notes with the accent on the first and each one after it
         quieter, shorter and a shade lower. Two of them here rather than
         the two-to-ten a real bird uses — this fires once per duckling
         saved, up to twenty times in a run, and a full descrescendo every
         time would be the loudest thing in the game by a distance. */
      // A short puff of breath on the attack, under the note rather than
      // in front of it — this is the air, not the voice.
      hit(t, 0.02, 0.04, 1800, 'bandpass');
      quackSyllable(t, 0.20, 0.62, 230, 178);

      const t2 = t + 0.23;
      hit(t2, 0.018, 0.03, 1800, 'bandpass');
      quackSyllable(t2, 0.16, 0.43, 216, 172);
    },

    /* The duckling that didn't — two sounds, not one, matching the poof it
     * plays alongside (see art.js): a puff of air for the burst of down,
     * and a soft knock underneath for the landing. This can fire up to
     * nine times in one run, so both halves stay quiet — it has to read as
     * a small shame, not a punishment, or it turns grating fast.
     */
    lost(t){
      // The puff: noise swept bright to dark as it settles, rather than
      // sitting at one muffled cutoff the whole time.
      hit(t, 0.2, 0.17, 2400, 'bandpass', 420);
      // The thump: a low sine falling under the puff, for the landing
      // rather than for the feathers.
      voice(150, t, 0.12, 'sine', 0.14, 62, 300);
    },

    /* The goose actually catching one — its own sound, not the generic
     * `lost` above, because losing one to a wall or a gap is a mistake and
     * this is a hunt landing. A honk first, harsher and lower than
     * anything `quackSyllable` makes (a plain sawtooth through one narrow
     * band, none of the quack's three-formant throat), then the caught
     * duckling's own startled cry close behind it rather than under it —
     * two distinct voices, the same reason the hunt and the catch are two
     * different things in sim.js. At most once a run (see sim.js's
     * `goose.fed`), so this can afford to be the loudest thing here.
     */
    goosed(t){
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(130, t + 0.17);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(480, t);
      band.frequency.exponentialRampToValueAtTime(300, t + 0.17);
      band.Q.value = 2.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.24, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
      o.connect(band).connect(g).connect(bus);
      o.start(t); o.stop(t + 0.2);

      // The catch, hard on the honk's heel — short and sharp rather than
      // the two full, rounded syllables a safe arrival gets.
      quackSyllable(t + 0.1, 0.09, 0.55);
    },

    /* A new duckling, right as it steps out of the nest — quick and light,
     * because this is the one sound here that can fire thirty times in a
     * single run (see content.js's duckCount) and still has to sit under
     * everything else, not on top of it. A crack for the shell first, then
     * one short peep gliding up rather than down — an entrance, the
     * opposite shape from `lost`'s falling puff.
     */
    /* It was there all along and nobody could hear it: measured against the
       others it peaked at eight per cent of the quack, which under the music
       and out of a phone speaker is silence. "Sits under everything else"
       had been taken as far as inaudible. Four times the level and half
       again the length of the peep — still the quietest thing here after the
       zap, and still well under the quack, but now actually a sound. */
    hatch(t){
      hit(t, 0.025, 0.2, 3200, 'bandpass');
      voice(950, t + 0.008, 0.12, 'triangle', 0.19, 1500, 5000);
    },

    /* A teleporter taking a duckling — the one thing in this game that is
     * not an animal or a piece of weather, so it is the one sound here
     * allowed to be electric. A square wave sliding up two octaves in a
     * tenth of a second is the whole of it: rising rather than falling,
     * because a duckling is arriving somewhere rather than going down, and
     * a square rather than the triangles and sines everything else uses,
     * because that buzz is what makes it read as a machine.
     *
     * A sparkle of bright noise on top, short enough to be a spark rather
     * than a hiss, and a quiet low thump under it so the pad sounds like it
     * has some weight to it. Quiet overall: on a level built around a pair
     * of pads this can fire for every duckling in the flock, thirty times
     * in a run, and a zap that punished a player for using the mechanic the
     * level is about would be the wrong sound however good it was.
     */
    zap(t){
      voice(300, t, 0.1, 'square', 0.06, 1200, 4000);
      hit(t, 0.06, 0.05, 2600, 'highpass');
      voice(90, t + 0.02, 0.09, 'sine', 0.05, 60);
    },
  };

  function sfx(name){
    if(muted || !ctx) return;
    const fn = SFX[name];
    if(fn) fn(ctx.currentTime + 0.01);
  }

  /* Whether the context is actually producing sound, as opposed to merely
     existing. iOS Safari in particular can leave a freshly-created context
     `suspended` even after `resume()` is called from inside a gesture
     handler — the call does not throw, it just does not always take on the
     first try, which is why the page has to keep listening for a gesture
     rather than assuming the first one worked. */
  const isRunning = () => Boolean(ctx) && ctx.state === 'running';

  return { play, stop, unlock, sfx, setMuted, isMuted: () => muted, isRunning, current: () => songName };
}
