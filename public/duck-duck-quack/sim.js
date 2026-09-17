/* Duck Duck Quack — the rules.
 *
 * One state object, `newGame()` below, and every function here takes it.
 * `tick` is the only one called every frame; it advances the whole flock by
 * exactly one simulation step. `assignSkill` is the only thing a click ever
 * calls. Nothing here touches a canvas or a clock — the page owns both and
 * this module only ever answers "what happens next", which is what lets a
 * whole run be played out and checked in a test with no browser near it.
 */

import { SCENE_H, FALL_SAFE, WALK_STEP, FALL_SPEED, FLY_SPEED, FLY_DRIFT, CLIMB_SPEED,
  BUILD_MAX_STEPS, BUILD_RISE_HEIGHT, DIG_MAX_STEPS, JUMP_SPAN, JUMP_RISE,
  SKILLS, GOOSE_FLEE_SPEED, ZAP_TICKS,
  GOOSE_FLEE_LIFT, POOF_TICKS, buildTerrain, buildLayer, winCount, goalHeading,
  hatchHeading } from './content.js';

/* ----------------------------------------------------------------- a duck */

let nextId = 1;

function hatchling(level, groundY){
  return {
    id: nextId++,
    x: level.nestX,
    y: groundY,
    // Toward the pond, whichever side of the nest that is — see content.js's
    // goalHeading and hatchHeading. Every level before The Orchard's reversal
    // has a pond to the right of its nest, where this is just 1; it is what
    // makes a level built the other way round walk correctly from the moment
    // it hatches, and what lets The Spire's nest on top of the spire send its
    // ducklings out the only way there is down.
    dir: hatchHeading(level),
    state: 'walking',   // walking | falling | digging | building | climbing | jumping | blocking | saved | lost
    // Digger and Climber are traits, and a duckling can hold both at once —
    // see assignSkill for why. Builder and Blocker are not in here at all:
    // both act the instant they are given rather than waiting to be checked
    // for later — see assignSkill again.
    traits: new Set(),
    fallFrom: 0,
    buildBaseY: 0,      // the height the ramp started from — see stepBuilding
    buildStep: 0,       // ticks spent building so far, up to BUILD_MAX_STEPS
    // true when this ramp runs level instead of climbing, which depends on
    // what the duckling was standing on when it was given — see assignSkill.
    buildLevel: false,
    // Where a hop took off from and where it is coming down — see startJump.
    jumpFromX: 0, jumpFromY: 0, jumpToX: 0, jumpToY: 0, jumpSpan: 0, jumpStep: 0,
    digLeft: 0,
    // The teleporter pad this one is standing on because it just came out of
    // it, or null. What keeps a two-way pair from throwing a duckling
    // straight back where it came from, forever — see padUnder.
    onPad: null,
    cause: null,        // set when lost: 'fell' | 'edge' | 'goosed'
  };
}

/* Does this duckling currently hold this trait? The one thing anything
   outside this module should ever ask about a duckling's skills — see
   assignSkill for the shape underneath. */
export const hasTrait = (d, skill) => d.traits.has(skill);

/* ---------------------------------------------------------------- the game */

/* A level's islands, expanded into the per-column lists surfacesAt reads —
   the same shape `decks` has, because to everything downstream of here an
   island and a ramp deck are the same kind of thing: a surface standing over
   the ground rather than replacing it. A level with no islands gets a column
   of empty lists and nothing anywhere else has to know the difference. */
function buildSky(islands, width){
  const sky = Array.from({ length: width }, () => []);
  for(const isle of islands ?? []){
    for(let x = Math.max(0, isle.from); x < Math.min(width, isle.to); x++){
      if(!sky[x].includes(isle.y)) sky[x].push(isle.y);
    }
  }
  return sky;
}

/* A level's teleporter pairs, flattened into one pad per end with each
   pointing at the other. Written out this way rather than searched as pairs
   because the question actually asked, every tick, for every duckling, is
   "is there a pad right here" — see padUnder. */
