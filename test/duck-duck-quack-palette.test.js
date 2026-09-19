/* Duck Duck Quack's scenery palette.
 *
 * The ramps in public/duck-duck-quack/palette.js are the one part of this
 * game's look that is not the shared sixteen, and every way they can go
 * wrong is silent. A ramp whose steps are out of order draws a bank of earth
 * that gets lighter as it goes down. A ramp that drifts off the shared
 * palette's grass or oak stops the game looking like the rest of the site. A
 * tone nobody paints with is a colour the next person has to guess the
 * purpose of. And a hex value written straight into art.js is a colour that
 * cannot be held against the one next to it, which is how eighteen of them
 * came to be scattered down that file in the first place.
 *
 * None of those throw, so they are checked here: the ramps against their own
 * rules, and then against a canvas that records what every level is actually
 * painted in.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RAMPS, GRASS, SOIL, SUBSOIL, STONE, SKY, HILLS, HILL_CROWN, WATER }
  from '../public/duck-duck-quack/palette.js';
import { hex } from '../public/good-vibes/pixel.js';
import { LEVELS } from '../public/duck-duck-quack/content.js';
import { newGame } from '../public/duck-duck-quack/sim.js';
import { paintScene } from '../public/duck-duck-quack/art.js';

const ART_SRC = fileURLToPath(new URL('../public/duck-duck-quack/art.js', import.meta.url));

/* The same weighting every display uses to decide which of two colours is
   the brighter one, so "lightest first" means what the eye means by it
   rather than whichever channel happens to be largest. */
const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const luma = c => { const [r, g, b] = rgb(c); return 0.299 * r + 0.587 * g + 0.114 * b; };

/* ------------------------------------------------------------ the ramps */

test('every ramp is a list of plain six-digit hex colours', () => {
  for(const [name, ramp] of Object.entries(RAMPS)){
    assert.ok(Array.isArray(ramp) && ramp.length >= 3, `${name} should be a ramp of at least three steps`);
    for(const c of ramp){
      assert.match(c, /^#[0-9a-f]{6}$/, `${name} has a colour that is not a lower-case six-digit hex: ${c}`);
    }
  }
});

test('every ramp runs lightest first, in strict steps', () => {
  for(const [name, ramp] of Object.entries(RAMPS)){
    for(let i = 1; i < ramp.length; i++){
      assert.ok(luma(ramp[i]) < luma(ramp[i - 1]),
        `${name}[${i}] (${ramp[i]}) is not darker than ${name}[${i - 1}] (${ramp[i - 1]}) — ` +
        'palette.js promises every ramp runs lightest to darkest');
    }
  }
});

test('no ramp carries the same colour twice', () => {
  for(const [name, ramp] of Object.entries(RAMPS)){
    assert.equal(new Set(ramp).size, ramp.length, `${name} repeats a colour`);
  }
});

test('no two steps of a ramp are so close together that the step is invisible', () => {
  for(const [name, ramp] of Object.entries(RAMPS)){
    for(let i = 1; i < ramp.length; i++){
      const [r0, g0, b0] = rgb(ramp[i - 1]), [r1, g1, b1] = rgb(ramp[i]);
      const apart = Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1);
      assert.ok(apart >= 12, `${name}[${i}] is only ${apart} apart from the step above it — ` +
        'a step nobody can see is a colour that is not earning its place');
    }
  }
});

/* The ramps are meant to fill in the gaps between the shared sixteen, not to
   strike out on their own — that is what keeps this game looking like the
   rest of the site while still having a hillside with light on it. Each one
   below is anchored where the sixteen have an answer. */
