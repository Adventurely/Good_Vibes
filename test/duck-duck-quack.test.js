/* Duck Duck Quack — the rules, and whether the one level here can be won.
 *
 * Each mechanic gets its own tiny level rather than sharing LEVEL_PARK, so a
 * test failure points at the one rule that broke instead of at "something in
 * the park". The last test plays a whole run of LEVEL_PARK with a simple bot and
 * checks it actually clears the win quota — the same reason Sunward keeps a
 * balance harness: a level's failure mode is not a crash, it is a shape
 * nobody can actually win, and that does not show up until somebody tries.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import {
  SCENE_W, SCENE_H, WALK_STEP, FALL_SAFE, FALL_SPEED, FLY_SPEED, TICK_RATE, BUILD_SECONDS,
  BUILD_MAX_STEPS, BUILD_RISE_HEIGHT, DIG_SECONDS, DIG_MAX_STEPS, JUMP_SPAN, JUMP_RISE, PIT_Y,
  FLY_DRIFT, SKILLS, SKILL_INFO,
  LEVEL_PARK, LEVEL_WARREN, LEVEL_ORCHARD, LEVEL_GROVE, LEVEL_AERIE, LEVEL_SPIRE, LEVEL_FALLS, LEVEL_HEDGEROW, LEVEL_OVERLOOK, LEVEL_STONES,
  LEVEL_BELFRY, LEVEL_ERRAND, LEVELS,
  buildTerrain, buildLayer, stairs, winCount, goalHeading, hatchHeading, formatTime,
} from '../public/duck-duck-quack/content.js';

import {
  newGame, tick, assignSkill, assignRefusal, releaseBlocker, duckNear, hasTrait, endRun,
} from '../public/duck-duck-quack/sim.js';

/* A minimal level for a test that only cares about one mechanic. Every field
   the game reads has a harmless default, so a test only has to say what makes
   it different from flat, empty ground. */
function miniLevel(overrides = {}){
  return {
    id: 'mini', name: 'Mini', width: SCENE_W, height: SCENE_H,
    segments: [{ from: 0, to: SCENE_W, y: 50 }],
    nestX: 2, goalX: SCENE_W - 1,
    duckCount: 1, spawnInterval: 0, timeLimit: 400, winRatio: 1,
    supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 0 },
    goose: { x0: SCENE_W, x1: SCENE_W, y: 50, speed: 0, catchRadius: 0 },
    ...overrides,
  };
}

function run(state, ticks){
  for(let i = 0; i < ticks; i++) tick(state);
  return state;
}

/* Advance until a duckling is exactly at column `x` and still walking (open
   to a new skill), or give up after `limit` ticks. Waiting for the position
   rather than counting ticks by hand keeps a test honest about where the
   hatch tick lands a duckling, instead of guessing an offset. */
function tickUntilAt(state, duck, x, limit = 400){
  for(let i = 0; i < limit && !(duck.state === 'walking' && duck.x === x); i++) tick(state);
  return state;
}

/* --------------------------------------------------------------- the table */

test('every skill has a table entry and a name', () => {
  for(const skill of SKILLS){
    const info = SKILL_INFO[skill];
    assert.ok(info, `no SKILL_INFO for "${skill}"`);
    assert.ok(info.name && info.verb && info.blurb, `"${skill}" is missing a field`);
  }
});

test('LEVEL_PARK carries a supply for every skill and is registered', () => {
  for(const skill of SKILLS) assert.ok(LEVEL_PARK.supply[skill] >= 0, `no supply for "${skill}"`);
  assert.ok(LEVELS.includes(LEVEL_PARK));
  assert.ok(LEVEL_PARK.nestX >= 0 && LEVEL_PARK.nestX < LEVEL_PARK.goalX);
  assert.ok(LEVEL_PARK.goalX < LEVEL_PARK.width);
});

test('every registered level carries a supply for every skill, a sane nest and goal, and a unique id', () => {
  const ids = new Set();
  for(const level of LEVELS){
    for(const skill of SKILLS) assert.ok(level.supply[skill] >= 0, `${level.id}: no supply for "${skill}"`);
    // Most levels walk left to right (nest before goal); The Orchard walks
    // the other way (see content.js's goalHeading) — either is "sane" as
    // long as the two are not the same column and both sit on the scene.
    assert.ok(level.nestX >= 0 && level.nestX < level.width, `${level.id}: nest is off the scene`);
    assert.ok(level.goalX >= 0 && level.goalX < level.width, `${level.id}: goal is past the edge of the scene`);
    assert.notEqual(level.nestX, level.goalX, `${level.id}: nest and goal are the same column`);
    assert.ok(!ids.has(level.id), `duplicate level id "${level.id}"`);
    ids.add(level.id);
    // The picker (index.html) and the play screen's header both label a
    // level by its name and its place in this array, so a level with no
    // name, or two with the same one, would show up there as two cards a
    // player cannot tell apart.
    assert.ok(level.name, `${level.id}: no name to show in the level picker`);
    assert.equal(LEVELS.filter(l => l.name === level.name).length, 1,
      `two levels both named "${level.name}"`);
  }
});

test('winCount rounds up, not down', () => {
  assert.equal(winCount({ duckCount: 10, winRatio: 0.8 }), 8);
  assert.equal(winCount({ duckCount: 9, winRatio: 0.8 }), 8);
});

test('buildTerrain fills only the columns a segment claims', () => {
  const row = buildTerrain([{ from: 2, to: 5, y: 9 }], 6);
  assert.equal(row.length, 6);
  assert.deepEqual([...row].map(v => v ?? null), [null, null, 9, 9, 9, null]);
});

test('buildLayer expands a segment\'s own field and leaves the fallback everywhere else', () => {
  const segments = [{ from: 0, to: 6, y: 50 }, { from: 2, to: 4, y: 50, hard: true }];
  const row = buildLayer(segments, 'hard', false, 6);
  assert.deepEqual(row, [false, false, true, true, false, false]);
});

/* -------------------------------------------------------------- walking */

test('a duckling with no climber turns back from a wall and does not climb it', () => {
  const level = miniLevel({ segments: [
    { from: 0, to: 10, y: 50 },
    { from: 10, to: SCENE_W, y: 10 },
  ] });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 20);
  assert.notEqual(duck.state, 'climbing');
  // Turned around rather than stepping onto the wall's column.
  assert.ok(duck.x < 10);
});

test('a climber given the skill in time clears the same wall and is saved', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 10 }],
    goalX: 15, supply: { digger: 0, builder: 0, blocker: 0, climber: 1 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'climber'), duck);
  run(state, 120);
  assert.equal(duck.state, 'saved');
  assert.equal(state.ended, 'won');
});

test('a drop within FALL_SAFE is just a step down, not a fall', () => {
  const level = miniLevel({ segments: [
    { from: 0, to: 10, y: 50 },
    { from: 10, to: SCENE_W, y: 50 + FALL_SAFE - 2 },
  ] });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 15);
  assert.notEqual(duck.state, 'lost');
});

test('a drop past FALL_SAFE is lethal', () => {
  const level = miniLevel({ segments: [
    { from: 0, to: 10, y: 50 },
    { from: 10, to: SCENE_W, y: 50 + FALL_SAFE + 20 },
  ] });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 60);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
});

test('the edge of the world turns a duckling round rather than swallowing it', () => {
  /* It used to be a loss, and that was the absence of a hazard rather than
     one: every level built since The Spire walls its own ends with rock for
     exactly this, and the older seven never got the band. One Blocker on
     those levels sent everything behind it walking out the back — 23 of The
     Orchard's 25, measured — with nothing on screen to say so. */
  const level = miniLevel({ nestX: 1, timeLimit: 4000 });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  duck.dir = -1; // send it toward the near edge instead of the goal
  run(state, 10);
  assert.equal(duck.state, 'walking', 'still going');
  assert.equal(duck.dir, 1, 'turned back towards the level');
  assert.ok(duck.x >= 0 && duck.x < level.width, 'and still on it');

  run(state, 4000);
  assert.equal(duck.state, 'saved', 'and it gets where it was going');
});

test('one Blocker no longer costs a level the flock behind it', () => {
  // The measured version of the bug above, on the level it was worst on.
  const state = newGame(LEVEL_ORCHARD);
  let planted = false;
  for(let i = 0; i < LEVEL_ORCHARD.timeLimit && !state.ended; i++){
    if(!planted){
      const at = LEVEL_ORCHARD.nestX + goalHeading(LEVEL_ORCHARD) * 20;
      const d = state.ducks.find(k => k.state === 'walking' && Math.round(k.x) === at);
      if(d && assignSkill(state, d.id, 'blocker')) planted = true;
    }
    tick(state);
  }
  assert.ok(planted, 'the blocker should have gone in');
  assert.equal(state.ducks.filter(d => d.cause === 'edge').length, 0,
    'nothing should be lost off the end of the level');
});

/* --------------------------------------------------------------- digging */

test('a digger tunnels straight through a wall at its own height, permanently', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 0 }],
    goalX: 40, supply: { digger: 1, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 9);
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  // Digging is deferred, not instant: the duckling is still just walking
  // until the very next step is the one that would otherwise turn it back.
  assert.equal(duck.state, 'walking');
  tick(state);
  assert.equal(duck.state, 'digging');
  run(state, 65);
  assert.equal(duck.state, 'saved');

  // A tunnel through, not a ramp down: every column it cut sits at exactly
  // the height the duckling was already walking at, not stepped down toward
  // the natural floor the way a builder's bridge or an old-style ramp would.
  // `terrain` itself is untouched throughout — the wall still stands, see
  // content.js's header note — it is `tunnelY` that carries the cut.
  assert.equal(state.terrain[9], 50, 'the column dug from is untouched');
  assert.equal(state.tunnelY[9], null, 'no tunnel starts before the wall');
  for(let x = 10; x < 40; x++){
    assert.equal(state.terrain[x], 0, `column ${x}'s terrain should be untouched, wall and all`);
    assert.equal(state.tunnelY[x], 50, `column ${x} should be cut to walking height, not left at 0`);
  }
});

test('a digger given the skill right at the nest still tunnels the wall three obstacles later', () => {
  // The actual bug this is guarding against: a skill that only worked when
  // clicked on the exact column a hazard started on was, in practice,
  // unusable — nobody can land a tap on one specific column of a moving
  // duckling. Handed out the moment it hatches, long before it can see the
  // wall coming, it still has to work.
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 0 }],
    goalX: 40, supply: { digger: 1, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.ok(duck.x < 9, 'the duckling should still be well short of the wall');
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  run(state, 80);
  assert.equal(duck.state, 'saved');
});

test('a digger only answers a wall — facing a gap instead, it still just falls', () => {
  // Digging only ever triggers on the same branch a climb does: ground
  // rising ahead of a walking duckling (see stepWalking). A gap is ground
  // falling away, a completely different branch, so a digger sitting on a
  // duckling that meets one does nothing at all — it falls exactly as an
  // unskilled duckling would.
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: 500 },  // a gap, not a wall
      { from: 20, to: SCENE_W, y: 50 },
    ],
    goalX: 25, supply: { digger: 1, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  run(state, 60);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
  // And it dug nothing — a digger that never triggered has nothing to
  // have dug.
  for(let x = 10; x < 20; x++) assert.equal(state.tunnelY[x], null);
});

test('a tunnel stops after DIG_MAX_STEPS columns and the trait goes with it', () => {
  // A wall far thicker than one tunnel: the duckling cuts its three seconds'
  // worth (see content.js's DIG_SECONDS), stops inside the hill, and is a
  // plain duckling again — walking back out of its own hole rather than
  // carrying on through.
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 0 }],
    goalX: SCENE_W - 1, supply: { digger: 1, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  run(state, 20 + DIG_MAX_STEPS);
  assert.equal(duck.state, 'walking', 'the dig should be over');
  assert.equal(hasTrait(duck, 'digger'), false, 'and the trait spent with it');

  const cut = state.tunnelY.filter(v => v != null).length;
  assert.equal(cut, DIG_MAX_STEPS, `a tunnel is ${DIG_MAX_STEPS} columns, got ${cut}`);
  assert.equal(state.tunnelY[10 + DIG_MAX_STEPS], null, 'and not one column further');

  // Left where it is, it never starts again, however long it walks.
  run(state, 200);
  assert.equal(state.tunnelY.filter(v => v != null).length, DIG_MAX_STEPS,
    'a spent digger does not pick the tunnel back up');
  assert.notEqual(duck.state, 'saved');
});

test('a second digger carries on from where the first one stopped', () => {
  // The relay. Nothing special is coded for it — the dead end left by the
  // first tunnel is an ordinary wall, met by an ordinary duckling, which is
  // the whole point.
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 0 }],
    duckCount: 2, spawnInterval: 4, timeLimit: 600, goalX: SCENE_W - 1,
    supply: { digger: 2, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  for(const d of state.ducks) assignSkill(state, d.id, 'digger');
  run(state, 20);
  for(const d of state.ducks) if(d.state === 'walking') assignSkill(state, d.id, 'digger');
  run(state, 400);
  const cut = state.tunnelY.filter(v => v != null).length;
  assert.ok(cut > DIG_MAX_STEPS, `two diggers should reach past one tunnel, got ${cut}`);
  assert.ok(cut <= 2 * DIG_MAX_STEPS, `and no further than two, got ${cut}`);
});

test('a digger that breaks through early is spent all the same', () => {
  // The wall is two columns thick, so the tunnel is over long before the
  // clock is. The trait still goes: one Digger, one wall.
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 12, y: 0 },
      { from: 12, to: 30, y: 50 },
      { from: 30, to: SCENE_W, y: 0 },
    ],
    goalX: SCENE_W - 1, supply: { digger: 1, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  run(state, 30);
  assert.equal(state.tunnelY[10], 50, 'the first wall should be tunnelled');
  assert.equal(hasTrait(duck, 'digger'), false, 'and the trait spent on it');
  run(state, 100);
  assert.equal(state.tunnelY[30], null, 'the second wall turns the same duckling back');
});

/* ----------------------------------------------------------------- rock */

test('a digger cannot start a tunnel into rock — it just turns back, over and over', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 0, hard: true }],
    goalX: 40, supply: { digger: 5, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = newGame(level);
  for(let i = 0; i < 200 && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state === 'walking' && !hasTrait(d, 'digger')) assignSkill(state, d.id, 'digger');
    }
    tick(state);
  }
  assert.notEqual(state.ducks[0].state, 'saved');
  assert.equal(state.tunnelY[10], null, 'rock is never cut, however many diggers are handed out');
});

test('a climber scales rock exactly the way it scales an ordinary wall', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 0, hard: true }],
    goalX: 40, supply: { digger: 0, builder: 0, blocker: 0, climber: 1, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'climber'), duck);
  run(state, 120);
  assert.equal(duck.state, 'saved');
});

test('a tunnel already under way stops cold at rock, rather than cutting through it', () => {
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: 0 },          // ordinary wall — a dig can start here
      { from: 20, to: SCENE_W, y: 0, hard: true }, // rock right behind it
    ],
    goalX: 40, supply: { digger: 1, builder: 0, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  run(state, 30);
  assert.notEqual(duck.state, 'saved');
  assert.equal(state.tunnelY[19], 50, 'the ordinary wall in front of the rock was cut');
  assert.equal(state.tunnelY[20], null, 'the rock behind it was not');
});

