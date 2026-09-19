/* Good Vibe Beats — the scoring, in Node.
 *
 * All of it. The game is a clock, six noises and a set of rules about where a
 * hit landed, and only the last of those is worth testing — which is why the
 * rules are a module with no DOM, no audio and no clock in it. Everything
 * below drives `content.js` directly.
 *
 * What is pinned here is mostly the shape of the reward, not the numbers: that
 * the "and" pays more than the beat and the "e" more than the "and", that a
 * push needs the beat left empty, that mashing is worth less per hit than
 * playing. The exact points are prototype defaults and are meant to be tuned
 * from playtesting; the ordering is the game.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PADS, PAD_IDS, PAD_BY_ID, ANCHORS, XP_PER_LEVEL, levelOf, padUnlocked, padLayout, padsAt,
  BEATS_PER_BAR, STEPS_PER_BEAT, STEPS_PER_BAR, TRIPLETS_PER_BEAT, SNAP_EDGE,
  snap, slotKey, scoreHit, busyScale, BUSY_FROM,
  PERFECT_MS, GOOD_MS, PERFECT_POINTS, GOOD_POINTS,
  ANCHOR_BONUS, UPBEAT_MULT, SYNCOPE_MULT,
  PUSH_POINTS, FILL_POINTS, FRESH_POINTS, LOCKED_POINTS,
  OUT_OF_SONG, ALREADY_PLAYED, OFF_THE_GRID,
  onBeat, pushedInto, filledInto, barSignature, likeness, barBonus,
  PHRASE_BEATS, FILL_SPOTS, FRESH_UNDER, LOCKED_OVER, BAR_MIN_HITS,
  LESSONS, LESSON_BY_ID, lessonNotes, gradeLesson, LESSON_MS, STAR_AT,
  learnXp, jamXp, XP_PER_STAR, XP_PER_NEW_STAR,
  TRACKS, TRACK_BY_ID, secondsPerBeat, trackSpan,
  toSave, fromSave, SAVE_VERSION, OFFSET_MIN, OFFSET_MAX,
  CAL_CLICKS, CAL_INTERVAL, CAL_WARMUP, CAL_MIN_TAPS, CAL_WOBBLE, calibrationFrom,
  LATENCY_HIGH,
} from '../public/gvb/content.js';

const SPB = 60 / 104;                       // Funk world, and an awkward number
const at16 = n => n * SPB / STEPS_PER_BEAT; // seconds to the nth sixteenth

/* ------------------------------------------------------------------ the kit */

test('every pad carries the fields the game reads, and the keys are reachable', () => {
  assert.equal(new Set(PAD_IDS).size, PAD_IDS.length, 'duplicate pad id');
  const keys = PADS.map(p => p.key);
  assert.equal(new Set(keys).size, keys.length, 'two pads on one key');
  for(const p of PADS){
    assert.match(p.id, /^[a-z][a-z0-9-]*$/, `"${p.id}": id must be kebab-case`);
    assert.equal(typeof p.label, 'string');
    assert.ok(p.label.length, `"${p.id}": needs a label`);
    assert.match(p.key, /^[a-z]$/, `"${p.id}": the key must be one letter`);
    if(p.unlock) assert.ok(p.unlock >= 2, `"${p.id}": a pad locked at level 1 is a pad nobody can use`);
  }
  /* The four that start unlocked sit under the right hand on a keyboard, in
     order. If somebody re-letters them, they should have to mean it. */
  assert.deepEqual(PADS.slice(0, 4).map(p => p.key), ['f', 'g', 'h', 'j']);
});

test('pads unlock by level, and the locked ones are still on screen', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(XP_PER_LEVEL - 1), 1);
  assert.equal(levelOf(XP_PER_LEVEL), 2);
  assert.equal(levelOf(XP_PER_LEVEL * 4), 5);
  assert.equal(levelOf(-500), 1, 'a broken save must not hand out a negative level');

  assert.equal(padsAt(0).length, 4, 'four to begin with');
  assert.equal(padLayout(0).length, 4, 'and only four drawn, or the grid lies about what is coming');

  const two = XP_PER_LEVEL;
  assert.equal(padsAt(two).length, 5);
  assert.equal(padLayout(two).length, PADS.length,
    'once any extra pad is earned the whole kit is drawn, the locked one dimmed');
  assert.ok(!padUnlocked(PAD_BY_ID.crash, two), 'the crash is still locked at level 2');
  assert.ok(padUnlocked(PAD_BY_ID.crash, XP_PER_LEVEL * 2), 'and open at level 3');
});