function buildPads(teleports){
  const pads = [];
  for(const t of teleports ?? []){
    const a = { x: t.ax, y: t.ay };
    const b = { x: t.bx, y: t.by };
    a.to = b; b.to = a;
    pads.push(a, b);
  }
  return pads;
}

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
    // Which of those decks were laid level rather than climbing, by height.
    // A parallel layer rather than a field on each deck for the same reason
    // `rock` and `rockBelow` are layers: everything that reads `decks` wants
    // a plain list of heights, and only one thing in the whole game asks
    // this question — see assignSkill, where standing on a level deck is
    // what sends the next ramp back up.
    flatDecks: Array.from({ length: level.width }, () => new Set()),
    // Where a wall is rock rather than dirt — see rockAt below and
    // content.js's header note on segments' `hard` field. `floors` (art.js's
    // drawGround) is not read anywhere in this file at all — nothing below a
    // column's surface is ever solid to begin with — but it is built here
    // rather than recomputed every frame, the same reasoning `terrain` is.
    rock: buildLayer(level.segments, 'hard', false, level.width),
    // The height rock starts at in a column that is only rock lower down —
    // see rockAt, and content.js's header note on `hardBelow`. null wherever
    // a column is all one thing.
    rockBelow: buildLayer(level.segments, 'hardBelow', null, level.width),
    floors: buildLayer(level.segments, 'floor', SCENE_H, level.width),
    // Every island surface standing at each column, in the same shape as
    // `decks` and for the same reason — a platform in the sky is a surface
    // as well as the ground, not instead of it, which is what leaves the
    // walkway underneath one walkable. See content.js's header note on
    // `islands`, and surfacesAt below, which stops caring which is which.
    sky: buildSky(level.islands, level.width),
    // Teleporter pads, flattened out of the level's pairs into one list a
    // lookup can scan — see padUnder. Two entries per pair, each pointing at
    // the other one.
    pads: buildPads(level.teleports),
    // How many times a duckling has been teleported, ever, and where the
    // flashes for the most recent ones are. The count is what the page
    // watches to know a zap wants playing (play.html); the flashes are what
    // art.js draws, the same way poofs work.
    warps: 0,
    zaps: [],
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

/* Everything at this column a duckling could be standing on: the terrain,
   the floor of a tunnel bored through it, any island hanging over it, and
   every ramp deck crossing it. Order is not meaningful — the callers below
   all pick out the one surface they want by height, because which surface
   is the right one depends entirely on where the duckling already is. A
   deck overhead is not ground to a duckling walking under it; the same deck
   is the only ground there is to the duckling walking along it. That is the
   whole reason this is a list, and it is why an island is a platform in the
   sky rather than a hole in the ground under it. */
const surfacesAt = (state, x) => {
  const col = columnAt(state, x);
  const out = [state.terrain[col]];
  // A tunnelled column has two floors, not one: the hillside still standing
  // over the hole (which is what art.js has always drawn — see content.js's
  // header note) and the tunnel's own floor inside it. Both are real
  // ground, and which one a duckling is on is decided the same way it is
  // decided for a ramp crossing a column: by where that duckling already
  // was. Tunnelling under a ledge used to quietly delete the ledge, which
  // was only ever invisible because nothing had walked along the top of a
  // hill it had also dug through.
  if(state.tunnelY[col] != null) out.push(state.tunnelY[col]);
  return out.concat(state.sky[col], state.decks[col]);
};

/* The teleporter pad this duckling is actually standing on, or null.
 *
 * Standing on, not merely passing the column of: a pad is a thing on a
 * surface, so a duckling walking the ground under an island does not trip
 * the pad sitting on top of the island above it. WALK_STEP is the same
 * tolerance the walking rules use for "this is the surface I am on", which
 * keeps a pad working where it is laid on a slope or a tread.
 */
function padUnder(state, d){
  for(const pad of state.pads){
    if(Math.round(d.x) !== pad.x) continue;
    if(Math.abs(d.y - pad.y) <= WALK_STEP) return pad;
  }
  return null;
}

const setTunnelAt = (state, x, y) => { state.tunnelY[columnAt(state, x)] = y; };

/* Adds a deck without disturbing any already standing at that column — see
   `decks` in newGame. A ramp laid across an older one leaves both. `flat`
   records which kind of run laid it, which is the only thing that tells a
   level stretch of ramp apart from a climbing one later on. */
const addDeckAt = (state, x, y, flat) => {
  const col = columnAt(state, x);
  const at = state.decks[col];
  if(!at.includes(y)) at.push(y);
  if(flat) state.flatDecks[col].add(y);
};

