/* Duck Duck Quack — the rules.
 *
 * One state object, `newGame()` below, and every function here takes it.
 * `tick` is the only one called every frame; it advances the whole flock by
 * exactly one simulation step. `assignSkill` is the only thing a click ever
 * calls. Nothing here touches a canvas or a clock — the page owns both and
 * this module only ever answers "what happens next", which is what lets a
 * whole run be played out and checked in a test with no browser near it.
 */

import { SCENE_H, FALL_SAFE, WALK_STEP, FALL_SPEED, FLY_SPEED, CLIMB_SPEED,
  BUILD_MAX_STEPS, BRIDGE_ARCH_HEIGHT, DIG_MAX_STEPS, SKILLS, GOOSE_FLEE_SPEED,
  GOOSE_FLEE_LIFT, POOF_TICKS, buildTerrain, buildLayer, winCount } from './content.js';

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
    buildSpan: 0,       // set when building starts — see stepWalking, stepBuilding
    buildBaseY: 0,
    buildStep: 0,
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
    // Where a Digger or a Builder has actually changed the way through — see
    // groundAt below for why these live apart from `terrain` rather than
    // overwriting it. null everywhere nothing has been dug or bridged yet.
    tunnelY: new Array(level.width).fill(null),
    bridgeY: new Array(level.width).fill(null),
    // Where a wall is rock rather than dirt — see rockAt below and
    // content.js's header note on segments' `hard` field. `floors` (art.js's
    // drawGround) is not read anywhere in this file at all — nothing below a
    // column's surface is ever solid to begin with — but it is built here
    // rather than recomputed every frame, the same reasoning `terrain` is.
    rock: buildLayer(level.segments, 'hard', false, level.width),
    floors: buildLayer(level.segments, 'floor', SCENE_H, level.width),
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

const columnAt = (state, x) => Math.max(0, Math.min(state.level.width - 1, Math.round(x)));

/* The ground a walking duckling actually stands on: whichever a Digger or a
   Builder has left at this column, or the level's own terrain if neither
   ever touched it. `terrain` itself never changes after newGame — see
   setTunnelAt/setBridgeAt, and content.js's header note on why the two are
   kept apart rather than one overwriting the other. */
const groundAt = (state, x) => {
  const col = columnAt(state, x);
  if(state.tunnelY[col] != null) return state.tunnelY[col];
  if(state.bridgeY[col] != null) return state.bridgeY[col];
  return state.terrain[col];
};

const setTunnelAt = (state, x, y) => { state.tunnelY[columnAt(state, x)] = y; };
const setBridgeAt = (state, x, y) => { state.bridgeY[columnAt(state, x)] = y; };

/* Whether the wall at this column is rock rather than dirt — see
   content.js's header note on segments' `hard` field. A Digger already
   tunnelling never re-checks this on its own (see stepDigging), so a level
   that ever put rock right behind a diggable wall would need the tunnel to
   run into it, not just start against it — this is what lets it. */
const rockAt = (state, x) => state.rock[columnAt(state, x)];

/* How many columns of open pit start at `x` — read once, the moment a
   Builder starts, so its bridge can be given a shape (see stepBuilding)
   that is guaranteed to land back at the far bank rather than guessed a
   column at a time. Capped at BUILD_MAX_STEPS same as the build itself. */
