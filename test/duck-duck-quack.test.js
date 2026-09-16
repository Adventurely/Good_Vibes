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
  BUILD_MAX_STEPS, BUILD_RISE_HEIGHT,
  SKILLS, SKILL_INFO, LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5, LEVEL_6, LEVEL_7, LEVELS,
  buildTerrain, buildLayer, winCount, goalHeading, formatTime,
} from '../public/duck-duck-quack/content.js';

import { newGame, tick, assignSkill, assignRefusal, duckNear, hasTrait } from '../public/duck-duck-quack/sim.js';

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

test('a builder starts on the click and builds the whole ten seconds on flat ground, with nothing there to answer', () => {
  // The heart of it: no gap, no wall, nothing — and it still builds. The
  // click is never the thing that has to be aimed, and a duckling given one
  // always, visibly, starts climbing on the very next tick.
  const level = miniLevel({ supply: { digger: 0, builder: 1, blocker: 0, climber: 0 } });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assert.equal(assignSkill(state, duck.id, 'builder'), duck);
  assert.equal(duck.state, 'building', 'instant — see assignSkill');

  run(state, BUILD_MAX_STEPS);
  assert.equal(duck.buildStep, BUILD_MAX_STEPS, 'the full ten seconds, none of it skipped');
  assert.equal(duck.y, 50 - BUILD_RISE_HEIGHT, 'and the full climb with it');
  assert.equal(duck.state, 'walking', 'then it stops and walks on');

  const laid = state.bridgeY.filter(y => y != null).length;
  assert.equal(laid, BUILD_MAX_STEPS, 'a column of ramp laid every tick of it');

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
  // The pit itself is untouched — see content.js's header note — it is
  // `bridgeY` that carries the ramp, so the gap is still open beneath it.
  for(let x = 10; x < 20; x++){
    assert.equal(state.terrain[x], 500, `column ${x}'s terrain should still be open pit`);
    assert.ok(state.bridgeY[x] != null, `column ${x} should be carrying ramp`);
  }
  run(state, 200);
  assert.equal(duck.state, 'saved', 'it walked over its own ramp and on to the pond');
});

test('a builder stops dead at a wall rather than climbing it, and turns back like anything else would', () => {
  const level = miniLevel({
    segments: [{ from: 0, to: 40, y: 50 }, { from: 40, to: SCENE_W, y: 10 }],  // a 40px wall
    supply: { digger: 0, builder: 1, blocker: 0, climber: 0 },
  });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'builder');
  let ticks = 0;
  while(duck.state === 'building' && ticks < 300){ tick(state); ticks++; }
  assert.ok(ticks < BUILD_MAX_STEPS, 'the wall ended it well short of the ten seconds');
  assert.equal(duck.x, 39, 'left standing on the last column of its own ramp');
  for(let x = 40; x < 45; x++) assert.equal(state.bridgeY[x], null, 'and nothing laid into the wall itself');
  // Getting up a wall is a Climber's job and a Digger's. A Builder holding
  // neither turns back from one exactly as it would without the ramp.
  run(state, 3);
  assert.equal(duck.dir, -1);
});

test('a builder\'s ramp joins a staircase rather than cutting across it, so the flock behind can still walk up', () => {
  /* The Spire in miniature — treads that climb faster than the ramp does.
   * Because the ramp stops where the ground catches up to it, the two meet
   * within a step of each other, and `bridgeY` being shared ground (see
   * sim.js's groundAt) the rest of the flock walks the ramp up onto the
   * stairs and carries on. A ramp that ran on at its own angle instead
   * would leave every duckling behind it stranded.
   */
  const segments = [{ from: 0, to: 40, y: 50 }];
  for(let i = 0; i < 30; i++) segments.push({ from: 40 + i * 2, to: 42 + i * 2, y: 50 - 4 * (i + 1) });
  segments.push({ from: 100, to: SCENE_W, y: -70 });
  const level = miniLevel({ segments, supply: { digger: 0, builder: 1, blocker: 0, climber: 0 } });
  const state = run(newGame(level), 1);
  const duck = state.ducks[0];
  assignSkill(state, duck.id, 'builder');
  while(duck.state === 'building') tick(state);

  const last = state.bridgeY.findLastIndex(y => y != null);
  const step = state.bridgeY[last] - state.terrain[last + 1];
  assert.ok(step >= 0 && step <= WALK_STEP,
    `the ramp should meet the stairs within one step, not ${step}px above them`);
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
  for(let x = 10; x < 20; x++) assert.ok(state.bridgeY[x] != null, `column ${x} should be carrying ramp`);
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
function playLevel1(){
  const state = newGame(LEVEL_1);
  let builderUsed = false;
  for(let i = 0; i < LEVEL_1.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 69 && assignSkill(state, d.id, 'builder')) builderUsed = true;
      else if(!hasTrait(d, 'climber') && d.x >= 130 && d.x < 150) assignSkill(state, d.id, 'climber');
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

/* A greedy bot for The Grove, the same shape as The Warren's: bridge the
 * one gap, dig through the one wall. Neither Climber nor Blocker gets a
 * branch here — the level supplies no Climber at all, and nothing about a
 * single straight road calls for a Blocker (see content.js).
 */
function playLevel4(){
  const state = newGame(LEVEL_4);
  let builderUsed = false, diggerUsed = false;
  for(let i = 0; i < LEVEL_4.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 49 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
      if(!diggerUsed && d.x === 129 && assignSkill(state, d.id, 'digger')){ diggerUsed = true; continue; }
    }
    tick(state);
  }
  return state;
}

test('The Grove can be won by a simple bot', () => {
  const state = playLevel4();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_4), `only ${state.saved} saved, needed ${winCount(LEVEL_4)}`);
});