/* --------------------------------------------------------------- flying */

test('a flyer descends FLY_SPEED a tick and survives a drop that would otherwise be lethal', () => {
  const drop = 50 + FALL_SAFE + 20;
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: drop }],
    goalX: 40, supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 1 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 9);
  assert.equal(assignSkill(state, duck.id, 'flyer'), duck);
  tick(state);
  assert.equal(duck.state, 'falling', 'it still falls — a flyer survives the drop, it does not skip it');
  const yBefore = duck.y;
  tick(state);
  assert.equal(duck.y, yBefore + FLY_SPEED, 'a flying duckling descends at FLY_SPEED, not FALL_SPEED');
  run(state, 200);
  assert.equal(duck.state, 'saved');
});

test('a flyer given the skill right at the nest still survives the drop two obstacles later', () => {
  const drop = 50 + FALL_SAFE + 20;
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: drop }],
    goalX: 40, supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 1 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.ok(duck.x < 9, 'the duckling should still be well short of the drop');
  assert.equal(assignSkill(state, duck.id, 'flyer'), duck);
  run(state, 200);
  assert.equal(duck.state, 'saved');
});

test('a flyer over a gap still drifts past the bottom of the world — there is nothing to land on', () => {
  // The line between "survives the drop" and "crosses the gap": a flyer
  // does not avoid falling, it only avoids the FALL_SAFE check once it
  // lands. Over a real gap (content.js's PIT_Y) there is no floor within
  // the visible scene at all, so it clears SCENE_H and is lost anyway —
  // gently, but lost.
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: 500 },  // a gap, not a drop
      { from: 20, to: SCENE_W, y: 50 },
    ],
    goalX: 25, supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 1 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'flyer'), duck);
  run(state, 400);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
});

/* -------------------------------------------------------------- building */

/* How many columns carry a deck, and how many decks are standing in all —
   the two are the same number until ramps start crossing each other, which
   is the whole point of the pair. See sim.js's `decks`. */
const deckColumns = state => state.decks.filter(at => at.length > 0).length;
const deckCount = state => state.decks.reduce((n, at) => n + at.length, 0);

test('a builder starts on the click and builds the whole BUILD_SECONDS on flat ground, with nothing there to answer', () => {
  // The heart of it: no gap, no wall, nothing — and it still builds. The
  // click is never the thing that has to be aimed, and a duckling given one
  // always, visibly, starts climbing on the very next tick.
  const level = miniLevel({ supply: { digger: 0, builder: 1, blocker: 0, climber: 0 } });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'builder'), duck);
  assert.equal(duck.state, 'building', 'instant — see assignSkill');

  run(state, BUILD_MAX_STEPS);
  assert.equal(duck.buildStep, BUILD_MAX_STEPS, 'the whole clock, none of it skipped');
  assert.equal(duck.y, 50 - BUILD_RISE_HEIGHT, 'and the full climb with it');
  assert.equal(duck.state, 'walking', 'then it stops and walks on');
  assert.equal(deckCount(state), BUILD_MAX_STEPS, 'a column of ramp laid every tick of it');

  // Stepping off the far end of a ramp laid over level ground is exactly
  // FALL_SAFE, never more — see content.js's BUILD_RISE_HEIGHT.
  run(state, 4);
  assert.equal(duck.state, 'walking');
  assert.equal(duck.y, 50, 'back down on the ground, unhurt');
});

test('a builder crosses a gap it happens to be aimed over, without ever being told the gap is there', () => {
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: 500 },  // a pit no fall survives
      { from: 20, to: SCENE_W, y: 50 },
    ],
    goalX: 200, supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  // Given at the nest, seven columns short of the pit — no aiming at all.
  assignSkill(state, duck.id, 'builder');
  run(state, BUILD_MAX_STEPS);
  // The pit itself is untouched — see content.js's header note — the deck is
  // its own thing standing over the column, so the gap is still open below.
  for(let x = 10; x < 20; x++){
    assert.equal(state.terrain[x], 500, `column ${x}'s terrain should still be open pit`);
    assert.equal(state.decks[x].length, 1, `column ${x} should be carrying ramp`);
  }
  run(state, 200);
  assert.equal(duck.state, 'saved', 'it walked over its own ramp and on to the pond');
});

test('a builder stops dead at a wall rather than climbing it, and turns back like anything else would', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 30, y: 50 }, { from: 30, to: SCENE_W, y: 10 }],  // a 40px wall
    supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'builder');
  let ticks = 0;
  while(duck.state === 'building' && ticks < 300){ tick(state); ticks++; }
  assert.ok(ticks < BUILD_MAX_STEPS, 'the wall ended it short of the clock');
  assert.equal(duck.x, 29, 'left standing on the last column of its own ramp');
  for(let x = 30; x < 35; x++) assert.equal(state.decks[x].length, 0, 'and nothing laid into the wall itself');
  // Getting up a wall is a Climber's job and a Digger's. A Builder holding
  // neither turns back from one exactly as it would without the ramp.
  run(state, 3);
  assert.equal(duck.dir, -1);
});

test('a builder\'s ramp joins a staircase rather than cutting across it, so the flock behind can still walk up', () => {
  /* The Spire in miniature — treads that climb faster than the ramp does.
   * Because the ramp stops where the ground catches up to it, the two meet
   * within a step of each other, and a deck being shared ground (see
   * sim.js's surfacesAt) the rest of the flock walks the ramp up onto the
   * stairs and carries on. A ramp that ran on at its own angle instead
   * would leave every duckling behind it stranded.
   */
  const segments = [{ from: 0, to: 30, y: 50 }];
  for(let i = 0; i < 30; i++) segments.push({ from: 30 + i * 2, to: 32 + i * 2, y: 50 - 4 * (i + 1) });
  segments.push({ from: 90, to: SCENE_W, y: -70 });
  const level = miniLevel({
    segments, duckCount: 2, spawnInterval: 1,
    supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 2);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'builder');
  while(duck.state === 'building') tick(state);

  /* The ramp has to hand over to the stairs without leaving a ledge the
     flock cannot get past. A tread is four pixels, so the two meet within a
     tread or so either way; what matters is that it is a step a duckling
     takes rather than a wall it turns back from or a fall it dies on. Walk
     one up and see, which is the property rather than the pixel count. */
  const last = state.decks.findLastIndex(at => at.length > 0);
  assert.ok(last > 0, 'a ramp should have been laid at all');
  const [, follower] = state.ducks;
  follower.x = last; follower.y = state.decks[last][0]; follower.dir = 1; follower.state = 'walking';
  const startedAt = follower.y;
  run(state, 20);
  assert.notEqual(follower.state, 'lost', 'it should not die stepping off the ramp onto the stairs');
  assert.ok(follower.x > last, 'it should get past the end of the ramp');
  assert.ok(follower.y < startedAt, 'and be climbing the stairs beyond it');
});

test('a ramp laid across one already standing leaves both — neither clears the other away', () => {
  // The two are their own decks at every column they share, and a duckling
  // walks whichever one it is actually on; see sim.js's addDeckAt and
  // stepTargetAt.
  const level = miniLevel({
    duckCount: 2, spawnInterval: 1,
    supply: { digger: 0, builder: 2, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 2);
  const [first, second] = state.ducks;

  assignSkill(state, first.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);
  const before = state.decks.map(at => [...at]);
  assert.equal(deckCount(state), BUILD_MAX_STEPS);

  // The second one, turned around, builds back across the first.
  second.x = 32; second.y = 50; second.dir = -1;
  assignSkill(state, second.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);

  for(let x = 0; x < SCENE_W; x++){
    for(const y of before[x]){
      assert.ok(state.decks[x].includes(y), `the first ramp's deck at ${x} should still be standing`);
    }
  }
  assert.ok(deckCount(state) > deckColumns(state), 'and some columns should be carrying both');
});

test('a second builder given out on a ramp extends it, carrying on level rather than climbing again', () => {
  /* What gets a flock over a gap wider than one ramp reaches — The Park's,
   * see LEVEL_PARK. The first Builder decides how high the ramp goes; every one
   * after it decides how far. If an extension climbed another
   * BUILD_RISE_HEIGHT of its own, the far end would be twice FALL_SAFE above
   * the ground, and the ledge at the end of a ramp is one every duckling
   * behind has to step off.
   */
  const level = miniLevel({
    duckCount: 2, spawnInterval: 1,
    supply: { digger: 0, builder: 2, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 2);
  const [first, second] = state.ducks;

  assignSkill(state, first.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);
  const end = state.decks.findLastIndex(at => at.length > 0);
  const top = state.decks[end][0];
  assert.equal(top, 50 - BUILD_RISE_HEIGHT, 'the first ramp climbs its full rise');

  // Stand the second one on the end of that ramp and give it a Builder.
  second.x = end; second.y = top; second.dir = 1; second.state = 'walking';
  assignSkill(state, second.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);

  const newEnd = state.decks.findLastIndex(at => at.length > 0);
  assert.ok(newEnd > end, 'the ramp should now reach further');
  for(let x = end + 1; x <= newEnd; x++){
    assert.ok(state.decks[x].includes(top), `column ${x} should carry the ramp on at its own height`);
  }
  // Which keeps the one thing that makes a ramp's far end safe true.
  assert.equal(50 - top, FALL_SAFE, 'and the whole ramp is still only one climb above the ground');
});

test('a duckling walks under a ramp overhead rather than being lifted onto it', () => {
  const level = miniLevel({
    duckCount: 2, spawnInterval: 1,
    supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 2);
  const [builder, walker] = state.ducks;
  assignSkill(state, builder.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);

  // Stand the other one on the ground under the high end of that ramp.
  const under = state.decks.findLastIndex(at => at.length > 0) - 1;
  assert.ok(state.decks[under][0] < 50 - WALK_STEP, 'the deck there should be well overhead');
  walker.x = under - 1; walker.y = 50; walker.dir = 1; walker.state = 'walking';
  tick(state);
  assert.equal(walker.x, under, 'it kept walking');
  assert.equal(walker.y, 50, 'along the ground, under the ramp, not up onto it');
});

test('a duckling on a ramp follows it whichever way it is walking — up one way, down the other', () => {
  const level = miniLevel({
    duckCount: 2, spawnInterval: 1,
    supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 2);
  const [builder, walker] = state.ducks;
  assignSkill(state, builder.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);

  // Put the other one up on the high end of the ramp, facing back down it.
  const top = state.decks.findLastIndex(at => at.length > 0);
  walker.x = top; walker.y = state.decks[top][0]; walker.dir = -1; walker.state = 'walking';
  const startY = walker.y;
  run(state, 8);
  assert.ok(walker.y > startY, 'walking back the way the ramp came should take it down the ramp');
  assert.ok(walker.y < 50, 'and it should still be on the ramp, not dropped off it');
  // Turn it round and it climbs the same ramp again.
  walker.dir = 1;
  const turnedAt = walker.y;
  run(state, 8);
  assert.ok(walker.y < turnedAt, 'and turning round takes it back up');
});

test('a duckling coming down one ramp changes onto another crossing it the other way, and goes up', () => {
  /* Two ramps meeting head on. Walking into the crossing the duckling is
   * descending the one it is on and the other one climbs the way it is
   * going; both decks are a step away, so which it takes is decided by
   * stepTargetAt preferring the higher — up over down. */
  const level = miniLevel({
    duckCount: 3, spawnInterval: 1,
    supply: { digger: 0, builder: 2, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 3);
  const [up, down, walker] = state.ducks;

  up.x = 20; up.y = 50; up.dir = 1; up.state = 'walking';       // climbs rightward
  assignSkill(state, up.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);
  let top = { x: -1, y: Infinity };
  state.decks.forEach((at, x) => at.forEach(y => { if(y < top.y) top = { x, y }; }));

  down.x = 75; down.y = 50; down.dir = -1; down.state = 'walking';   // climbs leftward
  assignSkill(state, down.id, 'builder');
  run(state, BUILD_MAX_STEPS + 2);
  assert.ok(state.decks.some(at => at.length > 1), 'the two should be crossing somewhere');

  // Off the first ramp's high end, heading back down it — into the crossing.
  walker.x = top.x; walker.y = top.y; walker.dir = -1; walker.state = 'walking';
  const ys = [walker.y];
  for(let i = 0; i < 12; i++){ tick(state); ys.push(walker.y); }

  // Bigger y is further down. It should drop away from where it started,
  // then climb back to at least that height again on the other ramp.
  const wentDown = ys.findIndex(y => y > ys[0] + 1);
  assert.ok(wentDown > 0, `it should walk down the first ramp first, got ${ys}`);
  const cameBackUp = ys.findIndex((y, i) => i > wentDown && y <= ys[0]);
  assert.ok(cameBackUp > wentDown,
    `and then climb the ramp going the other way back up, got ${ys}`);
});

test('a builder is never held, so a duckling that has finished one ramp can be given another', () => {
  const level = miniLevel({ supply: { digger: 0, builder: 2, blocker: 0, climber: 0 } });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'builder');
  assert.match(assignRefusal(state, duck.id, 'builder'), /busy/i, 'not while the first ramp is still going up');
  run(state, BUILD_MAX_STEPS + 2);
  assert.equal(assignRefusal(state, duck.id, 'builder'), null, 'but once that one is done, yes');
});

test('a builder given right at a gap with no far bank at all stops once its own clock runs out', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: 500 }],  // never resolves
    supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 9);
  assignSkill(state, duck.id, 'builder');
  // Exactly BUILD_SECONDS worth of ticks: one column laid a tick, so this
  // lands right on the moment the clock runs out and not a tick later.
  run(state, BUILD_SECONDS * TICK_RATE);
  assert.equal(duck.state, 'walking', 'it stops on its own rather than building forever');
  assert.equal(duck.y, 50 - BUILD_RISE_HEIGHT);
  // Ten seconds of ramp over a gap that never ends leaves it out over open
  // air. BUILD_RISE_HEIGHT being FALL_SAFE means the climb alone is never
  // what kills it — the gap it is still standing over is.
  run(state, 60);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
});

test('a builder ramps over an ordinary lethal drop the same as over a bottomless pit', () => {
  // The same shape as the gap test, except the low stretch between the two
  // banks has a real floor — well short of PIT_Y — rather than being open
  // air no fall survives. Nothing in stepBuilding cares which it is: the
  // ramp is above both.
  const drop = 50 + FALL_SAFE + 20;
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: drop },
      { from: 20, to: SCENE_W, y: 50 },
    ],
    goalX: 25, supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 9);
  assignSkill(state, duck.id, 'builder');
  for(let x = 10; x < 20; x++) assert.equal(state.terrain[x], drop, `column ${x} should be the low stretch`);
  // The ramp runs its full ten seconds either way — crossing the drop is
  // something it does in passing, not something that ends it — so it is
  // still building long after the far bank is behind it.
  run(state, BUILD_MAX_STEPS + 4);
  assert.equal(duck.state, 'saved');
  for(let x = 10; x < 20; x++) assert.equal(state.decks[x].length, 1, `column ${x} should be carrying ramp`);
});