/* Which of a column's surfaces a duckling at `fromY` would actually step
 * onto, or null if none of them is anything but a wall to it.
 *
 * Anything within WALK_STEP either way is ordinary ground to step along, and
 * of those the highest wins: a duckling takes the step up when there is one.
 * That is what puts one walking the ground onto the foot of a ramp, and what
 * carries one coming down a ramp onto another crossing it the other way.
 *
 * Note what this does *not* do. A duckling is never lifted onto a deck more
 * than a step above it — a ramp overhead is not a candidate at all, and it
 * walks underneath. Getting onto a ramp always means walking up from the
 * foot, where the deck and the ground are within a step of each other, which
 * is also the only way a flock can follow one: nothing can see far enough
 * ahead to know it is going to need the ramp thirty columns later, so
 * boarding has to happen where the two meet or not at all. See The Grove,
 * which is built on exactly that.
 *
 * Failing that, the highest surface still beneath it is where it is headed,
 * which is what makes the ground under a ramp still count as ground. Only
 * when every surface here stands more than a step above is there nothing to
 * step onto at all — a wall.
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

/* Whether a tunnel cut through this column at height `y` would be cutting
   rock rather than dirt — see content.js's header note on segments' `hard`
   and `hardBelow` fields. `hard` is the whole column, top to bottom, the way
   The Aerie's rock face is. `hardBelow` is a height: rock from there down,
   dirt above it, which is a wall a Digger cannot get through at the level it
   is standing on but can at a level a ramp lifts it to. A column with
   neither is dirt all the way and diggable anywhere.

   A Digger already tunnelling re-checks this every column (see stepDigging),
   so a tunnel started in dirt runs into rock behind it and stops there. */
const rockAt = (state, x, y) => {
  const col = columnAt(state, x);
  if(state.rock[col]) return true;
  const floor = state.rockBelow[col];
  return floor != null && y > floor;
};

/* A planted Blocker standing in the way at this column, at about this
 * height. Height matters as soon as a level has more than one surface at a
 * column: a Blocker planted on an island is a duckling standing on an
 * island, and a ramp passing ninety pixels over its head is nothing to do
 * with it. Blocking the whole column was invisible for as long as every
 * blocker and everything it turned back stood on the same ground — The
 * Stepping Stones is the level where it stopped being, with the last ramp
 * of the climb crossing the column an earlier Blocker was holding.
 *
 * WALK_STEP of slack rather than an exact match, because a Blocker planted
 * on a ramp is on a slope: the deck under the duckling meeting it is a
 * pixel or two off the deck under the Blocker itself, and neither of them
 * would call that a different floor.
 */
