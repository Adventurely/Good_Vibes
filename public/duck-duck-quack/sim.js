/* Duck Duck Quack — the rules.
 *
 * One state object, `newGame()` below, and every function here takes it.
 * `tick` is the only one called every frame; it advances the whole flock by
 * exactly one simulation step. `assignSkill` is the only thing a click ever
 * calls. Nothing here touches a canvas or a clock — the page owns both and
 * this module only ever answers "what happens next", which is what lets a
 * whole run be played out and checked in a test with no browser near it.
 */

import { SCENE_H, FALL_SAFE, WALK_STEP, FALL_SPEED, CLIMB_SPEED, DIG_RATE,
  BUILD_MAX_STEPS, DIG_MAX_STEPS, SKILLS, GOOSE_FLEE_SPEED, GOOSE_FLEE_LIFT,
  POOF_TICKS, buildTerrain, winCount } from './content.js';

/* ----------------------------------------------------------------- a duck */

let nextId = 1;

function hatchling(level, groundY){
  return {
    id: nextId++,
    x: level.nestX,
    y: groundY,
    dir: 1,
    state: 'walking',   // walking | falling | digging | building | climbing | blocking | saved | lost
    // Digger, Builder and Climber are traits, and a duckling can hold more
    // than one at once — see assignSkill for why. Blocker is not in here at
    // all: it is an instant, terminal action, not something to check for
    // later.
    traits: new Set(),
    fallFrom: 0,
    buildLeft: 0,
    digLeft: 0,
    cause: null,        // set when lost: 'fell' | 'edge' | 'goosed'
  };
}

/* Does this duckling currently hold this trait? The one thing anything
   outside this module should ever ask about a duckling's skills — see
   assignSkill for the shape underneath. */
export const hasTrait = (d, skill) => d.traits.has(skill);

/* ---------------------------------------------------------------- the game */

/* `newGame` builds its own copy of the terrain from the level's segments —
   never the same array a second game of the same level would start from —
   so digging and building can mutate it freely for the length of one run. */
export function newGame(level){
  return {
    level,
    terrain: buildTerrain(level.segments, level.width),
    ticks: 0,
    hatched: 0,
    nextHatch: 0,
    ducks: [],
    saved: 0,
    lost: 0,
    supply: { ...level.supply },
    goose: { x: level.goose.x0, dir: 1, fed: false, lift: 0, gone: false },
    poofs: [],
    ended: null,        // null | 'won' | 'lost'
  };
}

/* The one place a duckling is ever marked lost — dropping a poof where it
   went down is what stops that from reading as the duckling just vanishing.
   See POOF_TICKS in content.js for how long it lingers. */
function loseDuckling(state, d, cause){
  d.state = 'lost';
  d.cause = cause;
  state.poofs.push({ x: d.x, y: d.y, age: 0 });
}

const groundAt = (state, x) => {
  const col = Math.max(0, Math.min(state.level.width - 1, Math.round(x)));
  return state.terrain[col];
};

const setGroundAt = (state, x, y) => {
  const col = Math.max(0, Math.min(state.level.width - 1, Math.round(x)));
  state.terrain[col] = y;
};

const blockerAt = (state, x) =>
  state.ducks.some(d => d.state === 'blocking' && Math.round(d.x) === Math.round(x));

/* -------------------------------------------------------------------- tick */

export function tick(state){
  if(state.ended) return;
  state.ticks++;

  hatch(state);
  stepGoose(state);
  for(const d of state.ducks) stepDuck(state, d);
  stepPoofs(state);

  state.saved = state.ducks.reduce((n, d) => n + (d.state === 'saved' ? 1 : 0), 0);
  state.lost = state.ducks.reduce((n, d) => n + (d.state === 'lost' ? 1 : 0), 0);

  evaluate(state);
}

function hatch(state){
  const level = state.level;
  if(state.hatched >= level.duckCount) return;
  if(state.ticks < state.nextHatch) return;
  const d = hatchling(level, groundAt(state, level.nestX));
  state.ducks.push(d);
  state.hatched++;
  state.nextHatch = state.ticks + level.spawnInterval;
}

function stepPoofs(state){
  for(const p of state.poofs) p.age += 1;
  state.poofs = state.poofs.filter(p => p.age < POOF_TICKS);
}