test('BUILD_RISE_HEIGHT never climbs a duckling higher than FALL_SAFE lets it fall back from', () => {
  // The invariant the whole "given nowhere useful, it still only ever costs
  // the click" promise rests on — see content.js's own note on
  // BUILD_RISE_HEIGHT and FALL_SAFE. If a Builder is ever spent running the
  // full clock out over ground it never needed to climb at all, stepping
  // back down from wherever that leaves it must still never be what kills
  // the duckling by itself.
  assert.equal(BUILD_RISE_HEIGHT, FALL_SAFE);
});

/* --------------------------------------------------- the builder staircase */

/* Flat ground and nothing else, so a chain of Builders can be read off
   plainly: what each one does depends only on what the duckling handing it
   over is standing on. */
function stairLevel(builders){
  return miniLevel({
    goalX: SCENE_W - 1, timeLimit: 2000,
    supply: { digger: 0, builder: builders, blocker: 0, climber: 0, flyer: 0 },
  });
}

test('builders alternate: ground climbs, a climbing ramp runs level, a level one climbs again', () => {
  const state = run(newGame(stairLevel(6)), 1);
  const duck = state.ducks[0];
  const kinds = [];
  const heights = [];
  for(let i = 0; i < 400 && kinds.length < 6; i++){
    if(duck.state === 'walking'){
      heights.push(duck.y);
      assignSkill(state, duck.id, 'builder');
      kinds.push(duck.buildLevel ? 'level' : 'climb');
    }
    tick(state);
  }
  assert.deepEqual(kinds, ['climb', 'level', 'climb', 'level', 'climb', 'level']);
  // And the climbs actually gain height, a ramp's worth at a time.
  assert.deepEqual(heights, [50, 50 - BUILD_RISE_HEIGHT, 50 - BUILD_RISE_HEIGHT,
    50 - 2 * BUILD_RISE_HEIGHT, 50 - 2 * BUILD_RISE_HEIGHT, 50 - 3 * BUILD_RISE_HEIGHT]);
});

test('a ramp off an island climbs — an island is ground, not somebody else\'s staircase', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: SCENE_W, y: 150 }],
    islands: [{ from: 20, to: 120, y: 100, floor: 110 }],
    teleports: [{ ax: 10, ay: 150, bx: 25, by: 100 }],
    goalX: SCENE_W - 1, timeLimit: 600,
    supply: { digger: 0, builder: 1, blocker: 0, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 20);
  assert.equal(duck.y, 100, 'up on the island');
  assignSkill(state, duck.id, 'builder');
  assert.equal(duck.buildLevel, false, 'so its ramp climbs');
  run(state, BUILD_MAX_STEPS);
  const top = Math.min(...state.decks.flat());
  assert.equal(top, 100 - BUILD_RISE_HEIGHT, 'a full ramp\'s climb above the island');
});

test('a blocker only stops what is standing at its own height', () => {
  // A blocker down on the grass, and an island ninety pixels over its head:
  // the one has nothing to do with the other.
  const level = miniLevel({
    segments: [{ from: 0, to: SCENE_W, y: 150 }],
    islands: [{ from: 20, to: 200, y: 60, floor: 70 }],
    duckCount: 2, spawnInterval: 2, timeLimit: 600, goalX: SCENE_W - 1,
    supply: { digger: 0, builder: 0, blocker: 1, climber: 0, flyer: 0 },
  });
  const state = run(newGame(level), 1);
  const planted = state.ducks[0];
  run(state, 40);
  assignSkill(state, planted.id, 'blocker');
  const at = Math.round(planted.x);

  const high = state.ducks[1];
  high.y = 60;                 // as a ramp up onto the island would have left it
  high.x = at - 10;
  high.dir = 1;
  run(state, 30);
  assert.ok(high.x > at + 5, `the one up on the island should be well past ${at}, got ${high.x}`);
  assert.equal(high.y, 60, 'and still on it');

  // While anything on the grass still turns back at it.
  const low = state.ducks.find(d => d.state === 'walking' && d.y === 150 && d.id !== planted.id);
  if(low){ assert.ok(low.x <= at, 'the grass is still blocked'); }
});

/* --------------------------------------------------------------- blocking */

test('a blocker plants itself for good and turns other ducklings back', () => {
  const level = miniLevel({
    duckCount: 2, spawnInterval: 5, timeLimit: 300,
    supply: { digger: 0, builder: 0, blocker: 1, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const first = state.ducks[0];
  run(state, 4); // give it a few steps before it plants
  assert.equal(assignSkill(state, first.id, 'blocker'), first);
  const plantedAt = first.x;
  run(state, 20); // second duckling has hatched and should have reached it by now
  assert.equal(first.state, 'blocking');
  assert.equal(first.x, plantedAt, 'a blocker must not move once planted');
  const second = state.ducks[1];
  assert.ok(second, 'the second duckling should have hatched');
  assert.ok(second.x <= plantedAt, 'the second duckling should never pass the blocker');
});

test('a blocker stood down walks off back the way it came', () => {
  /* Not onward the way it was facing, which is what it used to do. A Blocker
     is planted facing the thing it was put there to stand in front of — the
     ledge, the chasm, the goose — so sending it onward sent it into exactly
     that. Back the way it came is the one direction that was ever safe. */
  const level = miniLevel({
    duckCount: 1, timeLimit: 400,
    supply: { digger: 0, builder: 0, blocker: 1, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 4);
  assignSkill(state, duck.id, 'blocker');
  const plantedAt = duck.x, facing = duck.dir;
  run(state, 20);
  assert.equal(duck.x, plantedAt, 'still planted');

  assert.equal(releaseBlocker(state, duck.id), duck);
  assert.equal(duck.state, 'walking');
  assert.equal(duck.dir, -facing, 'it turns round');
  run(state, 10);
  assert.ok(duck.x < plantedAt, 'and walks back the way it came');
});

test('a blocker stood down still reaches the pond — it is not a duckling written off', () => {
  // It sets off away from the water, meets the wall at the far end and comes
  // back, which costs it the walk but not the level.
  const level = miniLevel({
    duckCount: 1, timeLimit: 4000,
    supply: { digger: 0, builder: 0, blocker: 1, climber: 0 },
  });
  const state = run(newGame(level), 5);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'blocker');
  run(state, 20);
  releaseBlocker(state, duck.id);
  run(state, 4000);
  assert.equal(duck.state, 'saved');
});

test('standing a blocker down refunds nothing — the blocker is still spent', () => {
  const level = miniLevel({ supply: { digger: 0, builder: 0, blocker: 1, climber: 0 } });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'blocker');
  assert.equal(state.supply.blocker, 0);
  releaseBlocker(state, duck.id);
  assert.equal(state.supply.blocker, 0, 'the supply does not come back');
  assert.equal(assignRefusal(state, duck.id, 'blocker'), 'Out of blockers.');
});

test('standing down anything that is not a planted blocker does nothing', () => {
  const level = miniLevel({ supply: { digger: 0, builder: 0, blocker: 1, climber: 0 } });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(releaseBlocker(state, duck.id), null, 'a walking duckling is not blocking');
  assert.equal(duck.state, 'walking');
  assert.equal(releaseBlocker(state, 'no-such-duckling'), null);
  assignSkill(state, duck.id, 'blocker');
  state.ended = 'lost';
  assert.equal(releaseBlocker(state, duck.id), null, 'not once the level is over');
  assert.equal(duck.state, 'blocking');
});

test('a duckling held up by a blocker walks on once it is stood down', () => {
  /* With a wall behind the flock, so the one that gets turned back turns
     around again and comes at the blocker a second time. Standing a Blocker
     down does not call anybody back — a duckling already walking away keeps
     walking away — it just stops being a wall, which is the whole of it. */
  const level = miniLevel({
    segments: [{ from: 0, to: 5, y: 0 }, { from: 5, to: SCENE_W, y: 50 }],
    nestX: 8, duckCount: 2, spawnInterval: 5, timeLimit: 600, goalX: SCENE_W - 1,
    supply: { digger: 0, builder: 0, blocker: 1, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const first = state.ducks[0];
  // Well clear of the nest, so the one it turns back has room to walk away
  // and come back.
  run(state, 40);
  assignSkill(state, first.id, 'blocker');
  run(state, 10);
  const second = state.ducks[1];
  assert.ok(second.x <= first.x, 'the second one is still being turned back');
  assert.equal(second.dir, -1, 'and has been sent back the way it came');
  releaseBlocker(state, first.id);
  run(state, 400);
  assert.equal(first.state, 'saved');
  assert.equal(second.state, 'saved', 'and the one it was holding gets through too');
});

/* ------------------------------------------------------------------ goose */

test('the goose catches a duckling that walks right into it', () => {
  const level = miniLevel({
    nestX: 5, goose: { x0: 5, x1: 5, y: 50, speed: 0, catchRadius: 2 },
  });
  const state = run(newGame(level), 1);
  assert.equal(state.ducks[0].state, 'lost');
  assert.equal(state.ducks[0].cause, 'goosed');
});

test('the goose only ever catches its first duckling', () => {
  const level = miniLevel({
    duckCount: 4, spawnInterval: 3, goalX: 20, timeLimit: 200,
    goose: { x0: 5, x1: 5, y: 50, speed: 0, catchRadius: 3 },
  });
  const state = run(newGame(level), 200);
  const goosed = state.ducks.filter(d => d.cause === 'goosed');
  assert.equal(goosed.length, 1, 'every duckling in range should not be goosed, only the first');
  const others = state.ducks.filter(d => d !== goosed[0]);
  assert.ok(others.every(d => d.state === 'saved'), 'the rest should get through once the goose is fed');
});

test('the goose leaves a duckling alone once it is out of reach', () => {
  const level = miniLevel({
    nestX: 1, goalX: 20, goose: { x0: 100, x1: 100, y: 50, speed: 0, catchRadius: 1 },
  });
  const state = run(newGame(level), 40);
  assert.equal(state.ducks[0].state, 'saved');
});

test('a blocker in the goose\'s path turns it back and calls the hunt off', () => {
  // A duckling planted right where the goose is patrolling stands in for a
  // wall it cannot climb — see sim.js's stepGoose. Planted partway through
  // the beat (not at its own edge, which the goose already never crosses on
  // its own) so the block is the thing actually turning it around.
  const level = miniLevel({
    nestX: 1, goalX: 40,
    supply: { digger: 0, builder: 0, blocker: 1, climber: 0 },
    goose: { x0: 10, x1: 30, y: 50, speed: 1, catchRadius: 1 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 15); // partway into the beat
  assert.equal(assignSkill(state, duck.id, 'blocker'), duck);
  assert.equal(state.goose.fed, false, 'the goose has not reached the block yet');
  run(state, 40); // enough for the goose to swing back around to column 15
  assert.equal(state.goose.fed, true, 'turning the goose back calls the hunt off, same as a catch would');
});

test('a relentless goose keeps hunting after a catch, unless a blocker calls it off', () => {
  const level = miniLevel({
    duckCount: 3, spawnInterval: 60, nestX: 1, goalX: 40, timeLimit: 300,
    goose: { x0: 10, x1: 30, y: 50, speed: 1, catchRadius: 1, relentless: true },
  });
  const state = run(newGame(level), 300);
  const goosed = state.ducks.filter(d => d.cause === 'goosed');
  assert.equal(goosed.length, state.ducks.length, 'a relentless, unblocked goose should take the whole flock');
});

test('blocking a relentless goose calls the hunt off for good, same as a catch would', () => {
  // A single duckling: the point here is the goose itself giving up once
  // blocked (state.goose.fed), not what happens to the rest of the flock —
  // a planted Blocker is a wall for its own flock too (see the test above),
  // so a duckling planted anywhere on the one road out of the nest calls
  // off the hunt for whoever has not reached it yet right along with it.
  const level = miniLevel({
    duckCount: 1, nestX: 1, goalX: 40, timeLimit: 300,
    supply: { digger: 0, builder: 0, blocker: 1, climber: 0 },
    goose: { x0: 10, x1: 30, y: 50, speed: 1, catchRadius: 1, relentless: true },
  });
  const state = run(newGame(level), 1);
  const first = state.ducks[0];
  tickUntilAt(state, first, 15); // partway into the beat, well before it is caught
  assert.equal(assignSkill(state, first.id, 'blocker'), first);
  assert.equal(state.goose.fed, false, 'the goose has not reached the block yet');
  run(state, 40); // enough for the goose to swing back around to column 15
  assert.equal(state.goose.fed, true, 'turning the goose back calls the hunt off, same as a catch would');
  assert.equal(first.cause, null, 'the blocker itself was never caught');
});

/* --------------------------------------------------------------- assigning */

test('assignSkill refuses an unknown skill, a missing duckling, and an empty supply', () => {
  const state = run(newGame(miniLevel()), 1);
  const duck = state.ducks[0];
  assert.match(assignRefusal(state, duck.id, 'quack'), /no such skill/);
  assert.match(assignRefusal(state, 999999, 'digger'), /no such duckling/);
  assert.match(assignRefusal(state, duck.id, 'digger'), /out of/i);
});

test('assignSkill refuses a duckling that is already busy', () => {
  const level = miniLevel({ supply: { digger: 0, builder: 0, blocker: 2, climber: 0 } });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'blocker');
  assert.match(assignRefusal(state, duck.id, 'blocker'), /busy/);
});

test('duckNear finds the closest open duckling and ignores resolved ones', () => {
  const level = miniLevel({ duckCount: 1, goalX: 4 });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(duckNear(state, duck.x, duck.y, 5), duck);
  run(state, 10); // reaches the goal and is saved
  assert.equal(state.ducks[0].state, 'saved');
  assert.equal(duckNear(state, duck.x, duck.y, 5), null);
});

/* --------------------------------------------------------- The Park, played */

/* A greedy bot: bridge the gap the first chance it appears, and give every
 * duckling still unskilled a climber for the wall and a flyer for the drop
 * beyond it, the moment each is close enough to need one soon. It is not a
 * clever player — it is the simplest policy that should be able to clear
 * this level at all, which is the property this test is actually checking.
 */
/* The end of whatever ramp is standing, or -1. What a player aims the second
   Builder at: the duckling out on the last column of the ramp so far. */
function rampEnd(state){
  return state.decks.findLastIndex(at => at.length > 0);
}

function playLevel1(){
  const state = newGame(LEVEL_PARK);
  let builderUsed = false, extended = false;
  for(let i = 0; i < LEVEL_PARK.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      // The Park's gap is wider than one ramp reaches (see LEVEL_PARK's note):
      // lay one at the lip, then extend it from its far end.
      if(!builderUsed && d.x === 69 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
      const end = rampEnd(state);
      if(builderUsed && !extended && end > 0 && d.x === end && state.decks[end].includes(d.y)){
        if(assignSkill(state, d.id, 'builder')) extended = true;
        continue;
      }
      if(!hasTrait(d, 'climber') && d.x >= 136 && d.x < 150) assignSkill(state, d.id, 'climber');
      else if(!hasTrait(d, 'flyer') && d.x >= 160 && d.x < 219) assignSkill(state, d.id, 'flyer');
    }
    tick(state);
  }
  return state;
}

test('The Park can be won by a simple bot', () => {
  const state = playLevel1();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_PARK), `only ${state.saved} saved, needed ${winCount(LEVEL_PARK)}`);
});

/* ------------------------------------------------------------- The Warren, played */

/* A greedy bot for The Warren: bridge the one gap, dig through each wall
 * the first chance it appears. No Climber or Flyer to reach for — this
 * level supplies neither, on purpose (see content.js), so a bot that only
 * knows Builder and Digger should still be enough to clear it.
 */
function playLevel2(){
  const state = newGame(LEVEL_WARREN);
  let builderUsed = false, digger1Used = false, digger2Used = false;
  for(let i = 0; i < LEVEL_WARREN.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 39 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
      if(!digger1Used && d.x === 119 && assignSkill(state, d.id, 'digger')){ digger1Used = true; continue; }
      if(!digger2Used && d.x === 219 && assignSkill(state, d.id, 'digger')){ digger2Used = true; continue; }
    }
    tick(state);
  }
  return state;
}

test('The Warren can be won by a simple bot', () => {
  const state = playLevel2();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_WARREN), `only ${state.saved} saved, needed ${winCount(LEVEL_WARREN)}`);
});

test('The Warren cannot be won without a Digger — neither wall has any other way through', () => {
  // The level supplies zero Climber and zero Flyer (see content.js), so
  // this is really checking that the level design itself, not just the
  // bot, actually forces the issue: bridging the gap alone is not enough.
  const state = newGame(LEVEL_WARREN);
  let builderUsed = false;
  for(let i = 0; i < LEVEL_WARREN.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 39 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past the first wall without a Digger');
  assert.notEqual(state.ended, 'won');
});

/* ------------------------------------------------------------ The Orchard, played */

/* The Orchard, on three Flyers.
 *
 * The drop into the low plain is twenty-five pixels — one more than a
 * duckling survives — and there are three Flyers for twenty-five of them,
 * so the answer cannot be to hand everybody one. Two go down, the first
 * stands so the second can turn at it, and the second builds a ramp back up
 * to within a step of the ledge. Then both stand down and the flock walks
 * down what it used to fall.
 *
 * `wall` picks how the wall itself is crossed, because the level supplies
 * both and both still have to work.
 */
function playLevel3({ wall = 'digger', turnAt = 60, rampAt = 110, holdAt = 140,
                      skip = null } = {}){
  const state = newGame(LEVEL_ORCHARD);
  let gap1 = false, gap2 = false, crossed = false;
  const flyers = [];
  let turner = null, ramped = false, holder = null, freed = false, scarer = null, scared = false;

  for(let i = 0; i < LEVEL_ORCHARD.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;

      /* The goose meets a planted Blocker and leaves for good; standing it
         down again a moment later leaves the road out of the nest clear. */
      if(!scarer && Math.round(d.x) === 290 && d.y === 150){
        if(assignSkill(state, d.id, 'blocker')) scarer = d;
        continue;
      }
      if(!gap1 && d.x === 250){
        if(assignSkill(state, d.id, 'builder')) gap1 = true;
        continue;
      }
      // The wall, once, for the whole flock either way.
      if(wall === 'digger'){
        if(!crossed && d.y === 150 && d.x > 206 && d.x < 229){
          if(assignSkill(state, d.id, 'digger')) crossed = true;
          continue;
        }
      } else if(!hasTrait(d, 'climber')){
        assignSkill(state, d.id, 'climber');
        crossed = true;
      }
      // The two that go down, taken as soon as they are past the wall.
      if(skip !== 'flyer' && flyers.length < 2 && crossed && d.y === 150
         && d.x > 140 && d.x < 174 && !hasTrait(d, 'flyer')){
        if(assignSkill(state, d.id, 'flyer')) flyers.push(d);
        continue;
      }
      /* And everybody else held off the ledge — but only once those two are
         past, because a Blocker planted any earlier turns them round too. */
      if(skip !== 'hold' && flyers.length === 2 && !holder && !hasTrait(d, 'flyer')
         && d.y === 150 && Math.round(d.x) === holdAt
         && flyers.every(f => f.x < holdAt || f.y > 150)){
        if(assignSkill(state, d.id, 'blocker')) holder = d;
        continue;
      }
      // One stands; the other turns at it, facing the ledge again.
      if(skip !== 'turn' && !turner && hasTrait(d, 'flyer') && d.y === 175
         && Math.round(d.x) === turnAt){
        if(assignSkill(state, d.id, 'blocker')) turner = d;
        continue;
      }
      if(skip !== 'ramp' && turner && !ramped && d.y === 175 && d.dir === 1
         && Math.round(d.x) === rampAt){
        if(assignSkill(state, d.id, 'builder')) ramped = true;
        continue;
      }
      if(ramped && !gap2 && d.x === 35){
        if(assignSkill(state, d.id, 'builder')) gap2 = true;
        continue;
      }
    }
    /* Once only. That duckling goes on to walk the rest of the level, and
       may well end up being the one planted to turn the flock later — at
       which point an unguarded "release the scarer" would stand the turner
       back up again, which is exactly what it did. */
    if(scarer && !scared && scarer.state === 'blocking' && state.goose.fed){
      releaseBlocker(state, scarer.id);
      scared = true;
    }
    if(ramped && !freed && !state.ducks.some(d => d.state === 'building')){
      for(const b of [turner, holder]) if(b && b.state === 'blocking') releaseBlocker(state, b.id);
      freed = true;
    }
    tick(state);
  }
  return { state, ramped };
}

test('The Orchard is won by building the way down, not by flying it', () => {
  const { state, ramped } = playLevel3();
  assert.ok(ramped, 'the ramp back up to the ledge should have gone in');
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_ORCHARD), `only ${state.saved} saved, needed ${winCount(LEVEL_ORCHARD)}`);
  assert.ok(state.saved > LEVEL_ORCHARD.supply.flyer,
    'more got home than there were Flyers, so they did not fly down');
});

