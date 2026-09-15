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
  SCENE_W, SCENE_H, WALK_STEP, FALL_SAFE, DIG_RATE, TICK_RATE,
  SKILLS, SKILL_INFO, LEVEL_1, LEVELS, buildTerrain, winCount, formatTime,
} from '../public/duck-duck-quack/content.js';

import { newGame, tick, assignSkill, assignRefusal, duckNear } from '../public/duck-duck-quack/sim.js';

/* A minimal level for a test that only cares about one mechanic. Every field
   the game reads has a harmless default, so a test only has to say what makes
   it different from flat, empty ground. */
function miniLevel(overrides = {}){
  return {
    id: 'mini', name: 'Mini', width: SCENE_W, height: SCENE_H,
    segments: [{ from: 0, to: SCENE_W, y: 50 }],
    nestX: 2, goalX: SCENE_W - 1,
    duckCount: 1, spawnInterval: 0, timeLimit: 400, winRatio: 1,
    supply: { digger: 0, builder: 0, blocker: 0, climber: 0 },
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

test('winCount rounds up, not down', () => {
  assert.equal(winCount({ duckCount: 10, winRatio: 0.8 }), 8);
  assert.equal(winCount({ duckCount: 9, winRatio: 0.8 }), 8);
});

test('buildTerrain fills only the columns a segment claims', () => {
  const row = buildTerrain([{ from: 2, to: 5, y: 9 }], 6);
  assert.equal(row.length, 6);
  assert.deepEqual([...row].map(v => v ?? null), [null, null, 9, 9, 9, null]);
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

test('a digger carves a forward ramp that clears a lethal drop, permanently', () => {
  const drop = 50 + FALL_SAFE + 20;
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: drop }],
    goalX: 40, supply: { digger: 1, builder: 0, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 9);
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  // Digging is deferred, not instant: the duckling is still just walking
  // until the very next step is the one that would otherwise be a fall.
  assert.equal(duck.state, 'walking');
  tick(state);
  assert.equal(duck.state, 'digging');
  run(state, 200);
  assert.equal(duck.state, 'saved');

  // The column digging started from is untouched — a ramp cut into the
  // columns ahead, not a well dug straight down, which would only have moved
  // the cliff one column earlier instead of removing it.
  assert.equal(state.terrain[9], 50);
  // Every column of the ramp is a small step from the last: no new cliff.
  for(let x = 10; x < 40; x++){
    assert.ok(Math.abs(state.terrain[x] - state.terrain[x - 1]) <= WALK_STEP,
      `columns ${x - 1}->${x} step from ${state.terrain[x - 1]} to ${state.terrain[x]}`);
  }
  assert.equal(state.terrain[39], drop, 'the ramp should have reached the natural depth by the goal');
});

test('a digger given the skill right at the nest still digs the drop three obstacles later', () => {
  // The actual bug this is guarding against: a skill that only worked when
  // clicked on the exact column a hazard started on was, in practice,
  // unusable — nobody can land a tap on one specific column of a moving
  // duckling. Handed out the moment it hatches, long before it can see the
  // drop coming, it still has to work.
  const drop = 50 + FALL_SAFE + 20;
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: drop }],
    goalX: 40, supply: { digger: 1, builder: 0, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.ok(duck.x < 9, 'the duckling should still be well short of the drop');
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  run(state, 200);
  assert.equal(duck.state, 'saved');
});

test('a digger given to a duckling that meets a gap first just falls, rather than digging into it', () => {
  // The other half of the fix: a digger only answers a drop with a real
  // floor below it, never a gap (see content.js's PIT_Y). Without that
  // check, digging forward into a gap would chase a floor that is never
  // there — ramping ever deeper until it happened to meet solid ground on
  // the far side, at whatever depth that left the ramp, which is a new,
  // often worse cliff rather than a fixed one.
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: 500 },  // a gap, not a drop
      { from: 20, to: SCENE_W, y: 50 },
    ],
    goalX: 25, supply: { digger: 1, builder: 0, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'digger'), duck);
  run(state, 60);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
  // And it did not touch the terrain trying.
  for(let x = 10; x < 20; x++) assert.equal(state.terrain[x], 500);
});

/* -------------------------------------------------------------- building */

test('a builder bridges a gap and the bridge is still there for later use', () => {
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: 500 },  // a pit no fall survives
      { from: 20, to: SCENE_W, y: 50 },
    ],
    goalX: 25, supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  tickUntilAt(state, duck, 9); // the pit's edge
  assert.equal(assignSkill(state, duck.id, 'builder'), duck);
  assert.equal(duck.state, 'walking'); // deferred, not instant — see the digger test
  tick(state);
  assert.equal(duck.state, 'building');
  run(state, 40);
  assert.equal(duck.state, 'saved');
  for(let x = 10; x < 20; x++) assert.equal(state.terrain[x], 50, `column ${x} was not bridged`);
});

test('a builder given the skill right at the nest still bridges the gap later', () => {
  const level = miniLevel({
    segments: [
      { from: 0, to: 10, y: 50 },
      { from: 10, to: 20, y: 500 },
      { from: 20, to: SCENE_W, y: 50 },
    ],
    goalX: 25, supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'builder'), duck);
  run(state, 40);
  assert.equal(duck.state, 'saved');
});

test('a builder given to a duckling that meets a real drop first just falls, rather than building over it', () => {
  const drop = 50 + FALL_SAFE + 20;
  const level = miniLevel({
    segments: [{ from: 0, to: 10, y: 50 }, { from: 10, to: SCENE_W, y: drop }],
    goalX: 40, supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'builder'), duck);
  run(state, 60);
  assert.equal(duck.state, 'lost');
  assert.equal(duck.cause, 'fell');
  // No floating bridge left hanging over ground that was already walkable.
  assert.equal(state.terrain[10], drop);
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

/* A greedy bot: bridge the gap and clear the drop the first chance either
 * appears, and give every duckling still unskilled a climber the moment it is
 * close enough to the wall to need one soon. It is not a clever player — it
 * is the simplest policy that should be able to clear this level at all,
 * which is the property this test is actually checking.
 */
function playLevel1(){
  const state = newGame(LEVEL_1);
  let builderUsed = false, diggerUsed = false;
  for(let i = 0; i < LEVEL_1.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 69 && assignSkill(state, d.id, 'builder')) builderUsed = true;
      else if(!diggerUsed && d.x === 219 && assignSkill(state, d.id, 'digger')) diggerUsed = true;
      else if(d.skill !== 'climber' && d.x >= 130 && d.x < 150) assignSkill(state, d.id, 'climber');
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

test('formatTime reads as minutes:seconds', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(TICK_RATE * 65), '1:05');
});