/* ----------------------------------------------------------------- the grid */

test('a hit lands on the nearest sixteenth, and says where', () => {
  for(let n = 0; n < STEPS_PER_BAR; n++){
    const s = snap(at16(n), SPB);
    assert.equal(s.grid, 's', `step ${n} should be a sixteenth`);
    assert.equal(s.idx, n);
    assert.equal(s.s16, n);
    assert.ok(s.err < 1e-12, `step ${n} landed exactly and should read as exact`);
    assert.equal(s.beat, Math.floor(n / STEPS_PER_BEAT));
    assert.equal(s.sub, n % STEPS_PER_BEAT);
  }
});

test('the count-in is playable, so the grid runs backwards too', () => {
  const s = snap(-at16(2), SPB);
  assert.equal(s.idx, -2, 'a hit before the first downbeat is an anticipation of it');
  assert.equal(s.sub, 2, 'and it is the "and" of the beat before');
  assert.equal(s.beat, -1);
});

test('a swung hit takes the triplet grid, and a straight one never does', () => {
  // Two thirds of a beat: the second eighth-note triplet.
  const swung = snap(SPB * 2 / 3, SPB);
  assert.equal(swung.grid, 't');
  assert.equal(swung.idx, 2);
  assert.equal(swung.sub, 2);

  /* On the beat the two grids agree exactly, and the triplet must not take it:
     if it did, playing straight down the middle would pay the swing multiplier. */
  for(let beat = 0; beat < 8; beat++){
    assert.equal(snap(beat * SPB, SPB).grid, 's', `beat ${beat} must stay a sixteenth`);
  }

  /* And a sixteenth stays a sixteenth. The two grids are a 48th of a beat apart
     at their closest, so the margin has to be small enough not to swallow them. */
  for(const n of [1, 2, 3, 5, 6, 7, 9, 10, 11]){
    assert.equal(snap(at16(n), SPB).grid, 's', `the sixteenth at ${n} must not read as swing`);
  }
  assert.ok(SNAP_EDGE > 0 && SNAP_EDGE < SPB / 48,
    'the tie-break has to be smaller than the gap between the two grids');
});

test('the same pad twice in one slot is one hit, two pads in it are two', () => {
  const a = snap(at16(4), SPB);
  assert.equal(slotKey(a, 'snare'), slotKey(snap(at16(4) + 0.01, SPB), 'snare'),
    'a hit a hair late is the same slot');
  assert.notEqual(slotKey(a, 'snare'), slotKey(a, 'clap'));
  assert.notEqual(slotKey(a, 'snare'), slotKey(snap(at16(5), SPB), 'snare'));
});

/* -------------------------------------------------------------- the scoring */

const jam = (pad, rel, opts = {}) => scoreHit(pad, rel, SPB, { span: 1000, ...opts });

test('the spaces pay more than the beats, which is the whole game', () => {
  const beat = jam('hat', at16(0));
  const and  = jam('hat', at16(2));
  const e    = jam('hat', at16(1));
  const a    = jam('hat', at16(3));
  const swing = jam('hat', SPB * 2 / 3);

  for(const h of [beat, and, e, a, swing]) assert.ok(h.ok, 'all five landed on the grid');

  assert.equal(beat.mult, 1, 'on the beat is the plain rate');
  assert.equal(and.mult, UPBEAT_MULT);
  assert.equal(e.mult, SYNCOPE_MULT);
  assert.equal(a.mult, SYNCOPE_MULT);
  assert.equal(swing.mult, SYNCOPE_MULT);

  assert.ok(and.points > beat.points, 'the "and" must beat the beat');
  assert.ok(e.points > and.points, 'the "e" must beat the "and"');
  assert.equal(e.points, a.points, 'the "e" and the "a" are the same idea');
  assert.equal(beat.type, 'down');
  assert.equal(and.type, 'up');
  assert.equal(e.type, 'sync');
  assert.equal(swing.label, 'Swing');
});

