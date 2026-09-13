/* Sunward's tree, as it ages.
 *
 * The tree is client-only and cannot break the site, but it is the thing the
 * whole game is about tapping, and the ways it can go wrong are all silent: a
 * stage that draws the same picture as the one before it, a canopy that walks
 * off the side of the frame, a tap target that no longer covers the crown, or
 * a first-year tree that is no longer the first-year tree the shelf card and
 * the title screen were built around. None of those throw. They are checked
 * here against a canvas that records what it is asked to paint.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TREE_STAGES, stageFor, agedScale, AGED_STEP, AGED_CAP,
  drawTree, treeBounds, paintLot, createLot,
  SCENE_W, SCENE_H, TREE_X, TREE_Y, hex,
} from '../public/sunward/art.js';

/* A canvas context that remembers every fill instead of painting it. The
   fill's colour is recorded with it, so two call lists are the same picture
   only if every rectangle is the same colour in the same place. */
class Recorder {
  constructor(){ this.calls = []; this.fillStyle = '#000'; this.imageSmoothingEnabled = false; }
  fillRect(x, y, w, h){ this.calls.push([this.fillStyle, x, y, w, h]); }
  clearRect(x, y, w, h){ this.calls.push(['clear', x, y, w, h]); }
  drawImage(){ this.calls.push(['image']); }
}

const draw = (growth, opts) => {
  const ctx = new Recorder();
  drawTree(ctx, growth, opts);
  return ctx.calls;
};

/* The bounding box of a call list, and how many pixels it paints. */
const extents = calls => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pixels = 0;
  for(const [, x, y, w, h] of calls){
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    pixels += w * h;
  }
  return { x0, y0, x1, y1, pixels };
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------- the stages */

test('there is a stage for each of the first eight winters, in order', () => {
  assert.ok(TREE_STAGES.length >= 8, 'eight winters at least');
  const ids = new Set();
  for(let i = 0; i < TREE_STAGES.length; i++){
    const s = TREE_STAGES[i];
    assert.equal(s.winters, i, `stage ${i} says it is winter ${s.winters}`);
    assert.match(s.id, /^[a-z][a-z0-9-]*$/, `stage ${i} id "${s.id}" is not kebab-case`);
    assert.ok(!ids.has(s.id), `stage id "${s.id}" is used twice`);
    ids.add(s.id);
    for(const field of ['trunk', 'leaf', 'spread', 'reach']){
      assert.ok(Number.isFinite(s[field]) && s[field] > 0, `stage ${i} ${field} must be a positive number`);
    }
    assert.ok(s.depthBonus === 0 || s.depthBonus === 1, `stage ${i} depthBonus must be 0 or 1`);
    assert.ok(Array.isArray(s.features), `stage ${i} needs a features list`);
  }
});

test('an older tree is never thinner or barer than a younger one', () => {
  for(let i = 1; i < TREE_STAGES.length; i++){
    const was = TREE_STAGES[i - 1], now = TREE_STAGES[i];
    assert.ok(now.trunk >= was.trunk, `"${now.id}" has a thinner trunk than "${was.id}"`);
    assert.ok(now.leaf >= was.leaf, `"${now.id}" has smaller leaves than "${was.id}"`);
    assert.ok(now.spread >= was.spread, `"${now.id}" is narrower than "${was.id}"`);
    assert.ok(now.depthBonus >= was.depthBonus, `"${now.id}" is sparser than "${was.id}"`);
    // Features accumulate: everything the last winter added is still there.
    for(const f of was.features) assert.ok(now.features.includes(f), `"${now.id}" lost "${f}"`);
    assert.ok(now.features.length > was.features.length, `"${now.id}" adds nothing to "${was.id}"`);
    for(const f of now.features) assert.ok(now.has[f], `"${now.id}" lists "${f}" but has.${f} is not set`);
  }
  assert.deepEqual(TREE_STAGES[0].features, [], 'the first-year tree has nothing added to it');
  assert.equal(TREE_STAGES[0].trunk, 1);
  assert.equal(TREE_STAGES[0].leaf, 1);
  assert.equal(TREE_STAGES[0].spread, 1);
  assert.equal(TREE_STAGES[0].reach, 1);
});

test('stageFor clamps, floors, and survives a save that reads as nothing', () => {
  const last = TREE_STAGES[TREE_STAGES.length - 1];
  assert.equal(stageFor(0), TREE_STAGES[0]);
  assert.equal(stageFor(-1), TREE_STAGES[0]);
  assert.equal(stageFor(-0.5), TREE_STAGES[0]);
  assert.equal(stageFor(2.7), TREE_STAGES[2], 'a fraction of a winter is not a winter');
  assert.equal(stageFor(TREE_STAGES.length - 1), last);
  assert.equal(stageFor(1e9), last);
  assert.equal(stageFor(Infinity), last);
  assert.equal(stageFor(NaN), TREE_STAGES[0]);
  assert.equal(stageFor(undefined), TREE_STAGES[0]);
  assert.equal(stageFor('3'), TREE_STAGES[3], 'a save that stored a string still counts');
});