test('The Orchard\'s wall is the Digger\'s now — climbing it strands the flock', () => {
  /* It used to be a real choice, and it was a choice that Flyer paid for:
     climbing leaves a duckling at the wall's own height, and the plateau
     runs out in a fifty-pixel drop that only a Flyer answers. That was free
     when every duckling could have one. On three Flyers it is not, so the
     tunnel is the way through and the Climbers in the supply no longer buy
     a second route. */
  assert.equal(playLevel3({ wall: 'digger' }).state.ended, 'won');

  const { state } = playLevel3({ wall: 'climber' });
  assert.notEqual(state.ended, 'won', 'climbing cannot carry the flock any more');

  const level = newGame(LEVEL_ORCHARD);
  const plateauDrop = level.terrain[174] - level.terrain[175];
  assert.ok(plateauDrop > FALL_SAFE,
    `the drop off the plateau is ${plateauDrop}, which is why climbing needs a Flyer each`);
});

test('The Orchard\'s way down needs the Flyers, the turn and the ramp alike', () => {
  for(const skip of ['flyer', 'turn', 'ramp']){
    const { state } = playLevel3({ skip });
    assert.equal(state.saved, 0, `without the ${skip} nothing should reach the pond`);
    assert.notEqual(state.ended, 'won');
  }
});

test('The Orchard hands out far fewer Flyers than it hatches ducklings', () => {
  // The whole point of the rework: the drop cannot be paid for one duckling
  // at a time any more.
  assert.equal(LEVEL_ORCHARD.supply.flyer, 3);
  assert.equal(LEVEL_ORCHARD.supply.builder, 10);
  assert.ok(LEVEL_ORCHARD.supply.flyer < LEVEL_ORCHARD.duckCount / 2);
});

test('The Orchard cannot be won without a Builder — neither gap has any other answer', () => {
  const state = newGame(LEVEL_ORCHARD);
  for(let i = 0; i < LEVEL_ORCHARD.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'flyer')) assignSkill(state, d.id, 'flyer');
      if(!hasTrait(d, 'climber')) assignSkill(state, d.id, 'climber');
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past either gap without a Builder');
});

test('The Orchard cannot be won without a Flyer, whichever way the wall was crossed', () => {
  // The point of the buffer between the wall and the drop: a dig cannot
  // reach far enough to also flatten this hazard the way it flattens the
  // wall's own landing, so Flyer stays required even with Digger to spare.
  const state = newGame(LEVEL_ORCHARD);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_ORCHARD.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'digger')) assignSkill(state, d.id, 'digger');
      if(!builder1Used && d.x === 250){ if(assignSkill(state, d.id, 'builder')) builder1Used = true; continue; }
      if(!builder2Used && d.x === 35){ if(assignSkill(state, d.id, 'builder')) builder2Used = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should survive the drop without a Flyer');
});

test('The Orchard walks nest to pond right to left — goalHeading reads -1 and the first hatchling starts facing the pond', () => {
  assert.equal(goalHeading(LEVEL_ORCHARD), -1);
  const state = newGame(LEVEL_ORCHARD);
  tick(state);
  assert.equal(state.ducks[0].dir, -1);
});

test('a blocker planted near The Orchard\'s nest turns the goose back for good but strands the flock behind it', () => {
  const state = newGame(LEVEL_ORCHARD);
  let builder1Used = false, builder2Used = false, blockerUsed = false;
  for(let i = 0; i < LEVEL_ORCHARD.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!blockerUsed && d.x === 292){ if(assignSkill(state, d.id, 'blocker')) blockerUsed = true; continue; }
      if(!hasTrait(d, 'climber')) assignSkill(state, d.id, 'climber');
      if(!hasTrait(d, 'flyer')) assignSkill(state, d.id, 'flyer');
      if(!builder1Used && d.x === 250){ if(assignSkill(state, d.id, 'builder')) builder1Used = true; continue; }
      if(!builder2Used && d.x === 35){ if(assignSkill(state, d.id, 'builder')) builder2Used = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'a blocker on the only road out of the nest strands the flock behind it, it does not save it');
  assert.ok(state.ducks.some(d => d.state === 'blocking'), 'the blocker itself should still be standing there');
});

/* ---------------------------------------------------------------- The Grove, played */

/* A bot for The Grove: bridge the one gap, then the level's own trick —
 * a ramp started well back from the wall, so the duckling that walks up it
 * is above the rock seam when it arrives and can dig from there. `rampAt` is
 * where that second Builder goes, which is the whole decision this level is
 * built around.
 */
function playLevel4(rampAt = 100){
  const state = newGame(LEVEL_GROVE);
  let gapBuilder = false, wallRamp = false, diggerUsed = false;
  for(let i = 0; i < LEVEL_GROVE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!gapBuilder && d.x === 49){ if(assignSkill(state, d.id, 'builder')) gapBuilder = true; continue; }
      if(rampAt !== null && gapBuilder && !wallRamp && d.x === rampAt){
        if(assignSkill(state, d.id, 'builder')) wallRamp = true;
        continue;
      }
      if(!diggerUsed && !hasTrait(d, 'digger') && d.x >= 120 && d.x < 130){
        if(assignSkill(state, d.id, 'digger')) diggerUsed = true;
        continue;
      }
    }
    tick(state);
  }
  return state;
}

test('The Grove can be won by ramping up to the wall and digging above the rock', () => {
  const state = playLevel4();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_GROVE), `only ${state.saved} saved, needed ${winCount(LEVEL_GROVE)}`);
  // The tunnel is up in the dirt, not down at the ground the flock started on.
  const cut = state.tunnelY.findIndex(v => v != null);
  assert.ok(cut > 0, 'a tunnel should have been cut at all');
  assert.ok(state.tunnelY[cut] <= 140, `the tunnel should be above the rock seam, got ${state.tunnelY[cut]}`);
});

test('The Grove cannot be won without a Digger — the wall still has no other way through', () => {
  const state = newGame(LEVEL_GROVE);
  let gapBuilder = false, wallRamp = false;
  for(let i = 0; i < LEVEL_GROVE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!gapBuilder && d.x === 49){ if(assignSkill(state, d.id, 'builder')) gapBuilder = true; continue; }
      if(gapBuilder && !wallRamp && d.x === 100){ if(assignSkill(state, d.id, 'builder')) wallRamp = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past the wall without a Digger');
  assert.notEqual(state.ended, 'won');
});

test('The Grove\'s wall is rock at the level a duckling meets it — a Digger alone gets nowhere', () => {
  /* The point of the level. Diggers to spare, a bridge over the gap, and no
   * ramp at the wall: every one of them walks into rock and turns back, and
   * not one column is ever cut. See LEVEL_GROVE's note and content.js's
   * `hardBelow`.
   */
  const state = newGame(LEVEL_GROVE);
  let gapBuilder = false;
  for(let i = 0; i < LEVEL_GROVE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!gapBuilder && d.x === 49){ if(assignSkill(state, d.id, 'builder')) gapBuilder = true; continue; }
      if(!hasTrait(d, 'digger') && d.x >= 120 && d.x < 130) assignSkill(state, d.id, 'digger');
    }
    tick(state);
  }
  assert.ok(state.tunnelY.every(v => v == null), 'rock should refuse every one of them');
  assert.equal(state.saved, 0);
});

test('The Grove\'s ramp has to be started far enough back to clear the seam, and not so far it stops short', () => {
  // Too late and the ramp is still in rock when it arrives; too early and it
  // ends before the wall and the duckling walks the rest at ground level.
  for(const rampAt of [120, 90]){
    const state = playLevel4(rampAt);
    assert.ok(state.tunnelY.every(v => v == null),
      `a ramp started at ${rampAt} should not get anyone above the seam`);
  }
  // And a spread of sensible spots all do work, so this is a window rather
  // than one exact column.
  for(const rampAt of [100, 105, 110]){
    const state = playLevel4(rampAt);
    assert.equal(state.ended, 'won', `a ramp started at ${rampAt} should win`);
  }
});

/* ----------------------------------------------------------------- The Aerie, played */

/* A greedy bot for The Aerie: bridge the first gap, climb the rock, bridge
 * the second gap onto the island. No Digger branch — the level's whole
 * point is that rock refuses one (see content.js), so a bot that only
 * knows Builder and Climber should still be enough to clear it.
 */
function playLevel5(){
  const state = newGame(LEVEL_AERIE);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_AERIE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builder1Used && d.x === 39 && assignSkill(state, d.id, 'builder')){ builder1Used = true; continue; }
      if(!hasTrait(d, 'climber') && d.x >= 100 && d.x < 120) assignSkill(state, d.id, 'climber');
      if(!builder2Used && d.x === 179 && assignSkill(state, d.id, 'builder')){ builder2Used = true; continue; }
    }
    tick(state);
  }
  return state;
}

test('The Aerie can be won by a simple bot', () => {
  const state = playLevel5();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_AERIE), `only ${state.saved} saved, needed ${winCount(LEVEL_AERIE)}`);
});

test('The Aerie cannot be won with Digger alone — the rock refuses it', () => {
  // Same bot as above, Climber swapped for Digger: both gaps get bridged
  // perfectly and nothing ever gets past the rock.
  const state = newGame(LEVEL_AERIE);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_AERIE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builder1Used && d.x === 39 && assignSkill(state, d.id, 'builder')){ builder1Used = true; continue; }
      if(!hasTrait(d, 'digger') && d.x >= 100 && d.x < 120) assignSkill(state, d.id, 'digger');
      if(!builder2Used && d.x === 179 && assignSkill(state, d.id, 'builder')){ builder2Used = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past the rock with only a Digger');
  assert.notEqual(state.ended, 'won');
});

