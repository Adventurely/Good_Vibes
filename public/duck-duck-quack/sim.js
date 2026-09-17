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
  BUILD_MAX_STEPS, BUILD_RISE_HEIGHT, DIG_MAX_STEPS, SKILLS, GOOSE_FLEE_SPEED,
  GOOSE_FLEE_LIFT, POOF_TICKS, buildTerrain, buildLayer, winCount, goalHeading } from './content.js';

/* ----------------------------------------------------------------- a duck */

let nextId = 1;

function hatchling(level, groundY){
  return {
    id: nextId++,
    x: level.nestX,
    y: groundY,
    // Toward the pond, whichever side of the nest that is — see content.js's
    // goalHeading. Every level before The Orchard's reversal has a pond to
    // the right of its nest, where this is just 1; it is what makes a level
    // built the other way round walk correctly from the moment it hatches.
    dir: goalHeading(level),
    state: 'walking',   // walking | falling | digging | building | climbing | blocking | saved | lost
    // Digger and Climber are traits, and a duckling can hold both at once —
    // see assignSkill for why. Builder and Blocker are not in here at all:
    // both act the instant they are given rather than waiting to be checked
    // for later — see assignSkill again.
    traits: new Set(),
    fallFrom: 0,
    buildBaseY: 0,      // the height the ramp started from — see stepBuilding
    buildStep: 0,       // ticks spent building so far, up to BUILD_MAX_STEPS
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
    // Where a Digger has cut through — one height per column, or null where
    // nothing has been dug. See groundAt below for why this lives apart from
    // `terrain` rather than overwriting it.
    tunnelY: new Array(level.width).fill(null),
    // Every ramp deck standing at each column, as a list rather than one
    // height: ramps cross. Build one over another heading the other way and
    // both are still there, one above the other, each its own thing to walk
    // on — see surfacesAt below, and addDeckAt, which never replaces a deck
    // already standing at a column, only adds to it.
    decks: Array.from({ length: level.width }, () => []),
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

/* The level's own ground at a column, with a Digger's tunnel counted where
   there is one and ramps ignored entirely. `terrain` itself never changes
   after newGame — see setTunnelAt, and content.js's header note on why a
   tunnel is kept apart rather than overwriting the wall it runs through. */
const groundAt = (state, x) => {
  const col = columnAt(state, x);
  if(state.tunnelY[col] != null) return state.tunnelY[col];
  return state.terrain[col];
};

/* Everything at this column a duckling could be standing on: the ground
   itself, plus every ramp deck crossing it. Order is not meaningful — the
   callers below all pick out the one surface they want by height, because
   which surface is the right one depends entirely on where the duckling
   already is. A deck overhead is not ground to a duckling walking under it;
   the same deck is the only ground there is to the duckling walking along
   it. That is the whole reason this is a list. */
const surfacesAt = (state, x) => [groundAt(state, x), ...state.decks[columnAt(state, x)]];

const setTunnelAt = (state, x, y) => { state.tunnelY[columnAt(state, x)] = y; };

/* Adds a deck without disturbing any already standing at that column — see
   `decks` in newGame. A ramp laid across an older one leaves both. */
const addDeckAt = (state, x, y) => {
  const at = state.decks[columnAt(state, x)];
  if(!at.includes(y)) at.push(y);
};

/* Which of a column's surfaces a duckling at `fromY` would actually step
 * onto, or null if none of them is anything but a wall to it.
 *
 * Anything within WALK_STEP either way is ordinary ground to step along, and
 * of those the *highest* wins — a duckling always takes the step up if there
 * is one to take. That is what puts a duckling walking the ground onto the
 * foot of a ramp rather than under it, and what makes one coming down a ramp
 * change onto another crossing it the other way and carry on up: at the
 * crossing both decks are a step away, and up beats down. Preferring the
 * nearest instead kept it on the ramp it was already descending, which is
 * the one thing a duckling standing at the foot of an upward ramp plainly
 * should not do.
 *
 * Failing that, the highest surface still beneath it is where it is headed,
 * which is what lets a duckling walk clean under a ramp overhead instead of
 * being lifted onto it, and what makes the ground under a ramp still count
 * as ground. Only when every surface here stands more than a step above is
 * there nothing to step onto at all — a wall.
 */
const stepTargetAt = (state, x, fromY) => {
  let onLevel = null, below = null;
  for(const s of surfacesAt(state, x)){
    if(Math.abs(s - fromY) <= WALK_STEP){
      if(onLevel === null || s < onLevel) onLevel = s;
    } else if(s > fromY){
      if(below === null || s < below) below = s;
    }
  }
  return onLevel !== null ? onLevel : below;
};

/* Whether the wall at this column is rock rather than dirt — see
   content.js's header note on segments' `hard` field. A Digger already
   tunnelling never re-checks this on its own (see stepDigging), so a level
   that ever put rock right behind a diggable wall would need the tunnel to
   run into it, not just start against it — this is what lets it. */
const rockAt = (state, x) => state.rock[columnAt(state, x)];

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

  // Reached or past the pond, in whichever direction it actually lies —
  // see content.js's goalHeading. `d.x >= level.goalX` on its own is only
  // ever right for a level whose pond is to the right of its nest; a
  // reversed level needs the mirror image of it instead.
  if((d.x - level.goalX) * goalHeading(level) >= 0){ d.state = 'saved'; return; }
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

  /* Which surface at the next column this duckling is actually headed for —
     the ground, or one of the ramp decks crossing it, whichever it could
     step onto from where it stands. See stepTargetAt: this is what carries a
     duckling along the ramp it is already on, in whichever direction it is
     walking, and what lets one walk under a ramp it is not on. A null means
     every surface there stands too high to step onto, which is a wall. */
  const nextY = stepTargetAt(state, nextX, d.y);
  const delta = nextY === null ? -Infinity : nextY - d.y;   // positive: ground drops away; negative: ground rises

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
     * PIT_Y); a plain drop still has one, just further down. Builder is not
     * checked for here at all — it does not wait to be asked, it starts the
     * moment it is given (see assignSkill), so by the time a duckling meets
     * a drop still walking, it either has a ramp already under it or never
     * had a Builder to begin with. Either way this is just a fall.
     *
     * A Flyer needs no branch of its own. It does not avoid the fall, it
     * survives it — see stepFalling, which is also why it is no use at all
     * over a gap, where there is nothing to land on however gently you
     * arrive. Nothing here waits for a particular column, which is what
     * makes it safe to hand a skill out long before the obstacle it is for.
     */
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
 * between "survives the drop" and "crosses the gap".
 *
 * What it lands on is the first thing it reaches going down, which over a
 * column a ramp crosses is that ramp, not the ground far below it: falling
 * onto a deck is caught by the deck. Walking into the underside of one is
 * the case that passes through (see stepTargetAt) — coming down on top of
 * it is not. */
function stepFalling(state, d){
  const flying = hasTrait(d, 'flyer');
  d.y += flying ? FLY_SPEED : FALL_SPEED;
  if(d.y > SCENE_H){ loseDuckling(state, d, 'fell'); return; }
  const reached = surfacesAt(state, d.x).filter(s => d.y >= s);
  if(reached.length){
    const ground = Math.min(...reached);
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

/* A builder starts the moment it is given (see assignSkill) and climbs from
 * right where that duckling was standing, in whichever direction it was
 * already walking. Nothing about a gap starts it and nothing about a gap is
 * required for it to work: it lays a ramp forward and upward, a column a
 * tick, and a gap it happens to cross on the way is crossed because the ramp
 * was over it, not because the ramp went looking for it. Two things stop it,
 * and only two — running into ground, and running out of clock.
 *
 * Running into ground: the ground itself standing higher than the ramp's own
 * deck — see groundAt above, which is the level's terrain and a Digger's
 * tunnels and nothing else. A wall, a rock face, the side of a hill, or a
 * staircase climbing faster than the ramp is: all the same thing from here,
 * and all of them end the climb. Other ramps are deliberately not in that
 * test. A ramp crossing one already standing passes over or under it and
 * both are left whole (see addDeckAt), which is the only way building a
 * second ramp back the other way over a first can work at all.
 *
 * Because the test is "has the ground caught up to the deck yet", it fires
 * exactly where the two meet, which is what makes the ramp always join
 * whatever stopped it within a pixel or so rather than leaving a step. That
 * matters more than it sounds: a deck is shared, permanent ground (see
 * surfacesAt above), so every duckling behind this one walks up this ramp
 * too, and a ramp that ended a foot above the hillside would strand them.
 *
 * Running out of clock: BUILD_MAX_STEPS ticks (content.js), at which point
 * the ramp simply ends wherever it is — in mid-air if that is where the
 * clock left it, since it never comes back down on its own. It will be at
 * most BUILD_RISE_HEIGHT above the height it started from, and that is kept
 * equal to FALL_SAFE on purpose: over ground no lower than where the ramp
 * began, stepping off the end is exactly the tallest drop a duckling walks
 * away from unhurt. Over ground that has fallen away further since — a level
 * that descends, like The Falls — it is further than that, and walking off
 * the end is fatal for this duckling and for every one following it up. A
 * ramp is a real thing left in the world, and putting one somewhere careless
 * is a real mistake.
 *
 * A deck is its own thing standing over the column rather than a change to
 * it — see `decks` in newGame — so a gap a ramp crosses still shows as open
 * air below the deck in art.js rather than quietly filling in with dirt.
 */
function stepBuilding(state, d){
  const level = state.level;
  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ d.state = 'walking'; return; }

  const step = d.buildStep + 1;
  const y = d.buildBaseY - Math.round(step * BUILD_RISE_HEIGHT / BUILD_MAX_STEPS);

  /* Strictly higher, not "at or above": the first few ticks of a ramp round
     to no rise at all (BUILD_RISE_HEIGHT spread over BUILD_MAX_STEPS is well
     under a pixel a tick), so ground exactly level with the deck is still
     ground the ramp is climbing away from, not ground it has run into. Told
     to stop at level ground, a ramp given on the flat would stop on its very
     first tick, every time, and look like the click did nothing at all. */
  const ahead = groundAt(state, nextX);
  if(ahead < y){
    /* Stop, without stepping onto it. Stepping on would hand a Builder a
       free way up any wall it happened to end at, which is a Climber's job
       and a Digger's; leaving the duckling standing on the last column of
       its own ramp means the ordinary walking rules get to decide what that
       ground is, exactly as if it had walked there — a gentle rise it steps
       up (which is how a ramp joins a hillside or a staircase without a
       seam), or a wall it turns back from. */
    d.state = 'walking';
    return;
  }

  addDeckAt(state, nextX, y);
  d.x = nextX;
  d.y = y;
  d.buildStep = step;
  if(d.buildStep >= BUILD_MAX_STEPS) d.state = 'walking';
}

/* Climbs until it reaches something to stand on — the first surface it comes
   up under, which over a column some ramp crosses is that ramp's deck rather
   than the wall top far above it. */
function stepClimbing(state, d){
  d.y -= CLIMB_SPEED;
  const reached = surfacesAt(state, d.x).filter(s => d.y <= s);
  if(reached.length){
    d.y = Math.max(...reached);
    d.state = 'walking';
  }
}

/* ---------------------------------------------------------------- assigning */

/* Why a skill cannot be given right now, or null. A duckling can only take a
   new job while it is plainly walking — mid-fall, mid-dig, mid-ramp, already
   planted as a blocker, already saved or already lost are all "no", and each
   says why rather than the click just doing nothing. Already holding the
   trait being offered is also a "no" for Digger or Climber: nothing would
   change, and there is no reason to spend a second one finding that out.
   Builder is not checked against this at all — it is never held, only spent
   — so a duckling that already built one ramp and walked on is equally free
   to be given a second, somewhere else. */
export function assignRefusal(state, duckId, skill){
  if(state.ended) return 'The level is over.';
  if(!SKILLS.includes(skill)) return 'There is no such skill.';
  const d = state.ducks.find(duck => duck.id === duckId);
  if(!d) return 'There is no such duckling.';
  if(d.state !== 'walking') return 'That one is busy.';
  if(skill !== 'blocker' && skill !== 'builder' && hasTrait(d, skill)) return 'That one already has it.';
  if(!(state.supply[skill] > 0)) return `Out of ${skill}s.`;
  return null;
}

/* Give a duckling a skill. Returns the duckling, or null if it was refused
 * and nothing changed.
 *
 * Blocker and Builder both act at once, right where the duckling already is,
 * rather than waiting for a particular spot: planting itself is not
 * something a Blocker defers, and a Builder starts its ramp on the very next
 * tick, whatever is or isn't in front of it (see stepBuilding). Neither is a
 * trait either — `d.traits` never gains a 'blocker' or a 'builder' — which
 * is what makes a duckling that has already finished one ramp free to be
 * handed a second, later, somewhere else; see assignRefusal.
 *
 * Digger and Climber are the deferred ones, held until the duckling actually
 * meets the thing each answers (a wall too tall to step up), which is what
 * stepWalking checks for on every step. A duckling can hold both at once,
 * and that stacking is not a nicety — a duckling that dug through one wall
 * still turns back at a second one without a fresh Digger, and Climber is
 * the only thing that would get it there instead.
 */
export function assignSkill(state, duckId, skill){
  if(assignRefusal(state, duckId, skill)) return null;
  const d = state.ducks.find(duck => duck.id === duckId);
  state.supply[skill] -= 1;

  if(skill === 'blocker'){ d.state = 'blocking'; return d; }
  if(skill === 'builder'){
    d.state = 'building';
    d.buildBaseY = d.y;
    d.buildStep = 0;
    return d;
  }
  // digger, climber: stay 'walking' until the right hazard asks for them.
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
