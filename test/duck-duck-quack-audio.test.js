/* Duck Duck Quack — the music, checked as data.
 *
 * None of this needs a speaker, and that is the point: the bug these are
 * here for was not a bad sound, it was five levels with no entry in the
 * lookup table at all. `play()` looks a level's id up in SONGS and quietly
 * sets `song = null` on a miss, so The Hedgerow, The Overlook, The Stepping
 * Stones, The Belfry and The Errand all ran in silence underneath a Music
 * button that said it was on. A table indexed by level id has to add up to
 * the list of levels, and nothing was making it.
 *
 * So: every level has a song, and every song is the shape the sequencer
 * reads. The second half matters as much as the first — a song present but
 * malformed is silence with extra steps, and the sequencer (scheduleStep)
 * would throw or emit nothing rather than say so.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';

import { LEVELS } from '../public/duck-duck-quack/content.js';
import { SONGS, ROOMS, SFX_NAMES, createAudio } from '../public/duck-duck-quack/audio.js';

/* The chord shapes the sequencer knows how to voice. Named here rather than
   imported because QUALITIES is private to the module — if one is ever
   added, this is a line to change and a test that says so. */
const QUALITIES = ['maj', 'min7', 'dom7'];

const STEPS_PER_BAR = 16;
const inBar = at => Number.isInteger(at) && at >= 0 && at < STEPS_PER_BAR;

/* Where a note can sit: [step, semitones from the bar's root, length]. */
function checkNotes(notes, what){
  assert.ok(Array.isArray(notes) && notes.length, `${what} should have notes`);
  for(const note of notes){
    assert.ok(Array.isArray(note) && note.length === 3, `${what}: ${JSON.stringify(note)} is not [at, semis, len]`);
    const [at, semis, len] = note;
    assert.ok(inBar(at), `${what}: step ${at} is outside the bar`);
    assert.ok(Number.isInteger(semis) && Math.abs(semis) <= 48, `${what}: ${semis} semitones is off the keyboard`);
    assert.ok(Number.isInteger(len) && len > 0 && len <= STEPS_PER_BAR, `${what}: length ${len}`);
  }
}

const checkSteps = (steps, what) => {
  assert.ok(Array.isArray(steps), `${what} should be a list of steps`);
  for(const at of steps) assert.ok(inBar(at), `${what}: step ${at} is outside the bar`);
};

test('every level has a song — the table adds up to the list it is indexed by', () => {
  for(const level of LEVELS){
    assert.ok(SONGS[level.id], `${level.id} ("${level.name}") has no music`);
  }
});

test('no song is left over from a level that no longer exists', () => {
  const ids = new Set(LEVELS.map(l => l.id));
  for(const name of Object.keys(SONGS)){
    assert.ok(ids.has(name), `SONGS has "${name}", which is not a level`);
  }
});

test('every song is the shape the sequencer reads', () => {
  for(const [name, song] of Object.entries(SONGS)){
    assert.ok(song.bpm > 40 && song.bpm < 240, `${name}: bpm ${song.bpm}`);
    assert.ok(song.swing >= 0 && song.swing < 0.5, `${name}: swing ${song.swing}`);

    assert.ok(Array.isArray(song.bars) && song.bars.length, `${name}: no bars`);
    for(const [i, bar] of song.bars.entries()){
      assert.ok(Array.isArray(bar.chord) && bar.chord.length === 2, `${name} bar ${i}: no chord`);
      const [root, quality] = bar.chord;
      assert.ok(Number.isInteger(root) && root > 20 && root < 100, `${name} bar ${i}: root ${root}`);
      assert.ok(QUALITIES.includes(quality), `${name} bar ${i}: "${quality}" is not a chord the sequencer voices`);
    }

    checkNotes(song.bass, `${name} bass`);
    checkNotes(song.lead, `${name} lead`);
    checkNotes(song.leadResponse, `${name} leadResponse`);

    for(const key of ['kickAt', 'snareAt', 'hatAt', 'openHatAt', 'stabAt']){
      checkSteps(song[key], `${name} ${key}`);
    }
    for(const key of ['bassLevel', 'leadLevel', 'stabLevel']){
      assert.ok(song[key] > 0 && song[key] <= 0.5, `${name} ${key}: ${song[key]}`);
    }
    for(const key of ['bassType', 'leadType', 'stabType']){
      assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(song[key]),
        `${name} ${key}: "${song[key]}" is not an oscillator type`);
    }
    /* The low-pass cutoffs are genuinely optional — `voice` only builds a
       filter when one is given, and The Aerie deliberately has none. Checked
       when present, not required. */
    for(const key of ['bassCut', 'leadCut', 'stabCut']){
      if(song[key] === undefined) continue;
      assert.ok(song[key] > 100 && song[key] < 20000, `${name} ${key}: ${song[key]}`);
    }
  }
});

test('every song answers itself rather than looping a bar note for note', () => {
  // The whole reason leadResponse exists — see the note over PARK_SONG.
  for(const [name, song] of Object.entries(SONGS)){
    assert.ok(song.bars.some(b => b.lead === 'response'),
      `${name} never plays its response phrase`);
    assert.notDeepEqual(song.lead, song.leadResponse,
      `${name}'s response is the same phrase as its call`);
  }
});

