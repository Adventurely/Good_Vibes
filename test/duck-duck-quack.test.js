/* Duck Duck Quack — the rules, and whether the one level here can be won.
 *
 * Each mechanic gets its own tiny level rather than sharing LEVEL_1, so a
 * test failure points at the one rule that broke instead of at "something in
 * the park". The last test plays a whole run of LEVEL_1 with a simple bot and
 * checks it actually clears the win quota — the same reason Sunward keeps a
 * balance harness: a level's failure mode is not a crash, it is a shape
 * nobody can actually win, and that does not show up until somebody tries.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCENE_W, SCENE_H, WALK_STEP, FALL_SAFE, FALL_SPEED, FLY_SPEED, TICK_RATE, BUILD_SECONDS,
  BUILD_MAX_STEPS, BUILD_RISE_HEIGHT, DIG_SECONDS, DIG_MAX_STEPS, JUMP_SPAN, JUMP_RISE, PIT_Y,
  SKILLS, SKILL_INFO, LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5, LEVEL_6, LEVEL_7, LEVEL_8, LEVELS,
  buildTerrain, buildLayer, stairs, winCount, goalHeading, formatTime,
} from '../public/duck-duck-quack/content.js';

import {
  newGame, tick, assignSkill, assignRefusal, releaseBlocker, duckNear, hasTrait,
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

test('LEVEL_1 carries a supply for every skill and is registered', () => {
  for(const skill of SKILLS) assert.ok(LEVEL_1.supply[skill] >= 0, `no supply for "${skill}"`);
  assert.ok(LEVELS.includes(LEVEL_1));
  assert.ok(LEVEL_1.nestX >= 0 && LEVEL_1.nestX < LEVEL_1.goalX);
  assert.ok(LEVEL_1.goalX < LEVEL_1.width);
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

test('walking off either end of the level is lost, not a crash', () => {
  const level = miniLevel({ nestX: 1 });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  duck.dir = -1; // send it toward the near edge instead of the goal
  run(state, 10);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'edge');
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
   * see LEVEL_1. The first Builder decides how high the ramp goes; every one
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

test('a planted blocker can be stood down, and walks on the way it was facing', () => {
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
  assert.equal(duck.dir, facing, 'it carries on the way it was going');
  run(state, 10);
  assert.ok(duck.x > plantedAt, 'and actually moves');

  // It reaches the pond like any other duckling — a Blocker is no longer a
  // duckling written off.
  run(state, 400);
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
  const state = newGame(LEVEL_1);
  let builderUsed = false, extended = false;
  for(let i = 0; i < LEVEL_1.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      // The Park's gap is wider than one ramp reaches (see LEVEL_1's note):
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
  assert.ok(state.saved >= winCount(LEVEL_1), `only ${state.saved} saved, needed ${winCount(LEVEL_1)}`);
});

/* ------------------------------------------------------------- The Warren, played */

/* A greedy bot for The Warren: bridge the one gap, dig through each wall
 * the first chance it appears. No Climber or Flyer to reach for — this
 * level supplies neither, on purpose (see content.js), so a bot that only
 * knows Builder and Digger should still be enough to clear it.
 */
function playLevel2(){
  const state = newGame(LEVEL_2);
  let builderUsed = false, digger1Used = false, digger2Used = false;
  for(let i = 0; i < LEVEL_2.timeLimit && !state.ended; i++){
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
  assert.ok(state.saved >= winCount(LEVEL_2), `only ${state.saved} saved, needed ${winCount(LEVEL_2)}`);
});

test('The Warren cannot be won without a Digger — neither wall has any other way through', () => {
  // The level supplies zero Climber and zero Flyer (see content.js), so
  // this is really checking that the level design itself, not just the
  // bot, actually forces the issue: bridging the gap alone is not enough.
  const state = newGame(LEVEL_2);
  let builderUsed = false;
  for(let i = 0; i < LEVEL_2.timeLimit && !state.ended; i++){
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

/* A bot for The Orchard that climbs the wall rather than digging it — the
 * level supplies both, and this is the one way to check Climber genuinely
 * still works there too, not just the Digger path the other helpers below
 * exercise. Flyer and Climber are both given at hatch rather than at any
 * particular column: this level is walked heading -1 (content.js's
 * goalHeading), so "given early" means given anywhere on the flat run out
 * of the nest, long before either the wall or its own real drop on the far
 * side. No Blocker here on purpose — see the "no blocker at all" case
 * below for why the goose alone never costs this bot more than one
 * duckling, the same as it would with one planted.
 */
function playLevel3Climbing(){
  const state = newGame(LEVEL_3);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_3.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'climber')) assignSkill(state, d.id, 'climber');
      if(!hasTrait(d, 'flyer')) assignSkill(state, d.id, 'flyer');
      if(!builder1Used && d.x === 250){ if(assignSkill(state, d.id, 'builder')) builder1Used = true; continue; }
      if(!builder2Used && d.x === 35){ if(assignSkill(state, d.id, 'builder')) builder2Used = true; continue; }
    }
    tick(state);
  }
  return state;
}