test('the groove anchors pay a little, and only where a drummer would put them', () => {
  // Kick on one and three, backbeat on two and four.
  for(const [pad, beats] of Object.entries(ANCHORS)){
    for(let b = 0; b < BEATS_PER_BAR; b++){
      const got = jam(pad, b * SPB);
      assert.ok(got.ok);
      const want = beats.includes(b);
      assert.equal(got.bonus, want ? ANCHOR_BONUS : 0,
        `${pad} on beat ${b + 1} should ${want ? '' : 'not '}be an anchor`);
      assert.equal(got.kind === 'groove', want);
    }
  }
  // A hat on the one is fine and not an anchor: it is not holding anything up.
  assert.equal(jam('hat', 0).bonus, 0);
  /* The anchor is worth much less than moving off the beat, or the game would
     be teaching people to play the same bar forever. */
  assert.ok(jam('kick', 0).points < jam('kick', at16(2)).points,
    'an anchored downbeat must still be worth less than an upbeat');
});

test('the timing windows are a ladder', () => {
  const nudge = ms => jam('hat', at16(4) + ms / 1000);
  assert.equal(nudge(0).quality, 'perfect');
  assert.equal(nudge(PERFECT_MS - 1).quality, 'perfect');
  assert.equal(nudge(PERFECT_MS + 1).quality, 'good');
  assert.equal(nudge(GOOD_MS - 1).quality, 'good');
  assert.ok(PERFECT_POINTS > GOOD_POINTS);
});

test('above about 94 BPM nothing can be off the grid at all', () => {
  /* Not a bug, but it is a fact about the tuning that is invisible on screen
   * and worth failing loudly if anybody changes it by accident.
   *
   * A hit is off the grid only if it is further than GOOD_MS from EVERY line,
   * and the furthest anything can be from the nearest sixteenth is half a
   * sixteenth. Above the tempo where half a sixteenth is narrower than the
   * window, every hit lands on something: "Off the grid" on the results screen
   * reads zero for the rest of the song, and the good window has stopped
   * deciding anything.
   *
   * Funk world is 104 BPM and is already past that line. Lo-fi world at 84 is
   * not. Both facts are pinned here so that a change to GOOD_MS, or a new
   * world at a new tempo, has to be a decision rather than a surprise.
   */
  const tightest = bpm => 60 / bpm / STEPS_PER_BEAT / 2 * 1000;   // half a sixteenth, in ms
  const cliff = 60 / (GOOD_MS / 1000 * STEPS_PER_BEAT * 2);
  assert.ok(cliff > 90 && cliff < 100, `the cliff is at ${cliff.toFixed(1)} BPM`);

  // Below it, being badly late really is being off the grid.
  const slow = 60 / 84;
  const late = scoreHit('hat', slow / STEPS_PER_BEAT * 4 + (GOOD_MS + 8) / 1000, slow, { span: 1000 });
  assert.equal(late.ok, false);
  assert.equal(late.why, OFF_THE_GRID);
  assert.ok(tightest(84) > GOOD_MS, 'Lo-fi world is slow enough to be able to miss');

  // Above it, nothing is: every hit is inside the window of something.
  assert.ok(tightest(104) < GOOD_MS, 'Funk world is past the cliff');
  const fast = 60 / 104;
  let worst = 0;
  for(let i = 0; i < 4000; i++) worst = Math.max(worst, snap(i * fast / 997, fast).err * 1000);
  assert.ok(worst < GOOD_MS,
    `at 104 BPM the worst possible miss is ${worst.toFixed(1)} ms, inside the ${GOOD_MS} ms window`);
});