function stepGoose(state){
  if(state.goose.gone) return;

  // Fed and fleeing: keep going the way it was already facing, climbing as
  // it goes, until it has actually cleared the scene — a fixed tick count
  // would either cut the flight short on a wide level or linger pointlessly
  // on a narrow one.
  if(state.goose.fed){
    state.goose.x += state.goose.dir * GOOSE_FLEE_SPEED;
    state.goose.lift += GOOSE_FLEE_LIFT;
    if(state.goose.x < -20 || state.goose.x > state.level.width + 20){
      state.goose.gone = true;
    }
    return;
  }

  const g = state.level.goose;
  state.goose.x += state.goose.dir * g.speed;
  if(state.goose.x >= g.x1){ state.goose.x = g.x1; state.goose.dir = -1; }
  if(state.goose.x <= g.x0){ state.goose.x = g.x0; state.goose.dir = 1; }
}

function evaluate(state){
  const level = state.level;
  const need = winCount(level);
  if(state.saved >= need){ state.ended = 'won'; return; }

  const resolved = state.hatched >= level.duckCount &&
    state.ducks.every(d => d.state === 'saved' || d.state === 'lost');
  if(resolved || state.ticks >= level.timeLimit){
    state.ended = state.saved >= need ? 'won' : 'lost';
  }
}

/* ------------------------------------------------------------------- a duck */

function stepDuck(state, d){
  switch(d.state){
    case 'walking': return stepWalking(state, d);
    case 'falling': return stepFalling(state, d);
    case 'digging': return stepDigging(state, d);
    case 'building': return stepBuilding(state, d);
    case 'climbing': return stepClimbing(state, d);
    default: return; // blocking, saved, lost: nothing left to do
  }
}

/* Whether the goose would catch a duckling standing at `x` right now.
 *
 * Only the *first* duckling it reaches counts, on purpose: the flock walks
 * the whole level in lockstep, evenly spaced by the same hatch interval, so a
 * sweep that can catch one duckling in a given position is either in range of
 * every duckling that ever stands there or none of them — there is no
 * "sometimes" for it to land on. One honk and a scattered feather is the
 * goose actually doing something; a hazard that is either free or total is
 * not a puzzle, it is a coin flip decided at level-design time. */
function goosedAt(state, x){
  if(state.goose.fed) return false;
  const g = state.level.goose;
  return x >= g.x0 - 1 && x <= g.x1 + 1 && Math.abs(x - state.goose.x) <= g.catchRadius;
}

function stepWalking(state, d){
  const level = state.level;

  if(d.x >= level.goalX){ d.state = 'saved'; return; }
  if(goosedAt(state, d.x)){ loseDuckling(state, d, 'goosed'); state.goose.fed = true; return; }

  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ loseDuckling(state, d, 'edge'); return; }

  if(blockerAt(state, nextX)){ d.dir = -d.dir; return; }

  const nextY = groundAt(state, nextX);
  const delta = nextY - d.y;   // positive: ground drops away; negative: ground rises

  if(delta < -WALK_STEP){
    if(hasTrait(d, 'climber')){ d.state = 'climbing'; d.x = nextX; return; }
    d.dir = -d.dir;
    return;
  }

  if(delta > FALL_SAFE){
    /* A gap has no floor anywhere in the visible scene (see content.js's
     * PIT_Y); a plain drop still has one, just further down. That is the
     * real difference between "bridge it" and "dig down to it" — a digger
     * sent at a gap would spend its whole ramp chasing a floor that is not
     * there, and a builder sent at a drop would float a bridge over ground
     * that was already perfectly walkable. So each skill only answers to
     * the shape of hazard it actually solves; given the wrong one for what
     * is ahead, a duckling just falls, the same as if it had no skill at
     * all — which is also what makes it safe for a skill to be handed out
     * long before the hazard it is for, rather than needing to land on the
     * exact column where that hazard starts.
     */
    if(hasTrait(d, 'builder') && nextY >= SCENE_H){
      d.state = 'building';
      d.buildLeft = BUILD_MAX_STEPS;
      return;
    }
    if(hasTrait(d, 'digger') && nextY < SCENE_H){
      d.state = 'digging';
      d.digLeft = DIG_MAX_STEPS;
      return;
    }
    d.x = nextX;
    d.state = 'falling';
    d.fallFrom = d.y;
    return;
  }

  d.x = nextX;
  d.y = nextY;
}

function stepFalling(state, d){
  d.y += FALL_SPEED;
  if(d.y > SCENE_H){ loseDuckling(state, d, 'fell'); return; }
  const ground = groundAt(state, d.x);
  if(d.y >= ground){
    const dropped = ground - d.fallFrom;
    d.y = ground;
    if(dropped > FALL_SAFE) loseDuckling(state, d, 'fell');
    else d.state = 'walking';
  }
}