test('The Orchard can be won by climbing the wall instead of digging it', () => {
  const state = playLevel3Climbing();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_3), `only ${state.saved} saved, needed ${winCount(LEVEL_3)}`);
});

/* And the Digger path, for the same reason The Park keeps its "at the
 * edge" bot honest: a digger given anywhere before the wall should tunnel
 * it for the whole flock, needing no Climber at all. */
function playLevel3Digging(){
  const state = newGame(LEVEL_3);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_3.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'digger')) assignSkill(state, d.id, 'digger');
      if(!hasTrait(d, 'flyer')) assignSkill(state, d.id, 'flyer');
      if(!builder1Used && d.x === 250){ if(assignSkill(state, d.id, 'builder')) builder1Used = true; continue; }
      if(!builder2Used && d.x === 35){ if(assignSkill(state, d.id, 'builder')) builder2Used = true; continue; }
    }
    tick(state);
  }
  return state;
}

test('The Orchard can also be won by digging the wall instead of climbing it', () => {
  const state = playLevel3Digging();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_3), `only ${state.saved} saved, needed ${winCount(LEVEL_3)}`);
});

test('The Orchard cannot be won without a Builder — neither gap has any other answer', () => {
  const state = newGame(LEVEL_3);
  for(let i = 0; i < LEVEL_3.timeLimit && !state.ended; i++){
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
  const state = newGame(LEVEL_3);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_3.timeLimit && !state.ended; i++){
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
  assert.equal(goalHeading(LEVEL_3), -1);
  const state = newGame(LEVEL_3);
  tick(state);
  assert.equal(state.ducks[0].dir, -1);
});

test('a blocker planted near The Orchard\'s nest turns the goose back for good but strands the flock behind it', () => {
  const state = newGame(LEVEL_3);
  let builder1Used = false, builder2Used = false, blockerUsed = false;
  for(let i = 0; i < LEVEL_3.timeLimit && !state.ended; i++){
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
  const state = newGame(LEVEL_4);
  let gapBuilder = false, wallRamp = false, diggerUsed = false;
  for(let i = 0; i < LEVEL_4.timeLimit && !state.ended; i++){
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
  assert.ok(state.saved >= winCount(LEVEL_4), `only ${state.saved} saved, needed ${winCount(LEVEL_4)}`);
  // The tunnel is up in the dirt, not down at the ground the flock started on.
  const cut = state.tunnelY.findIndex(v => v != null);
  assert.ok(cut > 0, 'a tunnel should have been cut at all');
  assert.ok(state.tunnelY[cut] <= 140, `the tunnel should be above the rock seam, got ${state.tunnelY[cut]}`);
});

test('The Grove cannot be won without a Digger — the wall still has no other way through', () => {
  const state = newGame(LEVEL_4);
  let gapBuilder = false, wallRamp = false;
  for(let i = 0; i < LEVEL_4.timeLimit && !state.ended; i++){
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
   * not one column is ever cut. See LEVEL_4's note and content.js's
   * `hardBelow`.
   */
  const state = newGame(LEVEL_4);
  let gapBuilder = false;
  for(let i = 0; i < LEVEL_4.timeLimit && !state.ended; i++){
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
  const state = newGame(LEVEL_5);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_5.timeLimit && !state.ended; i++){
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
  assert.ok(state.saved >= winCount(LEVEL_5), `only ${state.saved} saved, needed ${winCount(LEVEL_5)}`);
});

test('The Aerie cannot be won with Digger alone — the rock refuses it', () => {
  // Same bot as above, Climber swapped for Digger: both gaps get bridged
  // perfectly and nothing ever gets past the rock.
  const state = newGame(LEVEL_5);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_5.timeLimit && !state.ended; i++){
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
  const state = newGame(LEVEL_5);
  for(let i = 0; i < LEVEL_5.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!hasTrait(d, 'climber') && d.x >= 100 && d.x < 120) assignSkill(state, d.id, 'climber');
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past the first gap without a Builder');
  assert.notEqual(state.ended, 'won');
});

/* The Spire: one bridge over the gap, then one Digger through the spire's
 * face. `digAt` is where that Digger goes — anywhere on the approach will
 * do, which is the point of a held trait — and `climbAt`, when it is set,
 * sends ducklings over the top instead, a Climber up the face and a Flyer
 * for the drop off the ledge.
 */
function playLevel6({ digAt = 80, climbAt = null, rampAt = null } = {}){
  const state = newGame(LEVEL_6);
  let gapBuilder = false, faceRamp = false, dug = false;
  for(let i = 0; i < LEVEL_6.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!gapBuilder && d.x === 39){ if(assignSkill(state, d.id, 'builder')) gapBuilder = true; continue; }
      if(rampAt !== null && gapBuilder && !faceRamp && d.x === rampAt){
        if(assignSkill(state, d.id, 'builder')) faceRamp = true;
        continue;
      }
      if(digAt !== null && !dug && d.x === digAt && d.dir > 0){
        if(assignSkill(state, d.id, 'digger')) dug = true;
        continue;
      }
      if(climbAt !== null && d.x === climbAt && d.dir > 0){
        if(assignSkill(state, d.id, 'climber')) assignSkill(state, d.id, 'flyer');
        continue;
      }
    }
    tick(state);
  }
  return state;
}

test('The Spire can be won by tunnelling its face, with no Climber or Flyer at all', () => {
  const state = playLevel6();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_6), `only ${state.saved} saved, needed ${winCount(LEVEL_6)}`);
  const cut = state.tunnelY.filter(v => v != null).length;
  assert.equal(cut, 30, `the spire is thirty columns thick, got a tunnel of ${cut}`);
  assert.ok(cut <= DIG_MAX_STEPS, 'and inside what one Digger reaches');
});

test('The Spire\'s Digger can be handed out anywhere on the approach', () => {
  for(const digAt of [66, 80, 100, 119]){
    const state = playLevel6({ digAt });
    assert.equal(state.ended, 'won', `a Digger given at ${digAt} should still win`);
  }
});

test('The Spire cannot be won without a Digger — the face is the only way through', () => {
  const state = playLevel6({ digAt: null });
  assert.equal(state.saved, 0, 'nothing gets past the face without a tunnel');
  assert.notEqual(state.ended, 'won');
});

test('The Spire cannot be won over the top — three Climbers and three Flyers is a scenic route, not a solution', () => {
  const state = playLevel6({ digAt: null, climbAt: 100 });
  assert.ok(state.saved <= 3, `only the three that can climb and fly get over, got ${state.saved}`);
  assert.ok(state.saved < winCount(LEVEL_6));
  assert.notEqual(state.ended, 'won');
});

test('The Spire\'s face stands higher than any ramp can reach, so a stray Builder cannot commit the flock', () => {
  const terrain = buildTerrain(LEVEL_6.segments);
  assert.equal(terrain[119] - terrain[120], 40, 'the face should be forty pixels');
  assert.ok(terrain[119] - terrain[120] > BUILD_RISE_HEIGHT,
    'a ramp must not be able to join the top of the face');
  // And played: a ramp laid at the face costs a Builder and nothing else.
  const state = playLevel6({ rampAt: 90 });
  assert.equal(state.ended, 'won', 'the tunnel still carries the level');
});

test('The Spire\'s stairs never turn a duckling back — every tread is a step, not a wall', () => {
  const state = newGame(LEVEL_6);
  let gapBuilder = false;
  const dirAtStairs = new Map();
  let turnedBack = 0;
  for(let i = 0; i < LEVEL_6.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!gapBuilder && d.x === 39){ if(assignSkill(state, d.id, 'builder')) gapBuilder = true; continue; }
      if(d.x === 100 && d.dir > 0){
        if(assignSkill(state, d.id, 'climber')) assignSkill(state, d.id, 'flyer');
        continue;
      }
      // x=120 is the face itself, which is a wall; the treads start above it.
      if(d.x > 120 && d.x < 141 && d.y < 110){
        const prev = dirAtStairs.get(d.id);
        if(prev !== undefined && prev !== d.dir) turnedBack++;
        dirAtStairs.set(d.id, d.dir);
      }
    }
    tick(state);
  }
  assert.ok(dirAtStairs.size > 0, 'someone should have got onto the stairs at all');
  assert.equal(turnedBack, 0, 'nothing should ever turn back on the stairs themselves');
});