test('a hit is refused before the song, after it, and the second time', () => {
  assert.equal(jam('kick', -SPB).why, OUT_OF_SONG, 'a whole beat early is not an anticipation');
  assert.equal(jam('kick', 1001).why, OUT_OF_SONG);
  assert.ok(jam('kick', -SPB / 2 + 0.001).ok, 'half a beat early still counts: that is a push');

  const taken = new Set();
  const first = jam('kick', at16(8), { taken });
  assert.ok(first.ok);
  taken.add(first.key);
  assert.equal(jam('kick', at16(8), { taken }).why, ALREADY_PLAYED);
  assert.ok(jam('snare', at16(8), { taken }).ok, 'a different pad in the same slot is a different hit');
});

test('mashing is worth less per hit than playing', () => {
  assert.equal(busyScale(1), 1);
  assert.equal(busyScale(BUSY_FROM), 1, 'a fast roll is still playing');
  assert.ok(busyScale(BUSY_FROM + 1) < 1);
  // Square, not linear: twice the mashing is a quarter of the pay.
  assert.ok(Math.abs(busyScale(BUSY_FROM * 2) - 0.25) < 1e-12);
  for(let n = BUSY_FROM; n < 40; n++){
    assert.ok(busyScale(n + 1) < busyScale(n), 'the penalty has to keep biting');
  }
  const calm = jam('hat', at16(1), { recent: 0 });
  const wild = jam('hat', at16(1), { recent: 30 });
  assert.ok(wild.points < calm.points / 4, 'thirty hits in a beat should barely pay');
  assert.ok(wild.points >= 0, 'but never go negative: the game is no-fail');
});

/* ---------------------------------------------------- the phrase, afterwards */

const H = (grid, idx, pad = 'kick') => ({
  grid, idx, pad,
  s16: grid === 's' ? idx : Math.round(idx * STEPS_PER_BEAT / TRIPLETS_PER_BEAT),
});

test('a push is an anticipation with the beat left empty', () => {
  const beat = 4;
  const d = beat * STEPS_PER_BEAT;
  assert.ok(pushedInto([H('s', d - 1)], beat), 'the "a" before the beat is a push');
  assert.ok(pushedInto([H('s', d - 2)], beat), 'so is the "and"');
  assert.ok(!pushedInto([H('s', d - 3)], beat), 'the "e" is too early to be pushing into it');
  assert.ok(!pushedInto([H('s', d - 1), H('s', d)], beat),
    'anticipating the beat and then also playing it is just playing it');
  assert.ok(!pushedInto([H('s', d)], beat));
  assert.ok(pushedInto([H('t', beat * TRIPLETS_PER_BEAT - 1)], beat), 'a swung push counts too');
  assert.ok(onBeat([H('t', beat * TRIPLETS_PER_BEAT)], beat), 'and a swung downbeat is on the beat');
});

test('a fill is the turn of a phrase, not the turn of a bar', () => {
  const busy = b => {
    const d = b * STEPS_PER_BEAT;
    const hits = [];
    for(let i = 0; i < FILL_SPOTS; i++) hits.push(H('s', d - 8 + i));
    hits.push(H('s', d));
    return hits;
  };
  assert.ok(filledInto(busy(PHRASE_BEATS), PHRASE_BEATS), 'four bars in, a fill');
  assert.ok(!filledInto(busy(4), 4), 'one bar in is the groove, not a fill');
  assert.ok(!filledInto(busy(PHRASE_BEATS).slice(0, FILL_SPOTS - 1).concat(H('s', PHRASE_BEATS * STEPS_PER_BEAT)), PHRASE_BEATS),
    'four positions is not busy enough to be a fill');

  const noLanding = busy(PHRASE_BEATS).filter(h => h.s16 !== PHRASE_BEATS * STEPS_PER_BEAT);
  assert.ok(!filledInto(noLanding, PHRASE_BEATS), 'a fill that does not land is falling over');
});