test('The Grove cannot be won without a Digger — the wall has no other way through', () => {
  const state = newGame(LEVEL_4);
  let builderUsed = false;
  for(let i = 0; i < LEVEL_4.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 49 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should get past the wall without a Digger');
  assert.notEqual(state.ended, 'won');
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

/* The Spire: the stairs themselves need nothing at all — every tread is a
 * plain step, not a wall (see content.js's WALK_STEP and the level's own
 * design note) — so this bot never touches Digger or Climber, only the
 * one bridge and the ledge's own fall.
 */
function playLevel6(){
  const state = newGame(LEVEL_6);
  let builderUsed = false;
  for(let i = 0; i < LEVEL_6.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 39 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
      if(!hasTrait(d, 'flyer') && d.x >= 65 && d.x < 120) assignSkill(state, d.id, 'flyer');
    }
    tick(state);
  }
  return state;
}

test('The Spire can be won by a simple bot, with no Digger or Climber at all', () => {
  const state = playLevel6();
  assert.equal(state.ended, 'won');
  assert.ok(state.saved >= winCount(LEVEL_6), `only ${state.saved} saved, needed ${winCount(LEVEL_6)}`);
});

test('The Spire\'s stairs never turn a duckling back — every tread is a step, not a wall', () => {
  const state = newGame(LEVEL_6);
  let builderUsed = false;
  const dirAtStairs = new Map();
  let turnedBack = 0;
  for(let i = 0; i < LEVEL_6.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 39 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
      if(!hasTrait(d, 'flyer') && d.x >= 65 && d.x < 120) assignSkill(state, d.id, 'flyer');
      if(d.x >= 120 && d.x < 180){
        const prev = dirAtStairs.get(d.id);
        if(prev !== undefined && prev !== d.dir) turnedBack++;
        dirAtStairs.set(d.id, d.dir);
      }
    }
    tick(state);
  }
  assert.equal(turnedBack, 0, 'nothing should ever turn back on the stairs themselves');
  assert.ok(state.saved > 0);
});

test('The Spire cannot be won without a Flyer — the ledge falls the whole height of the stairs', () => {
  const state = newGame(LEVEL_6);
  let builderUsed = false;
  for(let i = 0; i < LEVEL_6.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 39 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'nothing should survive the ledge without a Flyer');
  assert.notEqual(state.ended, 'won');
});

test('a blocker planted on The Spire\'s ledge turns a wingless duckling back rather than saving it', () => {
  const state = newGame(LEVEL_6);
  let builderUsed = false, blockerUsed = false;
  for(let i = 0; i < LEVEL_6.timeLimit && !state.ended; i++){
    for(const d of state.ducks){
      if(d.state !== 'walking') continue;
      if(!builderUsed && d.x === 39 && assignSkill(state, d.id, 'builder')){ builderUsed = true; continue; }
      if(!blockerUsed && d.x === 194 && assignSkill(state, d.id, 'blocker')){ blockerUsed = true; continue; }
    }
    tick(state);
  }
  assert.equal(state.saved, 0, 'a blocker turns ducklings back, it does not fly them down');
  assert.ok(state.ducks.some(d => d.state === 'blocking'), 'the blocker itself should still be standing there');
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

test('The Falls\' wall can also be answered by a ramp that reaches it, not only by a Digger or a Climber', () => {
  /* The one level where that is true, and worth pinning down rather than
   * leaving as a surprise. This level descends: its wall's top sits at 15,
   * only five pixels above the nest's own 20 (see LEVEL_7's segments), and a
   * Builder's ramp climbs BUILD_RISE_HEIGHT — twenty-four — so a ramp still
   * running when it arrives is simply higher than the wall is, and carries
   * on over the top of it. Everywhere else the walls stand fifty to a
   * hundred pixels above the ground a ramp would start from, well out of
   * reach, which is why this is the only level it happens on.
   *
   * So the same bot that used to prove the wall needed a Digger or a Climber
   * now clears the level without either, off the first gap's Builder alone.
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
  assert.equal(state.ended, 'won');
  assert.ok(state.bridgeY.some((y, x) => y != null && x >= 210 && x < 230),
    'the ramp should be lying over the wall\'s own plateau — that is what got them past it');
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