test('a blocker planted on The Spire\'s ledge turns a wingless duckling back rather than saving it', () => {
  const state = newGame(LEVEL_6);
  let gapBuilder = false, blockerUsed = false;
  for(let i = 0; i < LEVEL_6.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!gapBuilder && d.x === 39){ if(assignSkill(state, d.id, 'builder')) gapBuilder = true; continue; }
      if(d.x === 100 && d.dir > 0){ assignSkill(state, d.id, 'climber'); continue; }
      // On the ledge itself — the column above the tunnel's far end, not in it.
      if(!blockerUsed && d.x === 149 && d.y <= 30){
        if(assignSkill(state, d.id, 'blocker')) blockerUsed = true;
        continue;
      }
    }
    tick(state);
  }
  assert.ok(blockerUsed, 'a climber should have reached the ledge to plant one');
  assert.equal(state.saved, 0, 'a blocker turns ducklings back, it does not fly them down');
  assert.ok(state.ducks.some(d => d.state === 'blocking'), 'the blocker itself should still be standing there');
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

test('a jumper hops the goose instead of being caught, and the hunt carries on', () => {
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
  // Nothing was caught, so the goose has not been fed off — see stepWalking.
  assert.equal(hopped.state.goose.fed, false);
});

/* ------------------------------------------------------- The Hedgerow, played */