test('a bar is paid for changing and, less, for holding', () => {
  const bar = (n, steps, pad = 'kick') => steps.map(s => H('s', n * STEPS_PER_BAR + s, pad));

  const same = [...bar(0, [0, 4, 8, 12]), ...bar(1, [0, 4, 8, 12])];
  const held = barBonus(same, 1);
  assert.equal(held.kind, 'locked');
  assert.equal(held.points, LOCKED_POINTS);

  const changed = [...bar(0, [0, 4, 8, 12]), ...bar(1, [1, 3, 6, 11])];
  const fresh = barBonus(changed, 1);
  assert.equal(fresh.kind, 'fresh');
  assert.equal(fresh.points, FRESH_POINTS);
  assert.ok(FRESH_POINTS > LOCKED_POINTS, 'changing it is worth more than holding it');

  // The same shape on different drums is a change, because it sounds like one.
  const moved = [...bar(0, [0, 4, 8, 12], 'kick'), ...bar(1, [0, 4, 8, 12], 'tom')];
  assert.equal(barBonus(moved, 1).kind, 'fresh');

  /* Halfway between is neither. Jaccard, not a hit count: three of four kept
     is three shared out of five distinct, which is 0.6 — between the two
     bars and so worth nothing either way. */
  const half = [...bar(0, [0, 4, 8, 12]), ...bar(1, [0, 4, 8, 13])];
  assert.equal(likeness(barSignature(half, 1), barSignature(half, 0)), 0.6);
  assert.equal(barBonus(half, 1), null);

  // Two hits is not a pattern to have kept or broken.
  const thin = [...bar(0, [0, 8]), ...bar(1, [0, 8])];
  assert.equal(barBonus(thin, 1), null);
  assert.equal(barBonus([], 0), null, 'there is no bar before the first one');
});

test('likeness is a ratio, so a busy bar and a sparse one can be compared', () => {
  const s = (...xs) => new Set(xs);
  assert.equal(likeness(s('a', 'b'), s('a', 'b')), 1);
  assert.equal(likeness(s('a', 'b'), s('c', 'd')), 0);
  assert.equal(likeness(s('a', 'b'), s('a', 'c')), 1 / 3);
  assert.equal(likeness(s(), s()), 1, 'two empty bars are not a change');
  assert.ok(FRESH_UNDER < LOCKED_OVER);
  assert.ok(BAR_MIN_HITS >= 3);
});

/* ------------------------------------------------------------------ lessons */