test('The Aerie cannot be won without a Builder — neither gap has any other answer', () => {
  const state = newGame(LEVEL_AERIE);
  for(let i = 0; i < LEVEL_AERIE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'climber') && d.x >= 100 && d.x < 120) assignSkill(state, d.id, 'climber');
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past the first gap without a Builder');
  assert.notEqual(state.ended, 'won');
});

/* The Spire, played from the top down. Every run needs the same three
 * moves in the same order: wings on the first duckling out of the nest so
 * something survives the drop off the bottom tread, a ramp laid under that
 * drop so everyone behind it lands on a deck instead, and a tunnel through
 * the spire's foot. `rampAt` is where the Builder goes, which is the one
 * placement decision the level asks for.
 */
function playLevel6({ flyers = 3, rampAt = 62, dig = true } = {}){
  const state = newGame(LEVEL_SPIRE);
  let flown = 0, ramped = false, dug = false;
  for(let i = 0; i < LEVEL_SPIRE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      // Up on the ledge, before it walks off the face.
      if(flown < flyers && !hasTrait(d, 'flyer') && d.y <= 40){
        if(assignSkill(state, d.id, 'flyer')) flown++;
        continue;
      }
      if(rampAt !== null && !ramped && d.y >= 150 && d.dir > 0 && d.x === rampAt){
        if(assignSkill(state, d.id, 'builder')) ramped = true;
        continue;
      }
      if(dig && ramped && !dug && d.dir > 0 && d.x >= 62 && d.x <= 88){
        if(assignSkill(state, d.id, 'digger')) dug = true;
        continue;
      }
    }
    tick(state);
  }
  return state;
}

test('The Spire can be won with a Flyer, a Builder and a Digger, in that order', () => {
  const state = playLevel6();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_SPIRE), `only ${state.saved} saved, needed ${winCount(LEVEL_SPIRE)}`);
  const cut = state.tunnelY.filter(v => v != null).length;
  assert.equal(cut, 30, `the spire is thirty columns thick, got a tunnel of ${cut}`);
  assert.ok(cut <= DIG_MAX_STEPS, 'and inside what one Digger reaches');
});

test('The Spire hatches its flock on the summit, walking away from the pond', () => {
  const state = run(newGame(LEVEL_SPIRE), 1);
  const first = state.ducks[0];
  // One tick in, so it has hatched and taken its first step away from the nest.
  assert.equal(first.x, LEVEL_SPIRE.nestX - 1, 'a step to the left of the nest');
  assert.equal(first.y, 30, 'the nest sits on the summit ledge');
  assert.equal(first.dir, -1, 'and its ducklings step out to the left');
  assert.equal(goalHeading(LEVEL_SPIRE), 1, 'while the pond is still away to the right');
});

test('The Spire\'s face is walked down and never up', () => {
  // Every tread is taller than a step and shorter than a killing fall, so
  // the descent is free and the climb back is impossible. That one fact is
  // what makes the level a one-way trip.
  const terrain = buildTerrain(LEVEL_SPIRE.segments);
  for(let x = 91; x <= 101; x++){
    const rise = terrain[x - 1] - terrain[x];
    if(rise === 0) continue;
    assert.ok(rise > WALK_STEP, `the tread at ${x} should be too tall to walk up, got ${rise}`);
    assert.ok(rise <= FALL_SAFE, `and short enough to walk down, got ${rise}`);
  }
  // And the last one is not a tread at all: it is a real drop.
  assert.equal(terrain[89] - terrain[90], 30, 'thirty pixels from the bottom tread down to the ground');
  assert.ok(terrain[89] - terrain[90] > FALL_SAFE, 'which is past what a duckling survives');
});

test('The Spire cannot be won without a Flyer — nothing else survives the first drop', () => {
  const state = playLevel6({ flyers: 0 });
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('The Spire cannot be won without a Builder — the flock lands on the ramp or not at all', () => {
  const state = playLevel6({ rampAt: null });
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('The Spire cannot be won without a Digger, and the pen holds the flock safely while it waits', () => {
  const state = playLevel6({ dig: false });
  assert.equal(state.saved, 0, 'nothing gets past the spire without a tunnel');
  assert.notEqual(state.ended, 'won');
  // The bluff at one end and the spire at the other: ducklings shuttle
  // between them rather than walking off anything.
  assert.ok(state.lost <= 1, `the pen should not be killing them, lost ${state.lost}`);
  const penned = state.ducks.filter(d => d.state === 'walking');
  assert.ok(penned.length > 10, 'most of the flock should still be alive and waiting');
  for(const d of penned){
    assert.ok(d.x >= 59 && d.x <= 120, `a penned duckling at ${d.x} has got out somehow`);
  }
});

test('The Spire cannot be tunnelled from the grass — the seam is rock down there', () => {
  // The Digger has to be carried up by the ramp before it is looking at
  // anything it can cut. Handed one on the pen floor and left there, it
  // walks into the spire's foot and turns around, forever.
  const state = newGame(LEVEL_SPIRE);
  assert.equal(state.rockBelow[95], 145, 'the spire has a seam at 145');
  let ticks = 0;
  for(let i = 0; i < LEVEL_SPIRE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'flyer') && d.y <= 40) assignSkill(state, d.id, 'flyer');
      if(!hasTrait(d, 'digger') && d.y >= 150) assignSkill(state, d.id, 'digger');
    }
    tick(state);
    ticks++;
  }
  assert.ok(ticks > 0);
  assert.ok(state.tunnelY.every(v => v == null), 'not one column cut from the grass');
  assert.equal(state.saved, 0);
});

test('The Spire\'s bluff is rock — a Digger sent at it never starts', () => {
  const state = newGame(LEVEL_SPIRE);
  assert.ok(state.rock[30], 'the bluff should be stone');
  assert.ok(!state.rock[95], 'and the spire itself should not be');
  let cutAtBluff = false;
  for(let i = 0; i < LEVEL_SPIRE.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'flyer') && d.y <= 40) assignSkill(state, d.id, 'flyer');
      if(!hasTrait(d, 'digger') && d.y >= 150) assignSkill(state, d.id, 'digger');
    }
    tick(state);
    if(state.tunnelY.slice(0, 60).some(v => v != null)) cutAtBluff = true;
  }
  assert.equal(cutAtBluff, false, 'no tunnel should ever appear in the bluff');
});

test('The Spire takes a ramp anywhere along the pen floor', () => {
  for(const rampAt of [60, 66, 72, 78]){
    const state = playLevel6({ rampAt });
    assert.equal(state.ended, 'won', `a ramp started at ${rampAt} should win`);
  }
});

/* --------------------------------------------------------------- islands */

/* Flat ground with a shelf in the sky over the middle of it. The whole
   point of an island is that both of those are real at once. */
function islandLevel(overrides = {}){
  return miniLevel({
    islands: [{ from: 20, to: 60, y: 20, floor: 34 }],
    goalX: SCENE_W - 1, timeLimit: 600,
    ...overrides,
  });
}

test('a duckling walks along the ground underneath an island, not into it', () => {
  const state = run(newGame(islandLevel()), 1);
  const duck = state.ducks[0];
  run(state, 60);
  assert.equal(duck.y, 50, 'still on the ground the whole way');
  assert.ok(duck.x > 40, 'and out the far side of the island overhead');
  run(state, 400);
  assert.equal(duck.state, 'saved');
});

test('an island is real ground to anything standing on it', () => {
  // Put a duckling up there the only way a level can — a teleporter — and
  // it walks the shelf exactly as it would walk the floor.
  const level = islandLevel({ teleports: [{ ax: 10, ay: 50, bx: 25, by: 20 }] });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 20);
  assert.equal(duck.y, 20, 'up on the island');
  assert.ok(duck.x > 25, 'and walking along it');
  // And it walks off the far end, falling to the ground below.
  run(state, 60);
  assert.equal(duck.y, 50, 'back on the ground past the island');
});

test('an island does not fill in the ground under it', () => {
  const state = newGame(islandLevel());
  assert.equal(state.terrain[40], 50, 'the ground below is untouched');
  assert.deepEqual(state.sky[40], [20], 'and the shelf is a surface of its own');
  assert.deepEqual(state.sky[10], [], 'with nothing anywhere else');
});

/* ----------------------------------------------------------- teleporters */

function padLevel(overrides = {}){
  return miniLevel({
    teleports: [{ ax: 20, ay: 50, bx: 60, by: 50 }],
    goalX: SCENE_W - 1, timeLimit: 600,
    ...overrides,
  });
}

test('a duckling that walks onto a pad comes out of the other one', () => {
  const state = run(newGame(padLevel()), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 20);
  assert.equal(state.warps, 0);
  tick(state);
  assert.equal(duck.x, 60, 'out of the far pad');
  assert.equal(duck.y, 50);
  assert.equal(duck.dir, 1, 'still going the way it was going');
  assert.equal(state.warps, 1);
  assert.equal(state.zaps.length, 2, 'a flash at both ends');
});

test('arriving on a pad does not send a duckling straight back', () => {
  const state = run(newGame(padLevel()), 1);
  const duck = state.ducks[0];
  run(state, 400);
  assert.equal(state.warps, 1, 'one trip, not a hundred');
  assert.equal(duck.state, 'saved');
});

test('a pair works both ways, once a duckling has walked off the pad', () => {
  const state = run(newGame(padLevel()), 1);
  const traveller = state.ducks[0];
  run(state, 30);
  assert.equal(state.warps, 1);
  assert.ok(traveller.x > 60, 'well clear of the pad it arrived on');
  traveller.dir = -1;                       // as a blocker would have left it
  run(state, 40);
  assert.equal(state.warps, 2, 'back through the pair the other way');
  assert.ok(traveller.x < 60, 'and back at the near end');
});

test('a pad under an island belongs to whatever is standing on it', () => {
  // One pad on the ground, one up on the shelf directly above it. A
  // duckling walking the floor must not be caught by the shelf's pad.
  const level = miniLevel({
    islands: [{ from: 20, to: 60, y: 20, floor: 34 }],
    teleports: [{ ax: 40, ay: 20, bx: 200, by: 50 }],
    goalX: SCENE_W - 1, timeLimit: 600,
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 80);
  assert.equal(state.warps, 0, 'a pad overhead is not underfoot');
  assert.ok(duck.x > 60);
});

test('a falling duckling never lands on something over its head', () => {
  /* Stepping off a ledge with an island hanging above the column it steps
     into: the island is not a landing, it is a thing it is falling away
     from. This was real — the first cut of The Stepping Stones had the
     flock arriving safely on an island twenty-four pixels above the ramp
     they walked off. */
  const level = miniLevel({
    segments: [{ from: 0, to: 20, y: 60 }, { from: 20, to: SCENE_W, y: 150 }],
    islands: [{ from: 20, to: 120, y: 36, floor: 46 }],
    goalX: SCENE_W - 1, timeLimit: 600,
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 60);
  assert.notEqual(duck.y, 36, 'it must not have landed on the island above it');
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
});

test('a falling duckling still lands on a ramp deck it falls past', () => {
  // The other half of the same rule: a deck between where it stepped off
  // and where it is now is a landing, and catches it.
  const level = miniLevel({
    segments: [{ from: 0, to: 20, y: 60 }, { from: 20, to: SCENE_W, y: 150 }],
    islands: [{ from: 20, to: 120, y: 80, floor: 90 }],
    goalX: SCENE_W - 1, timeLimit: 600,
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 30);
  assert.equal(duck.y, 80, 'caught by the island below the ledge');
  assert.equal(duck.state, 'walking');
});

/* ------------------------------------------------------------- flyer drift */

test('a flyer comes down at a slant, in the direction it was walking', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 20, y: 40 }, { from: 20, to: SCENE_W, y: 150 }],
    goalX: SCENE_W - 1, timeLimit: 600,
    supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 1 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'flyer');
  run(state, 25);
  assert.equal(duck.state, 'falling');
  const drifted = duck.x - 20;
  assert.ok(drifted > 2, `it should have slid forward by now, got ${drifted.toFixed(1)}`);
  run(state, 200);
  assert.equal(duck.state, 'walking', 'and landed unhurt');
  assert.equal(duck.y, 150);
  // 110 pixels of drop at FLY_SPEED, drifting FLY_DRIFT a tick.
  assert.ok(duck.x > 20 + 110 * FLY_DRIFT - 4, `landed at ${duck.x}, short of the glide`);
  assert.equal(duck.x, Math.round(duck.x), 'and back onto a whole column');
});

test('a plain fall does not drift at all', () => {
  // Same cliff as the flyer above, and no wings: it goes straight down the
  // column it stepped off, and dies where it lands.
  const level = miniLevel({
    segments: [{ from: 0, to: 20, y: 40 }, { from: 20, to: SCENE_W, y: 150 }],
    goalX: SCENE_W - 1, timeLimit: 600,
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  run(state, 22);
  assert.equal(duck.state, 'falling');
  assert.equal(duck.x, 20, 'not a pixel sideways');
  run(state, 60);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.x, 20);
});

test('a flyer pinned against a cliff face comes straight down it', () => {
  // The drop is into a shaft one column wide: drifting into the wall would
  // land it on top of the thing it just fell off.
  const level = miniLevel({
    segments: [
      { from: 0, to: 20, y: 40 },
      { from: 20, to: 24, y: 150 },
      { from: 24, to: SCENE_W, y: 40 },
    ],
    goalX: SCENE_W - 1, timeLimit: 600,
    supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 1 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'flyer');
  run(state, 200);
  assert.equal(duck.y, 150, 'it reached the bottom of the shaft');
  assert.ok(duck.x >= 20 && duck.x < 24, `and landed in it, not on the far lip (${duck.x})`);
});

/* --------------------------------------------------------------- jumping */

/* A level that is nothing but flat ground with one thing in the way, so a
   test can say exactly what a Jumper does and does not clear. */
function hopLevel(middle){
  return miniLevel({
    segments: [{ from: 0, to: 40, y: 150 }, ...middle, { from: 90, to: SCENE_W, y: 150 }],
    nestX: 30, goalX: SCENE_W - 4, timeLimit: 2000,
    supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 0, jumper: 1 },
  });
}
function runHop(level, giveJumper){
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  if(giveJumper) assert.equal(assignSkill(state, duck.id, 'jumper'), duck);
  let hops = 0, was = null;
  for(let i = 0; i < 1200 && !state.ended; i++){
    tick(state);
    if(duck.state === 'jumping' && was !== 'jumping') hops++;
    was = duck.state;
  }
  return { duck, hops, state };
}

test('a jumper hops a ditch a hop can reach across, and the same duckling keeps the knack', () => {
  const width = JUMP_SPAN - 1;   // the widest a hop reaches over — see content.js
  const level = hopLevel([{ from: 40, to: 40 + width, y: PIT_Y }, { from: 40 + width, to: 90, y: 150 }]);

  const without = runHop(level, false);
  assert.equal(without.duck.state, 'lost', 'without one it is just a hole in the ground');
  assert.equal(without.duck.cause, 'fell');

  const with_ = runHop(level, true);
  assert.equal(with_.duck.state, 'saved');
  assert.ok(with_.hops >= 1, 'it should have actually left the ground');
});

test('a jumper will not hop a real gap — that is still a Builder\'s', () => {
  const level = hopLevel([{ from: 40, to: 70, y: PIT_Y }, { from: 70, to: 90, y: 150 }]);
  const { duck, hops } = runHop(level, true);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
  assert.equal(hops, 0, 'it should not even try');
});

test('a jumper hops a step too tall to walk up, but not a wall', () => {
  const low = hopLevel([{ from: 40, to: 90, y: 150 - JUMP_RISE }]);
  assert.ok(JUMP_RISE > WALK_STEP, 'a hop has to be worth something over plain walking');
  const stepped = runHop(low, true);
  assert.equal(stepped.duck.state, 'saved');
  assert.ok(stepped.hops >= 1);

  // A real wall is still a wall: nothing in the game is between these two.
  const wall = hopLevel([{ from: 40, to: 90, y: 150 - 40 }]);
  const { duck, hops } = runHop(wall, true);
  assert.notEqual(duck.state, 'saved', 'a forty-pixel wall is not a hop');
  assert.equal(hops, 0);
});

test('a jumper hops the goose, and the goose gives up and leaves empty-beaked', () => {
  const level = miniLevel({
    nestX: 6, goalX: SCENE_W - 4, timeLimit: 2000, duckCount: 1,
    supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 0, jumper: 1 },
    goose: { x0: 100, x1: 140, y: 50, speed: 1.5, catchRadius: 1.5 },
  });
  const caught = runHop(level, false);
  assert.equal(caught.duck.state, 'lost');
  assert.equal(caught.duck.cause, 'goosed');

  const hopped = runHop(level, true);
  assert.equal(hopped.duck.state, 'saved');
  assert.ok(hopped.hops >= 1, 'it should have jumped it');
  /* Being hopped over calls the hunt off, the same way a catch or a Blocker
     does — but with nobody in its beak. The flock behind walks through. */
  assert.equal(hopped.state.goose.fed, true, 'the goose should have given up');
  assert.equal(hopped.state.lost, 0, 'and taken nobody with it');
});