/* Give every duckling its own Jumper, and the one Builder at the lip of the
 * one gap. Both halves are switchable, because what this level is for is
 * that neither half alone is any use at all.
 */
function playLevel8({ jumpers = true, builder = true } = {}){
  const state = newGame(LEVEL_8);
  let built = false;
  for(let i = 0; i < LEVEL_8.timeLimit && !state.ended; i++){
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
  assert.ok(state.saved >= winCount(LEVEL_8), `only ${state.saved} saved, needed ${winCount(LEVEL_8)}`);
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
    assert.equal(LEVEL_8.supply[skill], 0, `The Hedgerow should supply no ${skill}`);
  }
});

/* ------------------------------------------------------------- The Falls, played */

/* A bot for The Falls: two bridges, a Flyer given at hatch (it answers all
 * three drops off the one assignment, the level's whole point), and
 * either Climber or Digger for the one wall partway down.
 */
function playLevel7(useDigger){
  const state = newGame(LEVEL_7);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_7.timeLimit && !state.ended; i++){
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
  assert.ok(state.saved >= winCount(LEVEL_7), `only ${state.saved} saved, needed ${winCount(LEVEL_7)}`);
});

test('The Falls can also be won by digging the one wall instead of climbing it', () => {
  const state = playLevel7(true);
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_7), `only ${state.saved} saved, needed ${winCount(LEVEL_7)}`);
});

test('The Falls cannot be won without a Flyer — two of its three drops are real', () => {
  const state = newGame(LEVEL_7);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_7.timeLimit && !state.ended; i++){
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
  const state = newGame(LEVEL_7);
  let builder1Used = false, builder2Used = false;
  for(let i = 0; i < LEVEL_7.timeLimit && !state.ended; i++){
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
  const state = newGame(LEVEL_7);
  for(let i = 0; i < LEVEL_7.timeLimit && !state.ended; i++){
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
  assert.equal(goalHeading(LEVEL_7), -1);
  assert.ok(LEVEL_7.nestX > LEVEL_7.goalX);
  const nestY = buildTerrain(LEVEL_7.segments, LEVEL_7.width)[LEVEL_7.nestX];
  const goalY = buildTerrain(LEVEL_7.segments, LEVEL_7.width)[LEVEL_7.goalX];
  assert.ok(goalY > nestY, 'the pond should sit lower (larger y) than the nest');
});

test('formatTime reads as minutes:seconds', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(TICK_RATE * 65), '1:05');
});