const blockerAt = (state, x, y) =>
  state.ducks.some(d => d.state === 'blocking'
    && Math.round(d.x) === Math.round(x)
    && Math.abs(d.y - y) <= WALK_STEP);

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
  for(const z of state.zaps) z.age += 1;
  state.zaps = state.zaps.filter(z => z.age < ZAP_TICKS);
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
    if(blockerAt(state, x, g.y)){ state.goose.dir = -dir; state.goose.fed = true; return; }
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
    case 'jumping': return stepJumping(state, d);
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
    /* A Jumper goes over the top of it. The goose is a thing in the way of
       about the size of everything else a Jumper hops, and a duckling that
       can clear a ditch can clear a goose — it is the one hazard here that
       is answered by not being where it is for a moment. The hunt is not
       called off by a jump: nothing was caught, so the goose is still
       hunting whoever comes next, which is what makes a Jumper a thing you
       spend per duckling rather than once. */
    if(hasTrait(d, 'jumper') && startJump(state, d, true)) return;
    loseDuckling(state, d, 'goosed');
    // Ordinarily one catch is the whole hunt — see goosedAt above. A
    // relentless goose (content.js's goose.relentless) keeps hunting after
    // a catch instead, so only a Blocker calls it off; see stepGoose.
    if(!level.goose.relentless) state.goose.fed = true;
    return;
  }

  /* A teleporter under its feet, and this tick is spent going through it.
   *
   * The pad it arrives on is remembered rather than the pad it left, which
   * is the whole of what makes a two-way pair work: standing on the far pad
   * is not a fresh arrival, so nothing sends it back. Walking off clears it
   * (below), so coming back to that same pad later works exactly as it did
   * the first time. Direction is kept — a duckling comes out of the far pad
   * still going the way it was going, not turned around by the trip.
   */
  const pad = padUnder(state, d);
  if(pad){
    if(d.onPad !== pad){
      state.zaps.push({ x: pad.x, y: pad.y, age: 0 }, { x: pad.to.x, y: pad.to.y, age: 0 });
      state.warps += 1;
      d.x = pad.to.x;
      d.y = pad.to.y;
      d.onPad = pad.to;
      return;
    }
  } else if(d.onPad){
    d.onPad = null;
  }

  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ loseDuckling(state, d, 'edge'); return; }

  // A planted Blocker is a wall nothing gets past — the goose included, see
  // stepGoose — so any other duckling that steps into its column turns
  // around exactly the way it would at a wall it cannot climb.
  if(blockerAt(state, nextX, d.y)){ d.dir = -d.dir; return; }

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
    // A Jumper first, and only for a step low enough to hop onto — see
    // startJump. It is tried ahead of the other two because it costs the
    // flock nothing: a hop leaves the wall exactly as it was, so a duckling
    // that can hop a low step should, rather than spend a tunnel on it.
    if(hasTrait(d, 'jumper') && startJump(state, d)) return;
    if(!rockAt(state, nextX, d.y) && hasTrait(d, 'digger')){ d.state = 'digging'; d.digLeft = DIG_MAX_STEPS; return; }
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
     *
     * A Jumper does get a branch, for a ditch narrow enough to hop — see
     * startJump, which is where "narrow enough" is decided and which says no
     * to anything a Builder is actually for.
     */
    if(hasTrait(d, 'jumper') && startJump(state, d)) return;
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
 * it is not.
 *
 * And it comes down at a slant, not straight: FLY_DRIFT (content.js) a tick
 * in whichever direction it was already walking, so a flight reads as a
 * glide away from the ledge it left rather than a descent down a shaft. The
 * drift is refused wherever the column it would slide into has something
 * solid at the height the duckling is currently at — a flyer pinned against
 * a cliff face comes straight down it instead of sliding into the hillside
 * and landing on top of the thing it just fell off. A plain fall does not
 * drift at all: it is not flying, it is dropping.
 */