test('past the last stage the tree thickens a little a winter and then stops', () => {
  const last = TREE_STAGES.length - 1;
  assert.equal(agedScale(0), 1);
  assert.equal(agedScale(last), 1);
  assert.ok(Math.abs(agedScale(last + 1) - (1 + AGED_STEP)) < 1e-9);
  assert.equal(agedScale(1000), AGED_CAP);
  assert.equal(agedScale(NaN), 1);
  for(let age = 0; age < 60; age++){
    assert.ok(agedScale(age + 1) >= agedScale(age), `agedScale shrinks between ${age} and ${age + 1}`);
  }
});

/* --------------------------------------------------- the first-year tree */

/* Measured off the renderer before the stages went in. If these move, the
   shelf card and the title screen have changed for everybody, and the diff
   that moved them should say why. */
const FIRST_YEAR = {
  0:   { count: 579,  x0: 129, y0: 111, x1: 187, y1: 193 },
  0.5: { count: 3141, x0: 90,  y0: 59,  x1: 218, y1: 193 },
  1:   { count: 7422, x0: 60,  y0: 14,  x1: 245, y1: 193 },
};

test('age 0 draws exactly the tree it drew before there were ages', () => {
  for(const [growth, want] of Object.entries(FIRST_YEAR)){
    const g = Number(growth);
    const calls = draw(g, {});
    assert.equal(calls.length, want.count, `growth ${g}: ${calls.length} fills, expected ${want.count}`);
    const box = extents(calls);
    assert.deepEqual({ x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
      { x0: want.x0, y0: want.y0, x1: want.x1, y1: want.y1 }, `growth ${g}: the tree's extents moved`);
    assert.ok(same(calls, draw(g, { age: 0 })), `growth ${g}: age 0 differs from age omitted`);
    assert.ok(same(calls, draw(g)), `growth ${g}: no options differs from age omitted`);
  }
  // And with every other option in play, so the age plumbing touches nothing
  // when there is no age to speak of.
  const opts = { sway: 0.04, light: -0.6, sunSide: 1, shake: 2, pulse: 0.7 };
  assert.ok(same(draw(0.7, opts), draw(0.7, { ...opts, age: 0 })));
});

test('the same tree draws the same on every frame', () => {
  for(const age of [0, 3, 7, 12]){
    const opts = { sway: 0.03, light: 0.4, age };
    assert.ok(same(draw(0.8, opts), draw(0.8, opts)), `age ${age} is not deterministic`);
  }
});

/* --------------------------------------------------------- the winters */

test('every winter draws a different tree, and more of it', () => {
  for(const g of [0, 0.3, 1]){
    let last = null;
    for(let age = 0; age < TREE_STAGES.length; age++){
      const calls = draw(g, { age });
      if(last){
        assert.ok(!same(calls, last.calls), `growth ${g}: winters ${age - 1} and ${age} draw the same picture`);
        if(g === 1){
          const now = extents(calls).pixels, was = extents(last.calls).pixels;
          assert.ok(now > was, `growth 1: winter ${age} paints ${now} pixels, winter ${age - 1} painted ${was}`);
        }
      }
      last = { calls };
    }
  }
});

test('beyond the last stage the tree keeps growing, and then holds', () => {
  const last = TREE_STAGES.length - 1;
  const atLast = extents(draw(1, { age: last })).pixels;
  const after = extents(draw(1, { age: last + 1 })).pixels;
  assert.ok(after > atLast, 'one winter past the last stage should draw more tree');
  // The cap: past it, every winter is the same tree.
  const capped = last + Math.ceil((AGED_CAP - 1) / AGED_STEP);
  assert.ok(same(draw(1, { age: capped }), draw(1, { age: capped + 20 })), 'the cap does not hold');
  assert.deepEqual(treeBounds(1, capped), treeBounds(1, capped + 20));
});

test('what the fifth winter adds glows at night, and nothing before it does', () => {
  /* At light -0.7 every gold in the palette has been shaded to ember or rose,
     so a fill that is still gold is a light source drawn unshaded on purpose:
     the knot hole from the fifth winter, the lanterns from the sixth. */
  const gold = hex('y');
  const golds = (age, light) => draw(1, { age, light }).filter(c => c[0] === gold).length;
  for(let age = 0; age < 5; age++) assert.equal(golds(age, -0.7), 0, `winter ${age} has a light on at night`);
  assert.ok(golds(5, -0.7) > 0, 'the knot hole should glow from the fifth winter');
  assert.ok(golds(6, -0.7) > golds(5, -0.7), 'the lanterns should add to it from the sixth');
  // And by day the knot hole is a hole: the fifth winter paints no more gold
  // than the fourth did (what gold there is by day is fallen leaves).
  assert.equal(golds(5, 1), golds(4, 1));
});

/* ----------------------------------------------------------- the frame */

test('nothing is drawn under the ground or off the sides, at any age', () => {
  /* The top is allowed to clip — an ancient tree too big for its picture is
     the point — and the bottom is the foot of the tree plus what stands
     there: a bench's legs, a ring of mushrooms. Eight pixels of that. */
  const floor = TREE_Y + 8;
  for(let age = 0; age <= 12; age++){
    for(const g of [0, 0.3, 0.7, 1]){
      for(const sway of [-0.05, 0, 0.05]){
        for(const shake of [-2, 2]){
          const calls = draw(g, { age, sway, shake, pulse: sway === 0 ? 1 : 0 });
          for(const [key, x, y, w, h] of calls){
            assert.ok(x >= 0 && x + w <= SCENE_W, `winter ${age} growth ${g}: a fill at x ${x} w ${w} leaves the frame`);
            assert.ok(y + h <= floor, `winter ${age} growth ${g}: a ${key} fill at y ${y} h ${h} is under the ground`);
            assert.ok(w >= 1 && h >= 1, `winter ${age}: an empty fill`);
          }
          assert.ok(extents(calls).y1 <= SCENE_H);
        }
      }
    }
  }
});

test('the tap target stays in the frame, only ever grows, and covers the crown', () => {
  for(let i = 0; i <= 20; i++){
    const g = i / 20;
    let was = null;
    for(let age = 0; age <= 30; age++){
      const box = treeBounds(g, age);
      assert.ok(box.x >= 0 && box.x + box.w <= SCENE_W, `growth ${g} winter ${age}: box leaves the frame sideways`);
      assert.ok(box.y >= 0 && box.y + box.h <= SCENE_H, `growth ${g} winter ${age}: box leaves the frame vertically`);
      assert.ok(box.x < TREE_X && box.x + box.w > TREE_X, 'the trunk must be inside its own hit box');
      assert.ok(box.y < TREE_Y && box.y + box.h > TREE_Y, 'and the box must straddle the ground line');
      if(was){
        assert.ok(box.x <= was.x && box.y <= was.y, `growth ${g}: the box shrinks between winters ${age - 1} and ${age}`);
        assert.ok(box.x + box.w >= was.x + was.w && box.y + box.h >= was.y + was.h,
          `growth ${g}: the box shrinks between winters ${age - 1} and ${age}`);
      }
      was = box;
    }
  }

  // From the first winter on, the box covers everything the tree draws — what
  // the frame shows of it. The first-year box is left exactly as it was.
  for(let age = 1; age <= 10; age++){
    for(const g of [0, 0.2, 0.5, 0.8, 1]){
      const box = treeBounds(g, age);
      const e = extents(draw(g, { age }));
      assert.ok(box.x <= e.x0 && box.x + box.w >= e.x1,
        `winter ${age} growth ${g}: the crown spans ${e.x0}..${e.x1} and the box ${box.x}..${box.x + box.w}`);
      assert.ok(box.y <= Math.max(0, e.y0), `winter ${age} growth ${g}: the crown reaches y ${e.y0}, the box ${box.y}`);
    }
  }
  assert.deepEqual(treeBounds(1), treeBounds(1, 0));
  assert.deepEqual(treeBounds(0.5, 0), { x: TREE_X - 55, y: TREE_Y - 111, w: 110, h: 117 });
});

/* --------------------------------------------------------- the painters */

test('both lot painters take an age and hand it to the tree', () => {
  const a = new Recorder(), b = new Recorder();
  paintLot(a, { growth: 1, age: 0 });
  paintLot(b, { growth: 1, age: 5 });
  assert.ok(!same(a.calls, b.calls), 'paintLot ignores age');
  const c = new Recorder();
  paintLot(c, { growth: 1 });
  assert.ok(same(a.calls, c.calls), 'paintLot without an age is not a first-year lot');

  // createLot needs a document to make its offscreen buffers from.
  const before = globalThis.document;
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => new Recorder() }),
  };
  try {
    const paint = createLot();
    const d = new Recorder(), e = new Recorder(), f = new Recorder();
    paint(d, { growth: 1, age: 0 });
    paint(e, { growth: 1, age: 5 });
    paint(f, { growth: 1 });
    assert.ok(d.calls.some(c => c[0] === 'image'), 'the cached painter should stamp its buffers');
    assert.ok(!same(d.calls, e.calls), 'createLot ignores age');
    assert.ok(same(d.calls, f.calls), 'createLot without an age is not a first-year lot');
  } finally {
    globalThis.document = before;
  }
});
