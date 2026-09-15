/* Duck Duck Quack — the game as data.
 *
 * A duckling hatches at the nest and walks forward on its own, turning around
 * at anything too tall to step over and falling if the ground drops away too
 * far. You assign each one a skill as it passes: Dig, Build, Block or Climb.
 * Get enough of them to the pond before the clock runs out.
 *
 * Everything below is data and pure functions over it — no DOM, no clock, no
 * randomness — so sim.js can be driven from a test with no browser anywhere
 * near it, the way the other single-player games here are.
 *
 * --- Terrain is a heightmap, not a bitmap -----------------------------------
 *
 * One number per column: how far down the ground is. A "wall" is a big jump
 * between two neighbouring columns, a "gap" is a run of columns set far below
 * the screen (so far that the fall is always lethal), and a "bridge" or a
 * "dig" is sim.js overwriting a run of those numbers in place. There is no
 * layer below the surface — nothing is ever solid *above* a column that is
 * open at that height — which is a real simplification against a level with
 * true tunnels, and it is the one this slice is built around.
 */

export const SCENE_W = 320;
export const SCENE_H = 180;

/* How far down "the floor of the world" is set for a gap: far enough that
   falling into one is always past FALL_SAFE, however tall the level's tallest
   platform is, and finite so the fall arithmetic never has to special-case
   infinity. */
export const PIT_Y = SCENE_H + 60;

/* ------------------------------------------------------------- the physics */

/* Simulation steps a second — the one knob that sets how fast the whole
   level plays out in real time, since every distance below (a wall's
   height, the width of a gap, how far a duckling walks) is stated in plain
   game units and only turns into wall-clock speed by way of this number.
   Lower, and the exact same tick-for-tick level takes longer to watch and
   longer to react to, with no other constant needing to move to match —
   spawnInterval and timeLimit are already stated as `TICK_RATE * seconds`
   rather than as bare tick counts, precisely so this could be the only
   thing that ever needs tuning for pace. Was 20; a duckling walking the
   whole way to the pond with no obstacles at all went from about 15
   seconds to about 21. */
export const TICK_RATE = 14;
export const WALK_SPEED = 1;           // columns a walking duckling covers a tick
export const FALL_SPEED = 3;           // pixels a falling duckling drops a tick
export const CLIMB_SPEED = 1;          // pixels a climbing duckling rises a tick
export const DIG_RATE = 2;             // pixels a digger deepens its column a tick

/* A step this tall or shorter is just the ground changing height under a
   walking duckling — up or down, no different than the last column. Taller
   than this going up and it is a wall; taller than this going down and it is
   a fall. */
export const WALK_STEP = 4;

/* The longest drop a duckling walks away from. Past this and a fall the level
   otherwise leaves alone is a duckling lost, so a platform's far edge always
   has to be either shorter than this or handled some other way (a dig, a
   bridge, a gentle staircase). */
export const FALL_SAFE = 24;

/* How many columns a Builder will lay before giving up — a safety cap, not a
   number any level here is tuned to reach. Building stops the moment it finds
   solid ground, so a builder assigned right at a gap's edge stops well short
   of this. */
export const BUILD_MAX_STEPS = 60;
export const DIG_MAX_STEPS = 60;

/* ------------------------------------------------------------------ skills */

export const SKILLS = ['digger', 'builder', 'blocker', 'climber'];

export const SKILL_INFO = {
  digger: { name: 'Digger', verb: 'Dig',
    blurb: 'Cuts a gentle ramp forward and down until the ground catches up.' },
  builder: { name: 'Builder', verb: 'Build',
    blurb: 'Lays a flat plank bridge forward until it reaches solid ground.' },
  blocker: { name: 'Blocker', verb: 'Block',
    blurb: 'Plants itself for good. Anything that walks into it turns around.' },
  climber: { name: 'Climber', verb: 'Climb',
    blurb: 'Scales the next wall instead of turning back from it.' },
};

/* ----------------------------------------------------------------- terrain */

/* A level's terrain, expanded from a short list of segments into one height
 * per column. Segments are read in order and the last one to claim a column
 * wins, which is only ever used to leave a gap's neighbours exactly as they
 * were rather than repeating them.
 */
export function buildTerrain(segments, width = SCENE_W){
  const terrain = new Array(width);
  for(const { from, to, y } of segments){
    for(let x = Math.max(0, from); x < Math.min(width, to); x++) terrain[x] = y;
  }
  return terrain;
}

/* --------------------------------------------------------------- the level */

/* "The Park": nest, a gap, a wall, a drop, a goose, a pond. One of each
 * obstacle a duckling can meet, in the order a first level should teach them.
 *
 * Building and digging change the terrain in place and stay changed for every
 * duckling after the one that did it — bridge the gap once and the whole
 * flock walks across it. Climbing does not: a wall is still a wall for the
 * next duckling, which is why the climber supply below is sized for most of
 * the flock rather than for one.
 */
export const LEVEL_1 = {
  id: 'park',
  name: 'The Park',
  width: SCENE_W,
  height: SCENE_H,

  /* [0, 70)    flat ground out of the nest
     [70, 105)  the gap — 35 columns of pit, wants a Builder
     [105, 150) flat ground up to the wall
     [150, 220) the wall and the plateau on top of it — wants a Climber
     [220, 260) flat ground again, one column lower than the plateau — the
                50px step down from it wants a Digger, or it is a lethal fall
     [260, 300) the goose's beat — no terrain trouble, just the goose
     [300, 320) the pond */
  segments: [
    { from: 0, to: 70, y: 150 },
    { from: 70, to: 105, y: PIT_Y },
    { from: 105, to: 150, y: 150 },
    { from: 150, to: 220, y: 100 },
    { from: 220, to: 320, y: 150 },
  ],

  nestX: 6,
  goalX: 300,

  duckCount: 10,
  spawnInterval: TICK_RATE * 2,     // one every two seconds
  timeLimit: TICK_RATE * 120,       // two minutes
  winRatio: 0.8,

  /* Generous on purpose — this is the first level anyone will ever play, and
     the point of it is to feel the four skills work, not to run out of them.
     Climber is the one every duckling that crosses the wall needs its own
     copy of, so it is sized to the save quota with one to spare; the other
     three only ever need to fire once each, plus a spare. */
  supply: { digger: 2, builder: 2, blocker: 2, climber: 9 },

  /* Patrols the near half of the pond's approach. `speed` is columns a tick,
     `catchRadius` is how close a duckling has to be to it, in columns, to get
     goosed — but only the first duckling it manages to catch; see sim.js's
     `goose.fed`. A hazard that can pick off the whole flock every time a
     level is played the same way twice is not a hazard, it is a tax, and
     with the flock walking in evenly-spaced lockstep the whole way here,
     "only when nearby" alone would have been exactly that: either every
     duckling's crossing lines up with the goose's sweep, or none of them do. */
  goose: { x0: 260, x1: 299, y: 150, speed: 1.5, catchRadius: 1.5 },
};

export const LEVELS = [LEVEL_1];

export const winCount = level => Math.ceil(level.duckCount * level.winRatio);

/* ------------------------------------------------------------------ format */

export function formatTime(ticks){
  const s = Math.max(0, Math.ceil(ticks / TICK_RATE));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