test('a goose hopped over leaves the scene, and lets the rest of the flock past', () => {
  const level = miniLevel({
    nestX: 6, goalX: SCENE_W - 4, timeLimit: 4000, duckCount: 5, spawnInterval: 30,
    supply: { digger: 0, builder: 0, blocker: 0, climber: 0, flyer: 0, jumper: 1 },
    goose: { x0: 100, x1: 140, y: 50, speed: 1.5, catchRadius: 1.5 },
  });
  const state = newGame(level);
  let hopper = null;
  for(let i = 0; i < level.timeLimit && !state.ended; i++){
    // One Jumper, to the duckling in front. Everyone behind it is ordinary.
    if(!hopper && state.ducks.length){
      const first = state.ducks[0];
      if(first.state === 'walking' && assignSkill(state, first.id, 'jumper')) hopper = first;
    }
    tick(state);
  }
  assert.equal(state.saved, level.duckCount,
    'one hop should clear the goose for the whole flock');
  assert.equal(state.lost, 0);
  assert.ok(state.goose.gone, 'and the goose should have flown off the scene entirely');
});

test('every level carries at least one Jumper', () => {
  for(const level of LEVELS){
    assert.ok(level.supply.jumper >= 1, `${level.id} should have a Jumper`);
  }
});

/* ------------------------------------------------------------------ hints */

/* Every level says what it is about before a player walks into it.
 *
 * These are the one piece of player-facing prose in a game whose levels are
 * otherwise pure data, and the ways they go wrong are all quiet: a level
 * added without one shows a player nothing, and a hint that names a skill
 * the level does not hand out sends them looking for a button that is not
 * there. Neither throws.
 */
test('every level has a hint, and it is a sentence rather than a label', () => {
  for(const level of LEVELS){
    assert.ok(typeof level.hint === 'string' && level.hint.length > 0,
      `${level.id} ("${level.name}") has no hint`);
    assert.ok(level.hint.length >= 60,
      `${level.id}: "${level.hint}" is too short to say anything useful`);
    assert.ok(level.hint.length <= 320,
      `${level.id}: ${level.hint.length} characters is a walkthrough, not a hint`);
    assert.match(level.hint, /^[A-Z]/, `${level.id}: a hint should start as a sentence`);
    assert.match(level.hint, /[.!?]$/, `${level.id}: a hint should finish as one`);
  }
});

test('no two levels share a hint', () => {
  const seen = new Map();
  for(const level of LEVELS){
    assert.ok(!seen.has(level.hint), `${level.id} and ${seen.get(level.hint)} have the same hint`);
    seen.set(level.hint, level.id);
  }
});

test('a hint never sends a player after a skill the level does not hand out', () => {
  /* The trap this is for: a hint written for one level and reused, or a
     supply trimmed later without the prose being reread. The Hedgerow has
     no Digger, Climber or Flyer at all, and a hint there that mentioned one
     would be sending a player to a button that is not on the page. Mentions
     of a skill the level HAS are fine, and so is naming one to say it is
     useless here — which is what "no Climbers and no Flyers" does — so a
     negation right before the name is allowed for. */
  for(const level of LEVELS){
    for(const skill of SKILLS){
      for(const m of level.hint.matchAll(new RegExp(`\\b${skill}s?\\b`, 'gi'))){
        // Anything ruling it out, in this sentence, before the name.
        const before = level.hint.slice(0, m.index);
        if(/\b(no|not|never|cannot|nothing|neither|nor|without)\b[^.!?]*$/i.test(before)) continue;
        assert.ok(level.supply[skill] > 0,
          `${level.id}'s hint points at a ${skill}, but the level hands out none`);
      }
    }
  }
});

test('the hint reaches the play page', () => {
  // The level data is only half of it: the page has to print it.
  const page = readFileSync(new URL('../public/duck-duck-quack/play.html', import.meta.url), 'utf8');
  assert.match(page, /LEVEL\.hint/, 'play.html should read the level its hint');
  assert.match(page, /id="level-hint"/, 'and have somewhere to put it');
});

/* -------------------------------------------------------- the running order */

/* The order levels are played in lives in LEVELS and nowhere else. Every
 * other table in the game — the board's caps, the songs, the rooms, every
 * link into a level — is keyed by `id`, which is what makes a reorder free:
 * rearrange this list and not one saved score is stranded. These are the
 * checks that keep it that way.
 */
test('the running order is the twelve levels, each once', () => {
  const ids = LEVELS.map(l => l.id);
  assert.equal(new Set(ids).size, ids.length, 'a level appears twice in the running order');
  assert.equal(ids.length, 12);
});

test('the game opens on The Warren, which is the gentler of the first two', () => {
  /* The Park asks for eight of ten, the steepest quota in the game, and its
     one gap is longer than a single ramp — so it wanted a trick found before
     anything else had been learned. It is second now. */
  assert.equal(LEVELS[0].id, 'warren');
  assert.equal(LEVELS[1].id, 'park');
  const [first, second] = LEVELS;
  assert.ok(first.winRatio < second.winRatio,
    'the opening level should not ask for a larger share of its flock than the second');
});

test('nothing outside LEVELS hard-codes which level comes first', () => {
  /* The entry link on the front page said `?level=park` outright and went on
     pointing at the park when the order changed. It is set from LEVELS[0]
     now, and this is the test that noticed. */
  const page = readFileSync(new URL('../public/duck-duck-quack/index.html', import.meta.url), 'utf8');
  assert.ok(!/href="\.\/play\.html\?level=[a-z]+"/.test(page),
    'the front page should not write a level id into a link by hand');
  assert.match(page, /LEVELS\[0\]\.id/, 'it should follow the running order instead');
});

/* ------------------------------------------------------- The Hedgerow, played */

/* Give every duckling its own Jumper, and the one Builder at the lip of the
 * one gap. Both halves are switchable, because what this level is for is
 * that neither half alone is any use at all.
 */
function playLevel8({ jumpers = true, builder = true } = {}){
  const state = newGame(LEVEL_HEDGEROW);
  let built = false;
  for(let i = 0; i < LEVEL_HEDGEROW.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(jumpers && !hasTrait(d, 'jumper')) assignSkill(state, d.id, 'jumper');
      if(builder && !built && d.x === 149){ if(assignSkill(state, d.id, 'builder')) built = true; }
    }
    tick(state);
  }
  return state;
}

test('The Hedgerow can be won with Jumpers and the one Builder', () => {
  const state = playLevel8();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_HEDGEROW), `only ${state.saved} saved, needed ${winCount(LEVEL_HEDGEROW)}`);
});

test('The Hedgerow cannot be won without Jumpers — the first ditch stops the flock dead', () => {
  const state = playLevel8({ jumpers: false });
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('The Hedgerow cannot be won without the Builder — no hop reaches across its gap', () => {
  const state = playLevel8({ builder: false });
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('The Hedgerow asks for nothing else at all — it supplies no Digger, Climber or Flyer', () => {
  // Not rationing, absence: the level's whole claim is that everything on it
  // is either small enough to hop or too wide for anything but a ramp.
  for(const skill of ['digger', 'climber', 'flyer']){
    assert.equal(LEVEL_HEDGEROW.supply[skill], 0, `The Hedgerow should supply no ${skill}`);
  }
});

/* ------------------------------------------------------------- The Falls, played */

/* A bot for The Falls: two bridges, a Flyer given at hatch (it answers all
 * three drops off the one assignment, the level's whole point), and
 * either Climber or Digger for the one wall partway down.
 */
function playLevel7(useDigger){
  const state = newGame(LEVEL_FALLS);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_FALLS.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'flyer')) assignSkill(state, d.id, 'flyer');
      if(!hasTrait(d, useDigger ? 'digger' : 'climber')) assignSkill(state, d.id, useDigger ? 'digger' : 'climber');
      if(!builder1Used && d.x === 300){ if(assignSkill(state, d.id, 'builder')) builder1Used = true; continue; }
      if(!builder2Used && d.x === 140){ if(assignSkill(state, d.id, 'builder')) builder2Used = true; continue; }
    }
    tick(state);
  }
  return state;
}

test('The Falls can be won by climbing the one wall', () => {
  const state = playLevel7(false);
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_FALLS), `only ${state.saved} saved, needed ${winCount(LEVEL_FALLS)}`);
});

test('The Falls can also be won by digging the one wall instead of climbing it', () => {
  const state = playLevel7(true);
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_FALLS), `only ${state.saved} saved, needed ${winCount(LEVEL_FALLS)}`);
});

test('The Falls cannot be won without a Flyer — two of its three drops are real', () => {
  const state = newGame(LEVEL_FALLS);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_FALLS.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'climber')) assignSkill(state, d.id, 'climber');
      if(!builder1Used && d.x === 300){ if(assignSkill(state, d.id, 'builder')) builder1Used = true; continue; }
      if(!builder2Used && d.x === 140){ if(assignSkill(state, d.id, 'builder')) builder2Used = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should survive the real drops without a Flyer');
});

test('The Falls cannot be won without a way past the one wall', () => {
  /* This level descends, so its wall's top (15) sits only five pixels above
   * the nest's own ground (20) — within a ramp's BUILD_RISE_HEIGHT, and for
   * as long as BUILD_SECONDS was ten a Builder given at the first gap was
   * still climbing seventy columns later when it reached the wall, and went
   * straight over it. At four seconds a ramp is forty-four columns and runs
   * out well short, so the wall is a wall again and this holds the way it
   * always did. Worth keeping the reason written down: the margin here is
   * BUILD_SECONDS, not anything about the wall.
   */
  const state = newGame(LEVEL_FALLS);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_FALLS.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'flyer')) assignSkill(state, d.id, 'flyer');
      if(!builder1Used && d.x === 300){ if(assignSkill(state, d.id, 'builder')) builder1Used = true; continue; }
      if(!builder2Used && d.x === 140){ if(assignSkill(state, d.id, 'builder')) builder2Used = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past the wall without a Digger or a Climber');
});

test('The Falls cannot be won without a Builder — neither gap has any other answer', () => {
  const state = newGame(LEVEL_FALLS);
  for(let i = 0; i < LEVEL_FALLS.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'flyer')) assignSkill(state, d.id, 'flyer');
      if(!hasTrait(d, 'climber')) assignSkill(state, d.id, 'climber');
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past either gap without a Builder');
});

test('The Falls walks nest to pond right to left, from a higher start down to a lower pond', () => {
  assert.equal(goalHeading(LEVEL_FALLS), -1);
  assert.ok(LEVEL_FALLS.nestX > LEVEL_FALLS.goalX);
  const nestY = buildTerrain(LEVEL_FALLS.segments, LEVEL_FALLS.width)[LEVEL_FALLS.nestX];
  const goalY = buildTerrain(LEVEL_FALLS.segments, LEVEL_FALLS.width)[LEVEL_FALLS.goalX];
  assert.ok(goalY > nestY, 'the pond should sit lower (larger y) than the nest');
});

/* ------------------------------------------------- The Overlook, played */

/* The Overlook: one ramp across the gap and a second given to a duckling
   standing on the end of it, which carries that ramp on level to the
   bluff's face. Everything past the bluff is the pair of teleporters, and
   they need nothing from a player at all. */
function playLevel9({ gapAt = 59, extend = true } = {}){
  const state = newGame(LEVEL_OVERLOOK);
  let bridged = false, extended = false;
  for(let i = 0; i < LEVEL_OVERLOOK.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(gapAt !== null && !bridged && d.x === gapAt){
        if(assignSkill(state, d.id, 'builder')) bridged = true;
        continue;
      }
      if(extend && bridged && !extended){
        const end = rampEnd(state);
        if(end > 0 && d.x === end && state.decks[end].includes(d.y)){
          if(assignSkill(state, d.id, 'builder')) extended = true;
        }
      }
    }
    tick(state);
  }
  return state;
}

test('The Overlook can be won with two Builders and the teleporters', () => {
  const state = playLevel9();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_OVERLOOK), `only ${state.saved} saved, needed ${winCount(LEVEL_OVERLOOK)}`);
  assert.ok(state.warps >= state.saved, 'every duckling saved went through both pads');
});