/* A digger cuts forward and down, DIG_RATE at a time, until the natural
 * ground catches up with the ramp it is laying — the mirror image of a
 * builder, which cuts forward and up until the ramp catches up with the
 * ground. It never touches the column it started from.
 *
 * That last part is not a detail: a digger that deepened its own column
 * instead would leave the column behind it exactly as tall as it always
 * was, which turns a fifty-pixel drop in front of the flock into a
 * fifty-pixel drop just one column further back — solving nothing, only
 * moving where the cliff is. Carving forward is what actually removes it.
 */
function stepDigging(state, d){
  const level = state.level;
  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ d.state = 'walking'; return; }

  const natural = groundAt(state, nextX);
  const candidate = Math.min(SCENE_H, d.y + DIG_RATE);

  if(candidate >= natural){
    // The ramp has reached the level of the ground ahead: step onto it and stop.
    d.x = nextX;
    d.y = natural;
    d.state = 'walking';
    return;
  }

  setGroundAt(state, nextX, candidate);
  d.x = nextX;
  d.y = candidate;
  d.digLeft -= 1;
  if(d.digLeft <= 0) d.state = 'walking';
}

function stepBuilding(state, d){
  const level = state.level;
  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ d.state = 'walking'; return; }

  const ahead = groundAt(state, nextX);
  if(ahead <= d.y){
    // Solid ground already at or above the bridge: step onto it and stop.
    d.x = nextX;
    d.y = ahead;
    d.state = 'walking';
    return;
  }

  setGroundAt(state, nextX, d.y);
  d.x = nextX;
  d.buildLeft -= 1;
  if(d.buildLeft <= 0) d.state = 'walking';
}

function stepClimbing(state, d){
  d.y -= CLIMB_SPEED;
  const top = groundAt(state, d.x);
  if(d.y <= top){
    d.y = top;
    d.state = 'walking';
  }
}

/* ---------------------------------------------------------------- assigning */

/* Why a skill cannot be given right now, or null. A duckling can only take a
   new job while it is plainly walking — mid-fall, mid-dig, already planted as
   a blocker, already saved or already lost are all "no", and each says why
   rather than the click just doing nothing. Already holding the trait being
   offered is also a "no": nothing changes, and there is no reason to spend a
   second builder finding that out. */
export function assignRefusal(state, duckId, skill){
  if(state.ended) return 'The level is over.';
  if(!SKILLS.includes(skill)) return 'There is no such skill.';
  const d = state.ducks.find(duck => duck.id === duckId);
  if(!d) return 'There is no such duckling.';
  if(d.state !== 'walking') return 'That one is busy.';
  if(skill !== 'blocker' && hasTrait(d, skill)) return 'That one already has it.';
  if(!(state.supply[skill] > 0)) return `Out of ${skill}s.`;
  return null;
}

/* Give a duckling a skill. Returns the duckling, or null if it was refused
 * and nothing changed.
 *
 * Blocker is the one that acts at once — planting itself is not something
 * that waits for a particular spot. Digger, Builder and Climber are all
 * traits rather than instant actions, and — unlike Blocker — a duckling can
 * hold more than one at a time: each only matters the next time this
 * duckling actually meets the thing it answers (a wall too tall to step up,
 * a drop, a gap), which is what stepWalking checks for on every step, and
 * the three answer three different shapes of hazard that never overlap.
 * That stacking is not a nicety — a duckling given Builder for the gap still
 * has to get past the wall afterwards, and Climber is the only thing that
 * gets it there. Handed out one at a time as each hazard is reached, that
 * is automatic; handed out all at once at the nest, it only works at all
 * because holding Builder never stops it from also holding Climber.
 */
export function assignSkill(state, duckId, skill){
  if(assignRefusal(state, duckId, skill)) return null;
  const d = state.ducks.find(duck => duck.id === duckId);
  state.supply[skill] -= 1;

  if(skill === 'blocker'){ d.state = 'blocking'; return d; }
  // digger, builder, climber: stay 'walking' until the right hazard asks for them.
  d.traits.add(skill);
  return d;
}

/* Duckling at a point on screen, nearest first, or null. What a click on the
   scene resolves to — only ducklings still open to a new job are candidates,
   so a click near a blocker or a duckling already saved picks the one next to
   it instead of doing nothing. */
export function duckNear(state, x, y, radius = 10){
  let best = null, bestDist = Infinity;
  for(const d of state.ducks){
    if(d.state === 'saved' || d.state === 'lost') continue;
    const dist = Math.hypot(d.x - x, d.y - y);
    if(dist <= radius && dist < bestDist){ best = d; bestDist = dist; }
  }
  return best;
}