function stepFalling(state, d){
  const flying = hasTrait(d, 'flyer');
  const from = d.y;
  d.y += flying ? FLY_SPEED : FALL_SPEED;
  if(flying){
    const slid = d.x + d.dir * FLY_DRIFT;
    const intoGround = surfacesAt(state, slid).some(s => s < d.y);
    if(slid >= 0 && slid < state.level.width && !intoGround) d.x = slid;
  }
  if(d.y > SCENE_H){ loseDuckling(state, d, 'fell'); return; }
  /* What this tick actually fell past: a surface between where it started
   * the tick and where it has got to. Not simply everything at or above
   * where it is now — a column can have a platform in the sky over it, and
   * "anything above me" would have this duckling land on one it is falling
   * *away from*, twenty-four pixels over its head. (It really did: the
   * first cut of The Stepping Stones had ducklings stepping off the end of
   * a ramp and arriving safely on the island above it.) The band is a
   * tick's worth of falling, so nothing can be skipped through either.
   */
  const reached = surfacesAt(state, d.x).filter(s => s <= d.y && s >= from);
  if(reached.length){
    const ground = Math.min(...reached);
    const dropped = ground - d.fallFrom;
    d.y = ground;
    // Back onto a whole column as it touches down. Drift is the only thing
    // in this game that ever leaves a duckling between two of them, and a
    // flock walking on fractions of a column would be a quiet mess
    // everywhere something asks which column a duckling is standing in.
    d.x = columnAt(state, d.x);
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
 *
 * However it ends, the trait ends with it: a Digger is spent on the one
 * tunnel it cuts, whether that tunnel broke through, ran into rock or
 * simply ran out of the DIG_SECONDS clock (content.js) partway. So a wall
 * thicker than a tunnel is long does not fall to one Digger: the first
 * duckling stops inside the hill and walks back out of its own hole, and
 * going further means a second Digger given to a second duckling once that
 * one has walked in to where the cutting stopped — a relay, the same way
 * two Builders extend one ramp. It is also what makes "one duckling, one
 * wall" true rather than nearly true; a duckling that tunnelled here still
 * turns back at the next wall along.
 */
function endDig(d){
  d.state = 'walking';
  d.traits.delete('digger');
}

function stepDigging(state, d){
  const level = state.level;
  const nextX = d.x + d.dir;
  if(nextX < 0 || nextX >= level.width){ endDig(d); return; }
  if(rockAt(state, nextX, d.y)){ endDig(d); return; }

  if(groundAt(state, nextX) >= d.y){ endDig(d); return; }

  setTunnelAt(state, nextX, d.y);
  d.x = nextX;
  d.digLeft -= 1;
  if(d.digLeft <= 0) endDig(d);
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
  const y = d.buildLevel
    ? d.buildBaseY
    : d.buildBaseY - Math.round(step * BUILD_RISE_HEIGHT / BUILD_MAX_STEPS);

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

  addDeckAt(state, nextX, y, d.buildLevel);
  d.x = nextX;
  d.y = y;
  d.buildStep = step;
  if(d.buildStep >= BUILD_MAX_STEPS) d.state = 'walking';
}

/* Climbs until it reaches something to stand on — the first surface it comes
   up under, which over a column some ramp crosses is that ramp's deck rather
   than the wall top far above it. */
/* Can this duckling hop whatever is in front of it, and if so, set it going.
 * Returns whether it did, so the caller can fall through to everything else
 * when the answer is no.
 *
 * It looks for somewhere to land, one column at a time out to JUMP_SPAN, and
 * takes the first landing it finds: ground no more than JUMP_RISE above
 * where it stands, and no more than FALL_SAFE below — a hop is not a way to
 * survive a fall, which is a Flyer's job. Nothing within that reach means no
 * jump, and a ditch too wide or a wall too tall is left to whatever else the
 * duckling is carrying. That is what keeps this from quietly becoming a
 * cheaper Builder or a cheaper Climber: every real gap and every real wall in
 * the game is well outside it (see content.js's JUMP_SPAN and JUMP_RISE).
 *
 * Landing is checked against the same surfaces walking uses, so a Jumper can
 * land on a ramp deck as readily as on the ground.
 *
 * `preferFar` takes the longest landing rather than the nearest, which is
 * what the goose gets: over open ground the nearest landing is the very next
 * column, and hopping one column on the spot is not what clearing a goose
 * looks like. Terrain asks for the nearest instead — a low step should be a
 * short hop onto it, not a leap over it.
 */
function startJump(state, d, preferFar = false){
  const level = state.level;
  const spans = preferFar
    ? Array.from({ length: JUMP_SPAN }, (_, i) => JUMP_SPAN - i)
    : Array.from({ length: JUMP_SPAN }, (_, i) => i + 1);
  for(const span of spans){
    const x = d.x + d.dir * span;
    if(x < 0 || x >= level.width) continue;
    if(blockerAt(state, x, d.y)) continue;  // a planted Blocker stops a Jumper too
    for(const s of surfacesAt(state, x)){
      const rise = d.y - s;                 // positive: the landing is higher
      if(rise <= JUMP_RISE && rise >= -FALL_SAFE){
        d.state = 'jumping';
        d.jumpFromX = d.x; d.jumpFromY = d.y;
        d.jumpToX = x; d.jumpToY = s;
        d.jumpSpan = span;
        d.jumpStep = 0;
        return true;
      }
    }
  }
  return false;
}

/* The hop itself: a column a tick along a shallow arch from where it took off
 * to where it lands, cresting a little above the higher of the two ends so it
 * reads as clearing the thing rather than sliding over it. Nothing underneath
 * is consulted on the way — it is in the air, which is the whole point, and
 * `startJump` already picked somewhere real to come down. */
function stepJumping(state, d){
  d.jumpStep += 1;
  const t = d.jumpStep / d.jumpSpan;
  d.x = d.jumpFromX + d.dir * d.jumpStep;
  if(d.jumpStep >= d.jumpSpan){
    d.x = d.jumpToX;
    d.y = d.jumpToY;
    d.state = 'walking';
    return;
  }
  const line = d.jumpFromY + (d.jumpToY - d.jumpFromY) * t;
  d.y = Math.round(line - Math.sin(t * Math.PI) * (JUMP_RISE / 2));
}

function stepClimbing(state, d){
  d.y -= CLIMB_SPEED;
  /* Surfaces below the bottom of the scene are not things to climb onto —
     a gap's floor is set far under it on purpose (content.js's PIT_Y) and
     is a hole, not a ledge. Without this a Climber scaling anything that
     stands over open air would "reach" that floor on its very first tick
     and be dropped into the pit by the line below, which takes the lowest
     of everything the climb has passed. Nothing does that today; a level
     with a stepped island over a chasm would, and the level builder can
     draw one. */
  const reached = surfacesAt(state, d.x).filter(s => d.y <= s && s < SCENE_H);
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
 * Digger, Climber, Flyer and Jumper are the deferred ones, held until the
 * duckling actually meets the thing each answers, which is what stepWalking
 * checks for on every step. A duckling can hold several at once, and that
 * stacking is not a nicety — a duckling that dug through one wall still
 * turns back at a second one without a fresh Digger, and Climber is the only
 * thing that would get it there instead. Where more than one could answer
 * the same obstacle, stepWalking's order decides: a Jumper hops a low step
 * before a Digger would tunnel it, because a hop costs the flock nothing and
 * a tunnel is spent.
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
    /* A ramp climbs or runs level depending entirely on what this duckling
     * is standing on, and the three cases alternate:
     *
     *   the ground, or an island   climb BUILD_RISE_HEIGHT
     *   a climbing ramp's deck     run level
     *   a level ramp's deck        climb again
     *
     * so a chain of Builders is a staircase — up, along, up, along — rather
     * than either one endless climb or one endless shelf. The level run in
     * the middle is what makes the climb safe to build: the far end of any
     * ramp is a ledge everything behind it has to step off, and each climb
     * puts BUILD_RISE_HEIGHT between the deck and whatever it started from.
     * Alternating means a player is never more than one climb's worth above
     * the last flat thing while the next segment goes in, and it is what
     * turns a handful of Builders into real height — The Stepping Stones is
     * built on exactly that, seventy pixels of it.
     *
     * A duckling standing on an island is on neither kind of deck, so it
     * climbs: an island is ground, and a ramp off one starts a fresh
     * staircase rather than continuing the one that got it up there.
     */
    const col = columnAt(state, d.x);
    const onDeck = state.decks[col].includes(d.y);
    d.buildLevel = onDeck && !state.flatDecks[col].has(d.y);
    return d;
  }
  // digger, climber, flyer, jumper: stay 'walking' until the right hazard
  // asks for them.
  d.traits.add(skill);
  return d;
}

/* Send a planted Blocker on its way again: it stops blocking and carries on
 * walking, in the direction it was facing when it was planted. Returns the
 * duckling, or null if that one was not a Blocker to begin with.
 *
 * Nothing is refunded. The Blocker is still spent — this is a Blocker
 * finishing its job rather than a Blocker being taken back — so a flock held
 * at a ledge while the bridge goes in can be let go the moment it is safe,
 * and that costs the same one Blocker it always did. Which matters because
 * the alternative was that it cost a duckling too: before this, planting one
 * meant that duckling stood there for the rest of the level and never
 * reached the pond. Now it can be part of the quota it was holding back.
 */
export function releaseBlocker(state, duckId){
  if(state.ended) return null;
  const d = state.ducks.find(duck => duck.id === duckId);
  if(!d || d.state !== 'blocking') return null;
  d.state = 'walking';
  return d;
}

/* Duckling at a point on screen, nearest first, or null. What a click on the
   scene resolves to — ducklings already saved or already lost are not
   candidates, so a click near one of those picks the one next to it instead
   of doing nothing. A planted Blocker very much is a candidate: clicking one
   is how it gets released (see releaseBlocker). */
export function duckNear(state, x, y, radius = 10){
  let best = null, bestDist = Infinity;
  for(const d of state.ducks){
    if(d.state === 'saved' || d.state === 'lost') continue;
    const dist = Math.hypot(d.x - x, d.y - y);
    if(dist <= radius && dist < bestDist){ best = d; bestDist = dist; }
  }
  return best;
}