test('The Overlook cannot be won with one Builder — the bluff is still a wall', () => {
  const state = playLevel9({ extend: false });
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('The Overlook cannot be won with none at all', () => {
  const state = playLevel9({ gapAt: null, extend: false });
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('The Overlook\'s bluff is rock, and no ramp is taller than it', () => {
  const state = newGame(LEVEL_OVERLOOK);
  assert.ok(state.rock[130], 'the bluff is stone');
  assert.equal(state.terrain[119] - state.terrain[120], 24,
    'and exactly one ramp high, which is what makes the second Builder the answer');
  assert.equal(state.terrain[119] - state.terrain[120], BUILD_RISE_HEIGHT);
});

test('The Overlook opens with a walkway running underneath an island', () => {
  const state = newGame(LEVEL_OVERLOOK);
  const isle = LEVEL_OVERLOOK.islands[0];
  // Ground below, shelf above, right where the flock walks in.
  for(let x = isle.from; x < 120; x++){
    assert.equal(state.terrain[x], 150, `the walkway at ${x} should be ordinary ground`);
    assert.deepEqual(state.sky[x], [isle.y], `with the shelf overhead at ${x}`);
  }
  // And nothing walks up into it on its own.
  let bridged = false;
  const walk = newGame(LEVEL_OVERLOOK);
  for(let i = 0; i < 300 && !walk.ended; i++){
    for(const d of walk.ducks){
      if(d.state === 'walking' && !bridged && d.x === 59){
        if(assignSkill(walk, d.id, 'builder')) bridged = true;
      }
    }
    tick(walk);
    for(const d of walk.ducks){
      if(d.state === 'walking' && d.x >= isle.from && d.x < 120){
        assert.notEqual(d.y, isle.y, 'nothing should end up on the shelf by walking');
      }
    }
  }
});

test('every level supplies a jumper count, and only The Overlook and The Spire carry the new furniture', () => {
  for(const level of LEVELS){
    for(const skill of SKILLS){
      assert.equal(typeof level.supply[skill], 'number', `${level.name} is missing ${skill}`);
    }
    for(const isle of level.islands ?? []){
      assert.ok(isle.to > isle.from, `${level.name} has a backwards island`);
      assert.ok(isle.floor > isle.y, `${level.name} has an island with no thickness`);
    }
    for(const t of level.teleports ?? []){
      assert.ok(t.ax >= 0 && t.ax < level.width, `${level.name} has a pad off the edge`);
      assert.ok(t.bx >= 0 && t.bx < level.width, `${level.name} has a pad off the edge`);
    }
  }
});

test('no level puts walkable ground so high that a ramp leaves the picture', () => {
  // The Falls was exactly this bug: a plateau fifteen pixels from the top of
  // the scene, and a Builder given anywhere near it drew its ramp off the
  // picture entirely.
  for(const level of LEVELS){
    const terrain = buildTerrain(level.segments, level.width);
    const tops = terrain.filter(y => y < SCENE_H);
    const highest = Math.min(...tops);
    assert.ok(highest - BUILD_RISE_HEIGHT >= 0,
      `${level.name}'s highest ground is ${highest}, and a ramp from it would reach ${highest - BUILD_RISE_HEIGHT}`);
    for(const isle of level.islands ?? []){
      assert.ok(isle.y - BUILD_RISE_HEIGHT >= 0,
        `${level.name}'s island at ${isle.y} leaves no room for a ramp above it`);
    }
  }
});

/* ------------------------------------------ The Stepping Stones, played */

/* The zigzag, then the crag and the notch. Three ramps get the flock up the
   islands — a Blocker to turn it round on each one that doubles back — and
   from the top island every duckling that wants the water climbs the crag
   and hops the notch for itself. The two turning Blockers stay planted;
   they are the route, not a hold. */
const STONES_PLAN = [
  { y: 150, at: 80,  dir: 1 },                 // pen -> island A
  { y: 126, at: 115, dir: -1, turn: 186 },     // A -> B, back to the left
  { y: 102, at: 50,  dir: 1,  turn: 33 },      // B -> C, right again
];

/* `hopGoose` hands the first duckling in the pen a Jumper, which sends the
   goose off empty-beaked rather than fed; `freeTurners` stands the two
   turning Blockers down at the end, island A's first — see the note over
   LEVEL_STONES for why the order is the whole difference. `inOrder: false`
   stands them down together, which is the mistake that order prevents. */
function playLevel10({ steps = STONES_PLAN.length, turns = true,
                       climbers = true, jumpers = true,
                       hopGoose = false, freeTurners = false, inOrder = true } = {}){
  const state = newGame(LEVEL_STONES);
  let stage = 0, held = null;
  const holders = [];
  let freed = 0;
  for(let i = 0; i < LEVEL_STONES.timeLimit && !state.ended; i++){
    const move = stage < steps ? STONES_PLAN[stage] : null;
    if(move){
      if(turns && move.turn != null && !held){
        const d = state.ducks.find(k => k.state === 'walking'
          && Math.round(k.x) === move.turn && k.y === move.y);
        if(d && assignSkill(state, d.id, 'blocker')){ held = d; holders.push(d); }
      }
      if(move.turn == null || !turns || held){
        const d = state.ducks.find(k => k.state === 'walking'
          && Math.round(k.x) === move.at && k.y === move.y && k.dir === move.dir);
        if(d && assignSkill(state, d.id, 'builder')){ stage++; held = null; }
      }
    }
    /* The goose, dealt with where it patrols: down in the pen, long before
       the notch that same Jumper is really for. */
    if(hopGoose && !state.goose.fed && !state.goose.gone){
      const d = state.ducks.find(k => k.state === 'walking' && k.y === 150 && !hasTrait(k, 'jumper'));
      if(d) assignSkill(state, d.id, 'jumper');
    }
    /* On the top island, and only there: a Climber given down in the pen
       scales the pen's own wall and walks into the chasm behind it. */
    for(const d of state.ducks){
      if(d.state !== 'walking' || d.y !== 78) continue;
      if(climbers && !hasTrait(d, 'climber')) assignSkill(state, d.id, 'climber');
      if(jumpers && !hasTrait(d, 'jumper')) assignSkill(state, d.id, 'jumper');
    }
    if(freeTurners && stage === STONES_PLAN.length && holders.length === 2
      && state.hatched >= LEVEL_STONES.duckCount){
      // Nothing left below the top island still needing to be turned.
      const below = state.ducks.some(d => d.state !== 'saved' && d.state !== 'lost'
        && d.state !== 'blocking' && d.y > 78);
      if(freed === 0 && !below){
        releaseBlocker(state, holders[0].id);
        if(!inOrder){ releaseBlocker(state, holders[1].id); freed = 2; }else{ freed = 1; }
      }else if(freed === 1 && (holders[0].y <= 78 || holders[0].state === 'saved')){
        releaseBlocker(state, holders[1].id);
        freed = 2;
      }
    }
    tick(state);
  }
  return { state, built: stage };
}

test('The Stepping Stones can be won by climbing the zigzag, then the crag', () => {
  const { state, built } = playLevel10();
  assert.equal(built, 3, 'all three ramps should have gone in');
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_STONES), `only ${state.saved} saved, needed ${winCount(LEVEL_STONES)}`);
});

/* The whole flock, not just the quota.
 *
 * This level used to be capped below its own duckCount by arithmetic nobody
 * had done: sixteen Climbers and sixteen Jumpers on a level that hatches
 * twenty-four, so eight ducklings could reach the top island and go no
 * further however well the level was played. A quota of twelve hid it — the
 * run said "won" either way.
 *
 * Three things have to come together for all twenty-four, and each one is a
 * separate test below so a regression says which broke: enough of the two
 * skills every duckling needs, the goose hopped rather than fed, and the two
 * turning Blockers stood down in the right order.
 */
test('The Stepping Stones can be played perfectly — every duckling in the pond', () => {
  const { state, built } = playLevel10({ hopGoose: true, freeTurners: true });
  assert.equal(built, 3);
  assert.equal(state.ended, 'won');
  assert.equal(state.saved, LEVEL_STONES.duckCount,
    `only ${state.saved} of ${LEVEL_STONES.duckCount} — a perfect run should be possible`);
  assert.equal(state.lost, 0, 'and it should not cost a single duckling');
});

test('The Stepping Stones carries a Climber and a Jumper for every duckling', () => {
  /* The ceiling, stated as arithmetic rather than discovered by playing:
     every duckling that wants the water climbs the crag and hops the notch,
     so anything less than one each here is a cap on the score that no amount
     of skill can lift. */
  for(const skill of ['climber', 'jumper']){
    assert.ok(LEVEL_STONES.supply[skill] >= LEVEL_STONES.duckCount,
      `${skill}: ${LEVEL_STONES.supply[skill]} for ${LEVEL_STONES.duckCount} ducklings caps the level below its own flock`);
  }
});

test('The Stepping Stones loses one to the goose unless a duckling is given a Jumper', () => {
  // And the same Jumper carries that duckling over the notch later — nothing
  // in this game spends a trait but a Digger, which is what makes the trick
  // free rather than a trade.
  const { state } = playLevel10({ hopGoose: false, freeTurners: true });
  assert.equal(state.saved, LEVEL_STONES.duckCount - 1);
  assert.ok(state.ducks.some(d => d.cause === 'goosed'), 'the goose should have taken one');
});

test('The Stepping Stones wants its two turners stood down in order', () => {
  /* A released Blocker walks back the way it came, so island A's turner sets
     off left — up the ramp to island B and on toward the fatal drop off B's
     left end. The thing that turns it round there is island B's own turner,
     so B's has to be the second click, not a simultaneous one. */
  const { state } = playLevel10({ hopGoose: true, freeTurners: true, inOrder: false });
  assert.equal(state.saved, LEVEL_STONES.duckCount - 1,
    'standing both down together should cost exactly the one that walks off island B');
  assert.ok(state.ducks.some(d => d.cause === 'fell'));
});

test('The Stepping Stones cannot be finished without a Climber', () => {
  // The crag is forty-eight pixels of rock over the top island: too tall for
  // one ramp, too tall to hop, and nothing to tunnel.
  const { state, built } = playLevel10({ climbers: false });
  assert.equal(built, 3, 'the flock still gets up the islands');
  assert.equal(state.saved, 0, 'and then stops at the crag');
  assert.notEqual(state.ended, 'won');
});

test('The Stepping Stones cannot be finished without a Jumper', () => {
  // The notch is three columns of nothing with the shelf level on the far
  // side: no wall to climb, and no ramp left to lay over it.
  const { state } = playLevel10({ jumpers: false });
  assert.equal(state.saved, 0);
  assert.ok(state.ducks.some(d => d.cause === 'fell'), 'they walk into the notch instead');
  assert.notEqual(state.ended, 'won');
});

test('The Stepping Stones has no ramp to spare, which is what makes those two skills skills', () => {
  /* A Builder answers almost anything given room. A spare one on the top
     island climbs to within a hop of the crag; a spare one on the crag lays
     a deck straight over the notch. Three ramps, three Builders, and every
     one of them needed for the climb itself — so there is nothing left to
     improvise the last two obstacles with. */
  assert.equal(LEVEL_STONES.supply.builder, STONES_PLAN.length);
  for(let n = 0; n < STONES_PLAN.length; n++){
    const { state } = playLevel10({ steps: n });
    assert.equal(state.saved, 0, `${n} of three ramps should save nobody`);
  }
});

test('The Stepping Stones cannot be climbed without the Blockers that turn the flock', () => {
  const { state, built } = playLevel10({ turns: false });
  assert.ok(built <= 1, 'nothing past the first island can even be built');
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('The Stepping Stones leaves the flock safe on the ground and nowhere else', () => {
  // Doing nothing at all costs at most the one the goose takes: the pen has
  // a rock wall at each end, so there is no edge to walk off down there.
  const state = newGame(LEVEL_STONES);
  for(let i = 0; i < LEVEL_STONES.timeLimit && !state.ended; i++) tick(state);
  assert.ok(state.lost <= 1, `the pen should not be killing anybody, lost ${state.lost}`);
  assert.ok(state.rock[5] && state.rock[205], 'both walls are rock');
  // And the first island is a forgiving mistake, the rest are not.
  const [a, b, c] = LEVEL_STONES.islands;
  assert.equal(150 - a.y, FALL_SAFE, 'falling off island A lands in the pen unhurt');
  for(const isle of [b, c]){
    assert.ok(150 - isle.y > FALL_SAFE, `falling off the island at ${isle.y} is fatal`);
  }
});

test('The Stepping Stones puts the crag out of the pen\'s reach', () => {
  /* The chasm between the pen's right-hand wall and the crag is the whole
     reason the climb cannot be skipped: give it walkable ground and a
     Climber would go straight up the crag from the pen floor. */
  const terrain = buildTerrain(LEVEL_STONES.segments, LEVEL_STONES.width);
  for(let x = 212; x < 230; x++){
    assert.ok(terrain[x] >= SCENE_H, `column ${x} between pen and crag should be open air`);
  }
  const [, , top] = LEVEL_STONES.islands;
  assert.equal(top.to, 230, 'the top island is the only thing that reaches the crag');
  assert.ok(top.y - terrain[230] > BUILD_RISE_HEIGHT,
    'and the crag stands taller over it than any one ramp climbs');
  assert.ok(LEVEL_STONES.goalX > 249 && terrain[LEVEL_STONES.goalX] < SCENE_H,
    'the pond is on the shelf past the notch');
});

/* ------------------------------------------------- The Belfry, played */

/* Four floors, staggered, so the flock arrives at the end of each one going
   the wrong way for the next: a Blocker turns it, and the ramp after that
   is built in the other direction. The two turning Blockers stay planted —
   they are the route. */
const BELFRY_PLAN = [
  { y: 150, at: 40, dir: 1 },                  // pen -> A, left to right
  { y: 126, at: 100, dir: -1, turn: 115 },     // A -> B, right to left
  { y: 102, at: 30, dir: 1, turn: 22 },        // B -> C: climb, left to right
  { y: 78, at: 63, dir: 1 },                   //    ... level
  { y: 78, at: 96, dir: 1 },                   //    ... climb, onto C
];

function playLevel11({ steps = BELFRY_PLAN.length, turns = true } = {}){
  const state = newGame(LEVEL_BELFRY);
  let stage = 0, held = null;
  const kinds = [], dirs = [];
  for(let i = 0; i < LEVEL_BELFRY.timeLimit && !state.ended; i++){
    const move = stage < steps ? BELFRY_PLAN[stage] : null;
    if(move){
      if(turns && move.turn != null && !held){
        const d = state.ducks.find(k => k.state === 'walking'
          && Math.round(k.x) === move.turn && k.y === move.y);
        if(d && assignSkill(state, d.id, 'blocker')) held = d;
      }
      if(!move.turn || !turns || held){
        const d = state.ducks.find(k => k.state === 'walking'
          && Math.round(k.x) === move.at && k.y === move.y && k.dir === move.dir);
        if(d && assignSkill(state, d.id, 'builder')){
          kinds.push(d.buildLevel ? 'level' : 'climb');
          dirs.push(d.dir);
          stage++;
          held = null;
        }
      }
    }
    tick(state);
  }
  return { state, built: stage, kinds, dirs };
}

test('The Belfry can be won by switchbacking up its floors', () => {
  const { state, built, kinds, dirs } = playLevel11();
  assert.equal(built, 5, 'all five ramps should have gone in');
  assert.deepEqual(kinds, ['climb', 'climb', 'climb', 'level', 'climb'],
    'three single ramps, then the climb-level-climb staircase');
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_BELFRY), `only ${state.saved} saved, needed ${winCount(LEVEL_BELFRY)}`);
});

test('The Belfry is built both ways round — a ramp each direction is unavoidable', () => {
  const { dirs } = playLevel11();
  assert.ok(dirs.includes(1), 'something has to be built left to right');
  assert.ok(dirs.includes(-1), 'and something right to left');
});

test('The Belfry cannot be climbed without the Blockers that turn the flock', () => {
  const { state, built } = playLevel11({ turns: false });
  assert.ok(built <= 1, 'nothing past the first floor can even be built');
  assert.equal(state.saved, 0);
  assert.notEqual(state.ended, 'won');
});

test('every one of The Belfry\'s five ramps is load-bearing', () => {
  for(let n = 1; n < BELFRY_PLAN.length; n++){
    const { state } = playLevel11({ steps: n });
    assert.equal(state.saved, 0, `${n} of five ramps should save nobody`);
    assert.notEqual(state.ended, 'won');
  }
});

test('The Belfry crosses its chasm by teleporter and by nothing else', () => {
  const { state } = playLevel11();
  assert.ok(state.warps >= state.saved, 'everything saved went through the pads');

  // The gap really is past anything that could be built across it: from
  // the end of floor C to the start of floor D there is nothing at all a
  // duckling could stand on, and it is wider than a ramp is long.
  const [, , c, d] = LEVEL_BELFRY.islands;
  const gap = d.from - c.to;
  assert.ok(gap > BUILD_MAX_STEPS, `the chasm is ${gap} columns and a ramp reaches ${BUILD_MAX_STEPS}`);
  const terrain = buildTerrain(LEVEL_BELFRY.segments, LEVEL_BELFRY.width);
  for(let x = c.to; x < d.from; x++){
    assert.ok(terrain[x] >= SCENE_H, `column ${x} should be open air`);
    assert.ok(!LEVEL_BELFRY.islands.some(i => x >= i.from && x < i.to),
      `and no floor should stand in it at ${x}`);
  }
  // And the pads are at the two lips of it.
  const [pad] = LEVEL_BELFRY.teleports;
  assert.ok(pad.ax < c.to && pad.ax >= c.from, 'the near pad stands on floor C');
  assert.ok(pad.bx >= d.from && pad.bx < d.to, 'the far pad stands on floor D');
});

test('The Belfry supplies no Digger, and has nothing one could be spent on', () => {
  assert.equal(LEVEL_BELFRY.supply.digger, 0);
  const state = newGame(LEVEL_BELFRY);
  // Every wall on the level is the pen's own rock, which refuses a tunnel.
  const terrain = state.terrain;
  for(let x = 1; x < LEVEL_BELFRY.width; x++){
    const rise = terrain[x - 1] - terrain[x];
    if(rise > WALK_STEP && terrain[x] < SCENE_H){
      assert.ok(state.rock[x], `the wall at ${x} should be rock, not something to tunnel`);
    }
  }
});

test('The Belfry stacks its floors clear of each other, with the pond on the top one', () => {
  const [a, b, c, d] = LEVEL_BELFRY.islands;
  // Each floor is one ramp's climb above the last.
  assert.equal(150 - a.y, BUILD_RISE_HEIGHT);
  assert.equal(a.y - b.y, BUILD_RISE_HEIGHT);
  assert.equal(b.y - c.y, 2 * BUILD_RISE_HEIGHT, 'B to C is the double climb');
  // And staggered, so each is reached walking the other way.
  assert.ok(b.from < a.from, 'B lies back to the left of A');
  assert.ok(c.to > b.to, 'C lies back to the right of B');
  // Headroom: nothing walks along one floor with another in its face.
  for(const [over, under] of [[b, a], [c, b]]){
    assert.ok(under.y - over.floor > WALK_STEP, 'a floor wants air over the one below it');
  }
  assert.ok(LEVEL_BELFRY.goalX > d.from && LEVEL_BELFRY.goalX < d.to, 'the pond is the end of floor D');
});

/* ------------------------------------------- when a run is over, and why */

/* A level whose hatch is four ducklings on flat ground, all of which walk
   into the pond on their own. The quota is half of them, so there is a long
   stretch of the run where the goal is already met and ducklings are still
   walking — which is exactly the window this group is about. */
const strollLevel = (overrides = {}) => miniLevel({
  duckCount: 4, spawnInterval: 12, winRatio: 0.5, timeLimit: 600, ...overrides,
});

test('reaching the quota does not end the run', () => {
  const state = newGame(strollLevel());
  const need = winCount(state.level);
  for(let i = 0; i < 600 && state.saved < need; i++) tick(state);
  assert.ok(state.saved >= need, 'the quota should have been met');
  assert.equal(state.ended, null, 'and the run should still be going');
  assert.ok(state.ducks.some(d => d.state !== 'saved' && d.state !== 'lost'),
    'because there are still ducklings out there');
});

test('a run ends once every duckling is in the pond or gone, and counts them all', () => {
  const level = strollLevel();
  const state = newGame(level);
  run(state, 600);
  assert.equal(state.ended, 'won');
  assert.equal(state.saved, level.duckCount,
    'every duckling that got home is counted, not just the quota');
  assert.ok(state.ticks < level.timeLimit, 'and it did not have to wait out the clock');
});

test('a duckling still standing holds the run open until the clock', () => {
  // A planted Blocker is neither saved nor lost, and the run is not over
  // while it is standing there — the flock behind it may still be let past.
  const level = strollLevel({ supply: { digger: 0, builder: 0, blocker: 1, climber: 0, flyer: 0 } });
  const state = newGame(level);
  tick(state);
  const first = state.ducks[0];
  assert.ok(assignSkill(state, first.id, 'blocker'));
  run(state, level.timeLimit + 5);
  assert.equal(first.state, 'blocking', 'it is still there');
  assert.ok(state.ticks >= level.timeLimit, 'so the clock is what ended it');
});

test('the hatched count is the flock, and a finished run has hatched all of it', () => {
  /* What the HUD's "Hatched X / N" reads off. Two things have to hold for it
     to mean anything: the number must be exactly how many ducklings exist,
     every tick, and a run that plays out must actually reach the whole
     hatch. The second one is what the quota used to break — it ended the
     run the moment the goal was met, which froze this counter partway
     through the flock and made it look like it was lagging. */
  const level = strollLevel();
  const state = newGame(level);
  for(let i = 0; i < level.timeLimit && !state.ended; i++){
    tick(state);
    assert.equal(state.hatched, state.ducks.length,
      `hatched drifted from the flock at tick ${state.ticks}`);
    assert.ok(state.hatched <= level.duckCount, 'and never runs past the hatch');
  }
  assert.equal(state.ended, 'won');
  assert.equal(state.hatched, level.duckCount, 'the whole flock should have hatched');
  assert.equal(state.saved + state.lost, level.duckCount, 'and all of it accounted for');
});

test('endRun stops a run by hand and judges it exactly as the clock would', () => {
  const level = strollLevel();
  const state = newGame(level);
  for(let i = 0; i < 600 && state.saved < winCount(level); i++) tick(state);
  assert.equal(state.ended, null);
  assert.equal(endRun(state), 'won', 'the quota is met, so stopping here is a win');
  assert.equal(state.ended, 'won');
  assert.ok(state.ticks < level.timeLimit);
});

test('endRun on a run that has saved too few is a loss, not an escape', () => {
  const state = newGame(strollLevel());
  tick(state);
  assert.equal(state.saved, 0);
  assert.equal(endRun(state), 'lost');
  assert.equal(state.ended, 'lost');
});

test('endRun leaves an already-finished run alone', () => {
  const state = newGame(strollLevel());
  run(state, 600);
  assert.equal(state.ended, 'won');
  assert.equal(endRun(state), null, 'nothing to end');
  assert.equal(state.ended, 'won', 'and the verdict it already had stands');
});

test('a run out of time is judged on what got home by then', () => {
  const state = newGame(strollLevel({ timeLimit: 30 }));
  run(state, 60);
  assert.equal(state.ended, 'lost');
  assert.equal(state.ticks, 30);
});

/* ------------------------------------------------- The Errand, played */

/* One duckling does the whole level and the rest stand still for it. The
   Blocker holds the hatch off the chasm, the Climber picks the one that
   leaves, and that one spends the Digger and the Builder on its way round
   and back. Then the Blocker comes off. */
function playLevel12({ blockAt = 90, buildAt = 55, release = true, skip = null } = {}){
  const state = newGame(LEVEL_ERRAND);
  let blocker = null, errand = null, built = false, released = false, warpsAtBridge = null;

  for(let i = 0; i < LEVEL_ERRAND.timeLimit && !state.ended; i++){
    if(!blocker && skip !== 'blocker'){
      const d = state.ducks.find(k => k.state === 'walking' && Math.round(k.x) === blockAt);
      if(d && assignSkill(state, d.id, 'blocker')) blocker = d;
    }
    // The one that goes. Anything walking right in the pen will do — the
    // Climber is what makes it the only one that can leave.
    if(blocker && !errand && skip !== 'climber'){
      const d = state.ducks.find(k => k.state === 'walking' && k.dir === 1
        && k.id !== blocker.id && k.x > 100 && k.x < 149);
      if(d && assignSkill(state, d.id, 'climber')) errand = d;
    }
    // The hill, at the height the high shelf runs at.
    if(errand && !hasTrait(errand, 'digger') && skip !== 'digger'
       && errand.state === 'walking' && errand.y === 56 && errand.x > 160 && errand.x < 189){
      assignSkill(state, errand.id, 'digger');
    }
    // And the bridge, once the pad has put it back on the far shelf.
    if(errand && !built && skip !== 'builder' && errand.state === 'walking'
       && errand.y === 144 && Math.round(errand.x) === buildAt){
      if(assignSkill(state, errand.id, 'builder')){ built = true; warpsAtBridge = state.warps; }
    }
    if(built && release && !released && errand.state === 'walking'){
      if(releaseBlocker(state, blocker.id)) released = true;
    }
    tick(state);
  }
  return { state, built, released, errand, warpsAtBridge };
}

test('The Errand can be won by sending one duckling the long way round', () => {
  const { state, built, warpsAtBridge } = playLevel12();
  assert.ok(built, 'the bridge should have gone in');
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_ERRAND), `only ${state.saved} saved, needed ${winCount(LEVEL_ERRAND)}`);
  // One duckling runs the errand: when the bridge goes in, the pad has
  // carried exactly that one. (It is free to wander its own route again
  // afterwards, which is why this is read at the bridge and not at the end.)
  assert.equal(warpsAtBridge, 1, 'exactly one duckling had taken the pad by then');
});