test('every song plays itself out and then turns around', () => {
  for(const [name, song] of Object.entries(SONGS)){
    const fills = song.bars.filter(b => b.fill).length;
    assert.equal(fills, 1, `${name} should have exactly one turnaround bar, has ${fills}`);
    assert.ok(song.bars[song.bars.length - 1].fill, `${name}'s turnaround should be its last bar`);
  }
});


/* -------------------------------------------------------------- the rooms */

/* ROOMS is indexed by level id exactly as SONGS is, and it can go wrong in
 * exactly the same silent way: a level missing from it falls back to the
 * park's room and plays a tunnel as if it were a lawn, with nothing to say
 * so. Same two-way check, then the numbers, because an impulse response is
 * generated from them at runtime — a negative length or a decay of zero is a
 * buffer full of NaN and a level that plays silence.
 */

test('every level has a room, and no room is left over', () => {
  for(const level of LEVELS){
    assert.ok(ROOMS[level.id], `${level.id} ("${level.name}") has no room`);
  }
  const ids = new Set(LEVELS.map(l => l.id));
  for(const name of Object.keys(ROOMS)){
    assert.ok(ids.has(name), `ROOMS has "${name}", which is not a level`);
  }
});

test('every room is a space a reverb can actually be built from', () => {
  for(const [name, r] of Object.entries(ROOMS)){
    // Long enough to be a tail, short enough that the buffer stays sane: at
    // 48kHz stereo, six seconds is already half a megabyte of float.
    assert.ok(r.seconds > 0.2 && r.seconds <= 6, `${name}: ${r.seconds}s is not a room`);
    assert.ok(r.decay > 0.5 && r.decay <= 8, `${name}: decay ${r.decay}`);
    assert.ok(r.tone > 500 && r.tone < 20000, `${name}: tone ${r.tone}Hz`);
    assert.ok(r.mix > 0 && r.mix <= 1.2, `${name}: mix ${r.mix}`);
    assert.ok(r.echo >= 0 && r.echo <= 1, `${name}: echo ${r.echo}`);
  }
});

/* The one thing a table of twelve hand-tuned rooms is really for. If every
   level ends up in the same space, the table is doing nothing that a single
   constant would not do, and the levels stop sounding like different places
   — which is the whole reason it exists. */
test('the levels are not all in the same room', () => {
  for(const field of ['seconds', 'decay', 'tone', 'mix', 'echo']){
    const values = new Set(Object.values(ROOMS).map(r => r[field]));
    assert.ok(values.size >= 4,
      `every level has nearly the same ${field} (${values.size} distinct) — ` +
      'the rooms are not telling the places apart');
  }
});

/* The two the rest are judged against: a tunnel is the closest, darkest
   space in the game and a bell tower the largest, and if those two ever stop
   being at opposite ends of the table something has drifted. */
test('the tunnel sounds enclosed and the tower sounds enormous', () => {
  assert.ok(ROOMS.warren.tone < ROOMS.park.tone, 'a tunnel should be darker than a lawn');
  assert.ok(ROOMS.belfry.seconds > ROOMS.warren.seconds, 'a bell tower should ring longer than a burrow');
  assert.equal(ROOMS.belfry.seconds, Math.max(...Object.values(ROOMS).map(r => r.seconds)),
    'the bell tower should be the largest space in the game');
  assert.equal(ROOMS.hedgerow.seconds, Math.min(...Object.values(ROOMS).map(r => r.seconds)),
    'a hedgerow should be the closest space in the game');
});

/* ------------------------------------------------------------ the effects */

/* `sfx()` does nothing at all for a name it does not know — the same silent
 * miss that left five levels without music. A renamed effect would take its
 * call sites down with it just as quietly, and renaming one is exactly what
 * happened when the teleporter's buzz became a zing.
 */

test('the declared roster of effects is the one the engine actually has', () => {
  // createAudio touches no audio API until something asks it to make a
  // sound, so the keys can be read in Node.
  assert.deepEqual(createAudio().names(), SFX_NAMES);
});

test('every effect the game asks for by name exists', () => {
  const page = readFileSync(new URL('../public/duck-duck-quack/play.html', import.meta.url), 'utf8');
  /* Every quoted name on a line that calls sfx() — which catches the
     literal calls and the one that picks between two by a duckling's cause
     of death, without this test needing to know which is which. */
  const asked = page.split('\n')
    .filter(line => line.includes('.sfx('))
    .flatMap(line => [...line.matchAll(/'([a-z]+)'/g)].map(m => m[1]));
  assert.ok(asked.length >= 5, `only found ${asked.length} sfx names — has the call shape changed?`);
  for(const name of asked){
    assert.ok(SFX_NAMES.includes(name), `play.html asks for "${name}", which is not an effect`);
  }
});

test('the teleporter has a sound, and it is the zing', () => {
  assert.ok(SFX_NAMES.includes('zing'));
  const page = readFileSync(new URL('../public/duck-duck-quack/play.html', import.meta.url), 'utf8');
  assert.match(page, /sfx\('zing'\)/, 'a duckling going through a pad should make it');
});