const pitSpanAt = (state, x, cap) => {
  let span = 0;
  while(span < cap && groundAt(state, x + span) >= SCENE_H) span++;
  return Math.max(1, span);
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
  const dir = state.goose.dir;
  const nextX = state.goose.x + dir * g.speed;

  /* A Blocker stops the goose exactly the way it would a wall it cannot
   * climb — which is the one thing a Blocker actually changes the outcome
   * of, see sim.js's header note and content.js's SKILL_INFO. Scanned as a
   * whole run of columns rather than just the rounded landing spot: the
   * goose's own speed is not always a whole number, and a fast enough sweep
   * must not step clean over a duckling planted in its way.
   *
   * It gives up the hunt outright rather than just turning around — the same
   * `fed` flag a catch sets, so it flees the scene exactly as it would have
   * after eating (see the branch above). On a level where a catch itself
   * does not call the hunt off (`goose.relentless`, see content.js), this is
   * the only thing that does.
   */
  const from = Math.ceil(Math.min(state.goose.x, nextX));
  const to = Math.floor(Math.max(state.goose.x, nextX));
  for(let x = from; x <= to; x++){
    if(blockerAt(state, x)){ state.goose.dir = -dir; state.goose.fed = true; return; }
  }

  state.goose.x = nextX;
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
 * Ordinarily only the *first* duckling it reaches counts, on purpose: the
 * flock walks the whole level in lockstep, evenly spaced by the same hatch
 * interval, so a sweep that can catch one duckling in a given position is
 * either in range of every duckling that ever stands there or none of them —
 * there is no "sometimes" for it to land on. One honk and a scattered
 * feather is the goose actually doing something; a hazard that is either
 * free or total is not a puzzle, it is a coin flip decided at level-design
 * time. `goose.relentless` (content.js) is the one exception: there, a catch
 * does not call the hunt off, only a Blocker does — see stepWalking and
 * stepGoose. */
function goosedAt(state, x){
  if(state.goose.fed) return false;
  const g = state.level.goose;
  return x >= g.x0 - 1 && x <= g.x1 + 1 && Math.abs(x - state.goose.x) <= g.catchRadius;
}

function stepWalking(state, d){
  const level = state.level;

  if(d.x >= level.goalX){ d.state = 'saved'; return; }
  if(goosedAt(state, d.x)){
    loseDuckling(state, d, 'goosed');
    // Ordinarily one catch is the whole hunt — see goosedAt above. A
    // relentless goose (content.js's goose.relentless) keeps hunting after
    // a catch instead, so only a Blocker calls it off; see stepGoose.
    if(!level.goose.relentless) state.goose.fed = true;
    return;
  }

  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ loseDuckling(state, d, 'edge'); return; }

  // A planted Blocker is a wall nothing gets past — the goose included, see
  // stepGoose — so any other duckling that steps into its column turns
  // around exactly the way it would at a wall it cannot climb.
  if(blockerAt(state, nextX)){ d.dir = -d.dir; return; }

  const nextY = groundAt(state, nextX);
  const delta = nextY - d.y;   // positive: ground drops away; negative: ground rises

  /* A wall: ground that rises faster than a duckling can step up. Two skills
   * answer it, and a duckling holding both digs, because tunnelling leaves a
   * way through for everyone behind it while climbing only ever gets the one
   * duckling over. Given neither, it turns around, which costs nothing.
   *
   * Rock (content.js's segment `hard`) takes Digger out of that choice
   * entirely — a Digger reaching one never even starts, the same as not
   * holding the trait at all. Climbing is not answered here at all, on
   * purpose: rock is still a wall, not a different hazard, so a Climber
   * scales it exactly the way it would anything else.
   */
  if(delta < -WALK_STEP){
    if(!rockAt(state, nextX) && hasTrait(d, 'digger')){ d.state = 'digging'; d.digLeft = DIG_MAX_STEPS; return; }
    if(hasTrait(d, 'climber')){ d.state = 'climbing'; d.x = nextX; return; }
    d.dir = -d.dir;
    return;
  }

  if(delta > FALL_SAFE){
    /* A gap has no floor anywhere in the visible scene (see content.js's
     * PIT_Y); a plain drop still has one, just further down. Only the
     * Builder reads that difference here, and only a gap is worth bridging:
     * a bridge laid over a drop would hang in the air above ground that was
     * already perfectly walkable.
     *
     * A Flyer needs no branch of its own. It does not avoid the fall, it
     * survives it — see stepFalling, which is also why it is no use at all
     * over a gap, where there is nothing to land on however gently you
     * arrive. Nothing here waits for a particular column, which is what
     * makes it safe to hand a skill out long before the obstacle it is for.
     */
    if(hasTrait(d, 'builder') && nextY >= SCENE_H){
      d.state = 'building';
      d.buildLeft = BUILD_MAX_STEPS;
      d.buildSpan = pitSpanAt(state, nextX, BUILD_MAX_STEPS);
      d.buildBaseY = d.y;
      d.buildStep = 0;
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

/* A Flyer flaps down slowly and walks away from whatever it lands on. It
 * still needs something to land on, though — over a gap it flaps gently
 * past the bottom of the world and is lost all the same, which is the line
 * between "survives the drop" and "crosses the gap". */
function stepFalling(state, d){
  const flying = hasTrait(d, 'flyer');
  d.y += flying ? FLY_SPEED : FALL_SPEED;
  if(d.y > SCENE_H){ loseDuckling(state, d, 'fell'); return; }
  const ground = groundAt(state, d.x);
  if(d.y >= ground){
    const dropped = ground - d.fallFrom;
    d.y = ground;
    if(!flying && dropped > FALL_SAFE) loseDuckling(state, d, 'fell');
    else d.state = 'walking';
  }
}

/* A digger drives straight ahead at the height it started from, cutting a
 * tunnel through the wall one column at a time, and walks out the far side
 * of it. Its own height never changes: this is a tunnel through, not a ramp
 * down.
 *
 * Unlike the old cut-to-head-height notch, this leaves `terrain` itself
 * completely alone — see groundAt above and content.js's header note. What
 * gets written is `tunnelY`, a second number for the same column that only
 * ever matters where it is not null, so the wall the tunnel runs through
 * still stands, full height, in art.js: a bored hole with rock still
 * overhead, not a hillside quietly bulldozed down to head height.
 *
 * It stops the moment the ground ahead is already at or below the height
 * being cut, and stops without stepping onto it, so the ordinary walking
 * rules get to decide what that ground is — flat to walk onto, or a drop to
 * fall down. A digger that stepped out on its own could walk itself off a
 * cliff the walking code would have handled properly.
 *
 * It stops the same way, cold, at the first column of actual rock (see
 * rockAt) — stepWalking already refuses to start a tunnel into rock, but a
 * tunnel already under way does not re-check that on its own, so this is
 * what stops one that started in ordinary wall from running straight
 * through rock behind it.
 */
function stepDigging(state, d){
  const level = state.level;
  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ d.state = 'walking'; return; }
  if(rockAt(state, nextX)){ d.state = 'walking'; return; }

  if(groundAt(state, nextX) >= d.y){ d.state = 'walking'; return; }

  setTunnelAt(state, nextX, d.y);
  d.x = nextX;
  d.digLeft -= 1;
  if(d.digLeft <= 0) d.state = 'walking';
}

/* A builder doesn't lay a flat plank — it angles the deck up, cresting over
 * the middle of the gap and back down to meet the far bank, the shape an
 * actual bridge takes rather than a raft towed across at one fixed height.
 * `d.buildSpan` (set once, the moment building starts — see stepWalking) is
 * how many columns of open pit there are to cross, read ahead of time so the
 * rise can be shaped to come back down to `d.buildBaseY` exactly at the far
 * edge, landing correctly however wide the gap turns out to be, rather than
 * guessed a column at a time and left to hang short or fly past the bank.
 *
 * `bridgeY` is its own layer over the same column `tunnelY` uses for a dig
 * — see groundAt above — so a bridged gap still shows as open air below the
 * deck in art.js rather than the gap itself quietly filling in with dirt.
 */
function stepBuilding(state, d){
  const level = state.level;
  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ d.state = 'walking'; return; }

  const progress = Math.min(1, (d.buildStep + 1) / d.buildSpan);
  const rise = Math.round(Math.sin(progress * Math.PI) * BRIDGE_ARCH_HEIGHT);
  const y = d.buildBaseY - rise;

  const ahead = groundAt(state, nextX);
  if(ahead <= y){
    // Solid ground already at or above the deck: step onto it and stop.
    d.x = nextX;
    d.y = ahead;
    d.state = 'walking';
    return;
  }

  setBridgeAt(state, nextX, y);
  d.x = nextX;
  d.y = y;
  d.buildStep += 1;
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