test('The Errand spends one of each of the three skills it is built around', () => {
  assert.equal(LEVEL_ERRAND.supply.climber, 1);
  assert.equal(LEVEL_ERRAND.supply.digger, 1);
  assert.equal(LEVEL_ERRAND.supply.builder, 1);
  for(const skill of ['climber', 'digger', 'builder']){
    const { state } = playLevel12({ skip: skill });
    assert.equal(state.saved, 0, `without the ${skill} nothing should get home`);
    assert.notEqual(state.ended, 'won');
  }
});

test('The Errand drowns the whole hatch without a Blocker', () => {
  const { state } = playLevel12({ skip: 'blocker' });
  assert.equal(state.saved, 0);
  assert.equal(state.lost, LEVEL_ERRAND.duckCount, 'every one of them walks into the chasm');
});

test('The Errand needs the Blocker taken off again, not just planted', () => {
  const { state } = playLevel12({ release: false });
  assert.notEqual(state.ended, 'won');
  assert.ok(state.saved <= 1, 'only the duckling that ran the errand ever gets home');
});

test('The Errand\'s Blocker has to stand between the nest and the chasm', () => {
  // Planted the other side of the nest it turns the hatch towards the drop
  // instead of away from it, which is the way this level is really lost.
  for(const at of [82, 90]){
    assert.equal(playLevel12({ blockAt: at }).state.ended, 'won', `a Blocker at ${at} should hold`);
  }
  for(const at of [101, 120]){
    const { state } = playLevel12({ blockAt: at });
    assert.notEqual(state.ended, 'won', `a Blocker at ${at} is the wrong side of the nest`);
  }
});

test('The Errand\'s bridge has to be started late enough to reach the far lip', () => {
  const [, chasm] = LEVEL_ERRAND.segments;
  const reachesFrom = chasm.to - 1 - BUILD_MAX_STEPS;   // the earliest column that still lands
  for(const at of [30, 40, 45]){
    assert.ok(at < reachesFrom, `x=${at} should be too early to span the chasm`);
    const { state } = playLevel12({ buildAt: at });
    assert.notEqual(state.ended, 'won', `a ramp from ${at} stops in mid-air`);
  }
  for(const at of [46, 55, 69]){
    assert.ok(at >= reachesFrom);
    assert.equal(playLevel12({ buildAt: at }).state.ended, 'won', `a ramp from ${at} should land`);
  }
});

test('The Errand\'s tower is rock and its hill is not — one climb, one tunnel', () => {
  const state = newGame(LEVEL_ERRAND);
  // The way out of the pen: rock, so a Digger will not touch it, and taller
  // than any ramp climbs, so a Builder is no use on it either.
  for(let x = 150; x < 158; x++) assert.ok(state.rock[x], `the tower at ${x} should be rock`);
  assert.ok(120 - state.terrain[150] > BUILD_RISE_HEIGHT, 'and taller than a ramp reaches');
  // The hill: dirt, and thin enough that one tunnel breaks through it.
  for(let x = 190; x < 218; x++) assert.ok(!state.rock[x], `the hill at ${x} should be diggable`);
  assert.ok(218 - 190 < DIG_MAX_STEPS, 'and one Digger should reach the far side of it');
});

test('The Errand punishes climbing the hill instead of digging through it', () => {
  // A Climber still holds the trait at the hill, and stepWalking offers
  // climbing to anything that cannot dig — so going over the top has to be
  // the wrong answer, and it is: the drop off the far side is lethal.
  const state = newGame(LEVEL_ERRAND);
  const drop = state.terrain[218] - state.terrain[217];
  assert.ok(drop > FALL_SAFE, `the far side of the hilltop is ${drop}, which should be fatal`);

  const { state: climbed } = playLevel12({ skip: 'digger' });
  assert.equal(climbed.saved, 0, 'and the errand is lost with the duckling that walked off it');
});

test('The Errand\'s perch keeps the pad clear of the flock walking home', () => {
  const [perch] = LEVEL_ERRAND.islands;
  const [pad] = LEVEL_ERRAND.teleports;
  assert.ok(pad.bx >= perch.from && pad.bx < perch.to, 'the far pad stands on the perch');
  const shelf = LEVEL_ERRAND.segments[0].y;
  assert.ok(shelf - pad.by > WALK_STEP,
    'and high enough over the shelf that a duckling walking under it is not posted back');
  assert.ok(perch.to > LEVEL_ERRAND.goalX, 'the perch sits past the water, not over it');
});

test('formatTime reads as minutes:seconds', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(TICK_RATE * 65), '1:05');
});


/* ------------------------------------------- what the pages claim about it */

/* Counts written by hand go stale. The shelf's card advertised ten levels
 * for the whole time the game had eleven and then twelve, and the game's own
 * facts line had already drifted twice. Both are read off the level list at
 * runtime now, and these hold the fallback text in the markup to the same
 * standard — a literal that is wrong is still wrong on the first paint, and
 * on any browser that never runs the script.
 */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty'];
const page = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('the shelf says how many levels the game actually has', () => {
  const shelf = page('../public/index.html');
  const tag = shelf.match(/<li[^>]*id="dq-levels"[^>]*>([^<]*)<\/li>/);
  assert.ok(tag, 'the shelf should carry the tag the count is written into');
  assert.equal(tag[1].trim().toLowerCase(), `${WORDS[LEVELS.length]} levels`);
  assert.match(shelf, /LEVELS as DQ_LEVELS/, 'and should count them rather than trust the literal');
});

test('the game\'s own facts line counts its levels and skills', () => {
  const front = page('../public/duck-duck-quack/index.html');
  const tag = front.match(/<li[^>]*id="counts"[^>]*>([^<]*)<\/li>/);
  assert.ok(tag, 'the facts list should carry the tag the counts are written into');
  assert.equal(tag[1].trim().toLowerCase(),
    `${WORDS[LEVELS.length]} levels, ${WORDS[SKILLS.length]} skills`);
});