test('each ramp is anchored to the shared palette where that palette has an answer', () => {
  assert.ok(GRASS.includes(hex('g')), 'the turf should still be built around the shared grass');
  assert.equal(GRASS.at(-1), hex('G'), 'the turf should go into shadow at the shared pine');
  assert.ok(SOIL.includes(hex('N')), 'the earth should still be built around the shared oak');
  assert.ok(SUBSOIL.includes(hex('v')), 'the subsoil should still pass through the shared violet');
  assert.equal(SUBSOIL.at(-1), hex('d'), 'the subsoil should bottom out at the shared deep violet');
  assert.equal(SKY.at(-1), hex('b'), 'the sky overhead should be the shared blue');
  assert.equal(SKY[0], hex('c'), 'the sky at the horizon should be the shared cyan');
  assert.equal(WATER[0], hex('t'), 'the glint on the water should be the shared mint');
  assert.ok(WATER.includes(hex('c')) && WATER.includes(hex('b')),
    'the pond should still pass through the shared cyan and blue');
});

/* Rock is the deliberate exception, and it is worth pinning down: the shared
   palette has no grey at all, every dark in it is a purple, and rock drawn in
   one of those purples read as "more dirt, but darker" — which is most of how
   a Digger came to look like it was tunnelling through rock it had always
   refused to touch. */
test('rock is grey, which is the one thing the shared palette cannot be', () => {
  for(const c of STONE){
    const [r, g, b] = rgb(c);
    assert.ok(b > r, `${c} should be cool, not warm`);
    assert.ok(b - r < 40, `${c} is a blue, not a grey — rock has to read apart from the sky and the pond`);
    assert.ok(Math.abs(g - (r + b) / 2) < 12, `${c} has a hue in it — rock should be neutral`);
  }
});

/* Each ridge gets its own highlight rather than all three sharing one. A
   single mint pixel on a far hill and a near one flattens exactly what the
   haze in HILLS is there to separate. */
test('every hill has a crown lighter than its own body', () => {
  assert.equal(HILL_CROWN.length, HILLS.length, 'one crown tone per ridge');
  for(let i = 0; i < HILLS.length; i++){
    assert.ok(luma(HILL_CROWN[i]) > luma(HILLS[i]),
      `hill ${i}'s crown (${HILL_CROWN[i]}) is not lighter than the hill itself (${HILLS[i]})`);
  }
});

/* ------------------------------------------------------------- and art.js */

test('art.js writes down no colours of its own', () => {
  const src = readFileSync(ART_SRC, 'utf8');
  const loose = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(loose, [],
    'art.js has grown its own hex values again — they belong in palette.js, ' +
    'where the colour beside them can be seen');
});

/* A canvas that remembers every fill instead of painting it — the same trick
   Sunward's art tests use. Here all it is asked for is which colours came up. */
class Recorder {
  constructor(){ this.used = new Set(); this.fillStyle = '#000'; this.imageSmoothingEnabled = false; }
  fillRect(x, y, w, h){ if(w > 0 && h > 0) this.used.add(this.fillStyle); }
  clearRect(){}
  drawImage(){}
}

/* Painted across every level and a few moments of each, because some of these
   tones only turn up on particular ground: the stone greys want a level with
   rock in it, the deepest subsoil wants a column deep enough to have some, and
   the clouds and ripples only reach parts of the scene once the clock has
   moved them there. */
const painted = () => {
  const ctx = new Recorder();
  for(const level of LEVELS){
    const state = newGame(level);
    for(const ticks of [0, 37, 91, 140]){
      state.ticks = ticks;
      paintScene(ctx, state);
    }
  }
  return ctx.used;
};

test('every tone in every ramp is actually painted somewhere in the game', () => {
  const used = painted();
  const idle = [];
  for(const [name, ramp] of Object.entries(RAMPS)){
    ramp.forEach((c, i) => { if(!used.has(c)) idle.push(`${name}[${i}] ${c}`); });
  }
  assert.deepEqual(idle, [],
    'these tones are in the palette but nothing paints with them — a colour ' +
    'whose purpose has to be guessed at is worse than no colour at all');
});

test('the scenery is painted out of the ramps and the shared sixteen, and nothing else', () => {
  const known = new Set([...Object.values(RAMPS).flat(), ...'kdvsbctgGyorpnNw'.split('').map(hex)]);
  for(const c of painted()){
    assert.ok(known.has(c), `something painted ${c}, which is in neither palette`);
  }
});