test('every lesson is one bar of real positions on pads that exist', () => {
  assert.equal(new Set(LESSONS.map(l => l.id)).size, LESSONS.length, 'duplicate lesson id');
  for(const L of LESSONS){
    assert.match(L.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(L.name.length, `"${L.id}": needs a name`);
    assert.ok(L.bpm >= 60 && L.bpm <= 200, `"${L.id}": ${L.bpm} BPM is not a tempo anybody plays`);
    const notes = lessonNotes(L);
    assert.ok(notes.length >= 2, `"${L.id}": one note is not a groove`);
    for(const n of notes){
      assert.ok(PAD_BY_ID[n.pad], `"${L.id}": names a pad that does not exist: ${n.pad}`);
      assert.ok(!PAD_BY_ID[n.pad].unlock,
        `"${L.id}": uses ${n.pad}, which is locked — a lesson nobody can pass`);
      assert.ok(n.s >= 0 && n.s < STEPS_PER_BAR, `"${L.id}": step ${n.s} is outside the bar`);
      assert.ok(Number.isInteger(n.s));
    }
    // No two notes on the same pad at the same step: that is one note written twice.
    const seen = new Set(notes.map(n => `${n.pad}:${n.s}`));
    assert.equal(seen.size, notes.length, `"${L.id}": the same note twice`);
  }
  assert.ok(LESSONS.length >= 6, 'the ladder needs rungs');
});

test('the ladder gets harder: later lessons put more between the beats', () => {
  /* Not note count — "Eighth hats" is eight hats and easy. What climbs is how
     much of the bar is off the beat, which is what the game is about. */
  const offBeat = L => lessonNotes(L).filter(n => n.s % STEPS_PER_BEAT !== 0).length;
  const early = LESSONS.slice(0, 2).reduce((a, L) => a + offBeat(L), 0);
  const late = LESSONS.slice(-3).reduce((a, L) => a + offBeat(L), 0);
  assert.ok(late > early, 'the end of the ladder should be more syncopated than the start');
  assert.equal(offBeat(LESSONS[0]), 0, 'the first lesson is all downbeats, on purpose');
});

test('a bar copied exactly is three stars, and a bar ignored is none', () => {
  const L = LESSON_BY_ID.backbone;
  const want = lessonNotes(L);

  const perfect = want.map(n => ({ pad: n.pad, n: n.s, err: 0 }));
  const top = gradeLesson(want, perfect);
  assert.equal(top.matched, want.length);
  assert.equal(top.extras, 0);
  assert.equal(top.accuracy, 1);
  assert.equal(top.stars, 3);

  assert.deepEqual(gradeLesson(want, []), { matched: 0, extras: 0, accuracy: 0, stars: 0 });

  // Late past the window is not a hit, but it is still an extra.
  const late = want.map(n => ({ pad: n.pad, n: n.s, err: LESSON_MS / 1000 + 0.01 }));
  const missed = gradeLesson(want, late);
  assert.equal(missed.matched, 0);
  assert.equal(missed.extras, late.length);

  // The same note four times matches once and counts three extras.
  const spammed = [0, 0, 0, 0].map(() => ({ pad: want[0].pad, n: want[0].s, err: 0 }));
  const sp = gradeLesson(want, spammed);
  assert.equal(sp.matched, 1);
  assert.equal(sp.extras, 3);

  // Extras cost half a note each, not a whole one.
  const allPlusOne = gradeLesson(want, [...perfect, { pad: 'hat', n: 5, err: 0 }]);
  assert.equal(allPlusOne.matched, want.length);
  assert.equal(allPlusOne.extras, 1);
  assert.ok(allPlusOne.accuracy > 0.8 && allPlusOne.accuracy < 1);

  for(const bar of STAR_AT) assert.ok(bar > 0 && bar <= 1);
  assert.deepEqual(STAR_AT.slice().sort((a, b) => a - b), STAR_AT, 'the star bars must climb');
});

/* ----------------------------------------------------------------- the XP */

test('XP rewards getting better, and barely rewards repeating yourself', () => {
  assert.equal(learnXp(3, 0), 3 * XP_PER_NEW_STAR + 3 * XP_PER_STAR);
  assert.equal(learnXp(3, 3), 3 * XP_PER_STAR, 'replaying a cleared lesson pays the floor only');
  assert.equal(learnXp(0, 0), 0);
  assert.equal(learnXp(1, 3), XP_PER_STAR, 'a worse run never takes stars or XP away');
  assert.ok(learnXp(3, 0) > learnXp(3, 2), 'the first clear is worth the most');
  for(let s = 0; s <= 3; s++) for(let had = 0; had <= 3; had++) assert.ok(learnXp(s, had) >= 0);

  assert.equal(jamXp(0), 0);
  assert.equal(jamXp(5000), 100);
  assert.equal(jamXp(-500), 0, 'a broken score cannot pay');
  assert.ok(jamXp(10000) > jamXp(5000));
});

/* --------------------------------------------------------------- the worlds */

test('every world carries the header the clock needs', () => {
  assert.equal(new Set(TRACKS.map(t => t.id)).size, TRACKS.length, 'duplicate track id');
  for(const T of TRACKS){
    assert.ok(T.world.length && T.title.length, `"${T.id}": needs a world and a title`);
    assert.ok(T.bpm >= 60 && T.bpm <= 200, `"${T.id}": ${T.bpm} BPM`);
    assert.equal(T.beatsPerBar, BEATS_PER_BAR,
      `"${T.id}": the scorer counts four to the bar, so a world that does not must wait for it`);
    assert.ok(T.bars >= 8, `"${T.id}": a world shorter than eight bars is a loop, not a song`);
    assert.ok(['down', 'up', 'sync', 'fill'].includes(T.colour), `"${T.id}": unknown colour`);
    assert.equal(TRACK_BY_ID[T.id], T);

    // The synth stand-ins need the parts the backing is built from.
    if(T.kind === 'synth'){
      assert.ok(T.roots.length && T.chords.length, `"${T.id}": no chords to play`);
      assert.equal(T.roots.length, T.chords.length, `"${T.id}": a root without a chord under it`);
      assert.equal(typeof T.bass, 'function');
      for(const r of T.roots){
        for(const [s, m, d] of T.bass(r)){
          assert.ok(s >= 0 && s < STEPS_PER_BAR, `"${T.id}": a bass note outside the bar`);
          assert.ok(m > 0 && m < 128, `"${T.id}": ${m} is not a MIDI note`);
          assert.ok(d > 0);
        }
      }
    }
  }
  assert.ok(TRACKS.length >= 2, 'one world is not a choice');
});

test('a song is as long as its own header says', () => {
  const T = TRACK_BY_ID.funk;
  assert.ok(Math.abs(secondsPerBeat(T.bpm) - 60 / T.bpm) < 1e-12);
  assert.ok(Math.abs(trackSpan(T) - T.bars * T.beatsPerBar * 60 / T.bpm) < 1e-12);
  assert.ok(trackSpan(T) > 30, 'a world should be worth sitting down for');
});

/* ------------------------------------------------------------------ saving */

test('a save goes there and back, and a broken one loads as a fresh start', () => {
  const state = { xp: 1234, stars: { backbone: 3, clave: 1 }, offset: 0.042 };
  const back = fromSave(toSave(state));
  assert.deepEqual(back, state);
  assert.equal(toSave(state).version, SAVE_VERSION);

  const blank = { xp: 0, stars: {}, offset: null };
  for(const junk of [null, undefined, 'hello', 42, [], { xp: 'lots' }]){
    assert.deepEqual(fromSave(junk), blank, `${JSON.stringify(junk)} should load as a fresh start`);
  }

  // A lesson that has since been renamed drops out rather than taking the save with it.
  assert.deepEqual(fromSave({ xp: 10, stars: { 'no-such-lesson': 3 } }).stars, {});
  // Stars are clamped: a hand-edited save cannot hold eleven of three.
  assert.equal(fromSave({ stars: { backbone: 11 } }).stars.backbone, 3);
  assert.equal(fromSave({ stars: { backbone: -4 } }).stars.backbone, 0);
  assert.equal(fromSave({ xp: -99 }).xp, 0);

  // An offset outside the clamp is not a calibration, it is a stuck key.
  assert.equal(fromSave({ offset: 5 }).offset, null);
  assert.equal(fromSave({ offset: -5 }).offset, null);
  assert.equal(fromSave({ offset: OFFSET_MAX }).offset, OFFSET_MAX);
  assert.equal(fromSave({ offset: 'late' }).offset, null);
});

test('calibration is right at any latency, including the ones that broke it', () => {
  /* The bug this replaced: taps were matched to whichever click they were
   * NEAREST to, which folds over at half the click interval. At 120 BPM that
   * was 250 ms — squarely inside Bluetooth range — so a player 300 ms behind
   * had every tap attributed to the NEXT click, measured as minus fifty, and
   * the game then ADDED fifty milliseconds to every hit on top of the three
   * hundred they already had. It never returned null and it was wrong by up to
   * 450 ms. The clicks are a second apart now, so the fold sits past anything
   * real hardware does.
   */
  const clicks = [];
  for(let i = 0; i < CAL_CLICKS; i++) clicks.push(100 + i * CAL_INTERVAL);
  const perfect = ms => clicks.map(c => c + ms / 1000);

  for(const ms of [0, 10, 40, 80, 150, 200, 249, 251, 300, 400, 450]){
    const got = calibrationFrom(perfect(ms), clicks);
    assert.ok(got, `${ms} ms should be measurable`);
    assert.ok(Math.abs(got.offset * 1000 - ms) < 1,
      `${ms} ms measured as ${Math.round(got.offset * 1000)}`);
  }

  // The fold has to sit past any real device, or the bug is only moved.
  assert.ok(CAL_INTERVAL / 2 > 0.4,
    'half the click interval is the highest latency this can measure, and Bluetooth reaches 300 ms');
});

test('calibration survives a real person tapping', () => {
  const clicks = [];
  for(let i = 0; i < CAL_CLICKS; i++) clicks.push(50 + i * CAL_INTERVAL);
  const near = (got, ms, why) => {
    assert.ok(got, `${why}: should still have measured something`);
    assert.ok(Math.abs(got.offset * 1000 - ms) <= 30,
      `${why}: measured ${Math.round(got.offset * 1000)} when the truth was ${ms}`);
  };
  for(const ms of [40, 300]){
    const lat = ms / 1000;
    // Wobble, in both directions, without any two taps the same.
    const wobbly = clicks.map((c, i) => c + lat + ((i % 5) - 2) * 0.018);
    near(calibrationFrom(wobbly, clicks), ms, 'jitter');
    // Did not start tapping until the fourth click.
    near(calibrationFrom(clicks.slice(3).map(c => c + lat), clicks), ms, 'a late start');
    // Missed one in the middle — every tap after it would slip a whole beat
    // if they were paired in order, which is why they are not.
    near(calibrationFrom(clicks.filter((c, i) => i !== 7).map(c => c + lat), clicks), ms, 'a missed click');
    // A couple of wild ones.
    near(calibrationFrom(clicks.map((c, i) => c + lat + (i === 9 ? 0.45 : i === 5 ? -0.35 : 0)), clicks), ms, 'wild taps');
    // Double-tapped a few.
    near(calibrationFrom(clicks.concat(clicks.slice(0, 3)).map(c => c + lat), clicks), ms, 'double taps');
  }
});

test('calibration says it cannot tell rather than guessing', () => {
  const clicks = [];
  for(let i = 0; i < CAL_CLICKS; i++) clicks.push(i * CAL_INTERVAL);
  assert.equal(calibrationFrom([], clicks), null, 'no taps');
  assert.equal(calibrationFrom(null, clicks), null);
  assert.equal(calibrationFrom(clicks.map(c => c + 0.04), null), null);
  assert.equal(calibrationFrom(clicks.slice(0, CAL_MIN_TAPS - 1).map(c => c + 0.04), clicks), null,
    'too few taps is no answer, not a bad one');
  // Mashing: nothing near any click, consistently.
  const mash = Array.from({ length: 30 }, (_, i) => i * 0.137);
  const got = calibrationFrom(mash, clicks);
  if(got) assert.ok(false, `mashing was read as a ${Math.round(got.offset * 1000)} ms calibration`);

  assert.ok(CAL_WARMUP >= 1, 'the first taps are always ragged');
  assert.ok(CAL_WOBBLE > 0 && CAL_WOBBLE < CAL_INTERVAL / 2);
  assert.ok(LATENCY_HIGH < 0.25, 'past this the game tells you it is probably Bluetooth');
});

/* ----------------------------------------------------------- the whole thing */

test('a bar played the way the game asks pays more than the same bar played flat', () => {
  /* The one test that is about the design rather than a function. Two bars,
     same number of hits, same pads: one straight down the beats, one with the
     hats on the "and" and a kick pushed onto the "a". If the second does not
     win by a distance, the game is not the game it says it is. */
  const play = notes => {
    const taken = new Set();
    let total = 0;
    for(const [pad, step] of notes){
      const got = scoreHit(pad, at16(step), SPB, { span: 1000, recent: 0, taken });
      if(got.ok){ taken.add(got.key); total += got.points; }
    }
    return total;
  };
  const pads = ['kick', 'hat', 'snare', 'clap'];
  const flat = play(pads.map((pad, i) => [pad, i * STEPS_PER_BEAT]));        // all four on beats
  const sung = play([['kick', 0], ['hat', 3], ['snare', 6], ['clap', 11]]);  // the same four, moved
  assert.ok(sung > flat * 1.4,
    `the syncopated bar scored ${sung} against the flat bar's ${flat}; it should win by a lot`);
  /* And the flat bar is not punished for being flat — it still scores well.
     No-fail means the plain thing works, it just does not win. */
  assert.ok(flat > 0);
});
