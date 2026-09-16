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
 * the screen (so far that the fall is always lethal). `terrain` itself is
 * never touched once a level starts — a Digger and a Builder each write into
 * their own second layer instead (`tunnelY`, `bridgeY` in sim.js's game
 * state), one number per column same as `terrain`, consulted first wherever
 * it is not null. That is what lets a dig leave the wall standing — a bored
 * hole through it, the wall still overhead — instead of quietly bulldozing
 * the whole column down to head height, and what lets a bridge leave the gap
 * still open underneath the deck instead of the pit just filling in with
 * dirt. See sim.js's groundAt for the one place all three ever get read
 * together.
 *
 * A segment can carry two more things besides its height, both optional and
 * both expanded the same way `y` is (see buildLayer):
 *
 *   hard    true for a stretch of actual rock rather than dirt — a wall a
 *           Digger cannot start a tunnel into at all (see sim.js's rockAt).
 *           Climbing it works exactly as it would anywhere else; only
 *           digging is refused. Nothing about a plain wall changes when
 *           this is left off, which is every wall before The Aerie.
 *   floor   how far down a segment's own ground actually reaches, for a
 *           stretch that does not go all the way to the bottom of the scene
 *           the way every other column does — an island sitting in open air
 *           rather than a plateau standing on more ground underneath it.
 *           Left off, a segment fills to the bottom of the scene same as
 *           always. This is purely what art.js draws: nothing below a
 *           column's surface height is ever solid to begin with (see
 *           groundAt again), so leaving it off changes no duckling's path.
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
   thing that ever needs tuning for pace. Was 20, then 14; a duckling
   walking the whole way to the pond with no obstacles at all has gone from
   about 15 seconds to about 21 to about 27. */
export const TICK_RATE = 11;
export const WALK_SPEED = 1;           // columns a walking duckling covers a tick
export const FALL_SPEED = 3;           // pixels a falling duckling drops a tick
export const CLIMB_SPEED = 1;          // pixels a climbing duckling rises a tick

/* A Flyer comes down at a third of the speed and lands from any height at
   all — the drop that FALL_SAFE would otherwise make lethal included. Slow
   enough that the wingbeats are plainly what is saving it, rather than a
   fall that happens to end well. */
export const FLY_SPEED = 1;            // pixels a flying duckling descends a tick

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

/* How many columns a Builder will lay, or a Digger will cut, before giving
   up — a safety cap, not a number any level here is tuned to reach. Both
   stop the moment the ground ahead makes them unnecessary, so one assigned
   right at the obstacle's edge stops well short of this. */
export const BUILD_MAX_STEPS = 60;
export const DIG_MAX_STEPS = 60;

/* How far a Builder's deck rises at the crest of its arch — see sim.js's
   stepBuilding. Well under WALK_STEP even spread over a short gap, so the
   climb to the crest is never itself a "wall" a walking duckling without
   the trait would refuse: the whole point is a bridge everyone can just
   walk across once it's there. */
export const BRIDGE_ARCH_HEIGHT = 10;

/* Once the goose has caught its one duckling (see sim.js's `goose.fed`) it
   has nothing left to threaten, so rather than leave it patrolling the same
   stretch forever as an empty prop, it flies off — the same direction it was
   already facing, climbing as it goes — and stops being drawn once it clears
   the scene. Faster than its patrol speed on purpose: a fleeing goose should
   read as fleeing, not as the same lazy sweep with nothing to show for it. */
export const GOOSE_FLEE_SPEED = 4;     // columns a fleeing goose covers a tick
export const GOOSE_FLEE_LIFT = 2;      // pixels a fleeing goose climbs a tick

/* A lost duckling — fallen too far, walked off the level's edge, or caught
   by the goose — leaves a short-lived poof where it went down. Without one,
   a duckling that had been visibly falling for a second or more simply
   isn't there the next frame, which reads as a rendering fault rather than
   as the loss it actually is. `sim.js` owns spawning and ageing these;
   `art.js` only ever draws whatever is left in `state.poofs`. */
export const POOF_TICKS = 8;

/* ------------------------------------------------------------------ skills */

/* Three of these change the ground itself and so are spent once for the
 * whole flock; two ride on the duckling that holds them and have to be given
 * out again to the next one. Which kind a skill is matters more to how a
 * level plays than what it does:
 *
 *   Digger, Builder   cut or lay ground, and every duckling after walks it
 *   Blocker           plants one duckling for good, a wall nothing gets
 *                     past — another duckling or the goose alike, see
 *                     sim.js's stepWalking and stepGoose
 *   Climber, Flyer     carry one duckling past one obstacle, once
 */
export const SKILLS = ['digger', 'builder', 'blocker', 'climber', 'flyer'];

export const SKILL_INFO = {
  digger: { name: 'Digger', verb: 'Dig',
    blurb: 'Tunnels straight through the next wall, leaving a way through for the rest.' },
  builder: { name: 'Builder', verb: 'Build',
    blurb: 'Bridges the next gap, leaving the bridge for the rest.' },
  blocker: { name: 'Blocker', verb: 'Block',
    blurb: 'Plants itself for good, turning back anything that meets it — another duckling, or the goose.' },
  climber: { name: 'Climber', verb: 'Climb',
    blurb: 'Scales the next wall instead of turning back from it. One duckling only.' },
  flyer: { name: 'Flyer', verb: 'Fly',
    blurb: 'Flaps down to a soft landing from any height. One duckling only.' },
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

/* The same column-by-column expansion buildTerrain does for `y`, generalised
 * to any other per-segment field a level wants to carry — `hard` for a
 * segment of rock (see sim.js's rockAt) and `floor` for a segment that does
 * not reach all the way to the bottom of the scene (see art.js's drawGround)
 * both ride on this rather than getting their own copy of the same loop.
 * A segment that does not set the field at all leaves `fallback` standing
 * for every column it claims — unlike buildTerrain's `y`, which every
 * segment always sets, most segments have nothing to say about `hard` or
 * `floor`, and a plain wall or a plain gap should not have to write
 * `hard: false` just to say so.
 */
export function buildLayer(segments, field, fallback, width = SCENE_W){
  const layer = new Array(width).fill(fallback);
  for(const seg of segments){
    if(!(field in seg)) continue;
    for(let x = Math.max(0, seg.from); x < Math.min(width, seg.to); x++) layer[x] = seg[field];
  }
  return layer;
}

/* --------------------------------------------------------------- the level */

/* "The Park": nest, a gap, a wall, a drop, a goose, a pond.
 *
 * Three obstacles, and deliberately one of each kind of answer. The gap is
 * solved once and stays solved — one Builder lays a bridge the whole flock
 * walks over. The wall and the drop are not: a Climber gets one duckling up
 * and a Flyer gets one duckling down, and the next duckling arrives at an
 * obstacle exactly as tall as the first one found it. That is why those two
 * supplies are sized for most of the flock while the builder supply is two.
 *
 * No Diggers here at all. A Digger tunnels through a wall, which would make
 * the wall a solved-once obstacle like the gap — worth meeting, but not on
 * the level that exists to teach that some things have to be paid for one
 * duckling at a time. The skill is still on the page, at zero, so it reads
 * as something held back rather than something missing.
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
     [220, 260) flat ground again, well below the plateau — the 50px step
                down from it wants a Flyer, or it is a lethal fall
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
  /* Two minutes wasn't enough — not for the sim, which clears this with
     room to spare (see the balance harness), but for a person: slowing the
     ducks down (TICK_RATE 14 -> 11) made the walk itself take longer in
     real seconds, and on top of that a real player has to notice each
     hazard coming and click the right skill on the right duckling, up to
     nine times over for Climber and again for Flyer. Three and a half
     minutes gives that room without turning the level into a wait. */
  timeLimit: TICK_RATE * 210,       // three and a half minutes
  winRatio: 0.8,

  /* Generous on purpose — this is the first level anyone will ever play, and
     the point of it is to feel the skills work, not to run out of them.
     Climber and Flyer are the two every crossing duckling needs its own
     copy of, so both are sized to the save quota with one to spare. Builder
     only ever needs to fire once, plus a spare. Digger is zero: see the
     level's note above. */
  supply: { digger: 0, builder: 2, blocker: 2, climber: 9, flyer: 9 },

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

/* "The Warren": a gap, then two walls, then the goose and the pond — the
 * same vocabulary as The Park, but Climber and Flyer are both zero here.
 * Every wall has to be tunnelled, not climbed, which is what a warren is.
 *
 * That makes Digger strictly necessary rather than merely available: there
 * is no other way past either wall, and since a tunnel — like a bridge —
 * changes the terrain itself, one successful dig through each is permanent
 * for the whole flock behind it. Two walls, two required digs; the supply
 * below carries one spare on top of that, the same margin Builder gets for
 * its one gap.
 *
 * Blocker is not required the way Digger is here — the goose only ever
 * threatens the one duckling unlucky enough to be near it when it catches
 * someone (see sim.js's goosedAt), and this level's quota already has slack
 * to spare that one. It is on this level for the same reason it is on The
 * Park: a duckling can be planted, and whatever meets it — a sibling or the
 * goose alike (see sim.js's stepWalking and stepGoose) — turns back. Worth
 * being careful with, not just generous with: planted anywhere on the one
 * road out of the nest, it is a wall for the rest of the flock too.
 */
export const LEVEL_2 = {
  id: 'warren',
  name: 'The Warren',
  width: SCENE_W,
  height: SCENE_H,

  /* [0, 40)    flat ground out of the nest
     [40, 65)   the gap — 25 columns of pit, wants a Builder
     [65, 120)  flat ground up to the first wall
     [120, 165) the first wall — 45 columns tall enough that only a tunnel
                gets through it; there is no Climber supply on this level
     [165, 220) flat ground between the two walls
     [220, 260) the second wall — shorter, but the same deal
     [260, 300) the goose's beat
     [300, 320) the pond */
  segments: [
    { from: 0, to: 40, y: 150 },
    { from: 40, to: 65, y: PIT_Y },
    { from: 65, to: 120, y: 150 },
    { from: 120, to: 165, y: 70 },
    { from: 165, to: 220, y: 150 },
    { from: 220, to: 260, y: 90 },
    { from: 260, to: 320, y: 150 },
  ],

  nestX: 6,
  goalX: 300,

  /* Twelve hatch, nine needed — three more than the quota, on purpose:
     real slack, the same reason The Park's own quota carries a duckling or
     two of margin. */
  duckCount: 12,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 240,       // four minutes — two hazards need solving, not nine crossings
  winRatio: 0.75,

  /* Digger: one spare over the two required digs. Builder: one spare over
     its one required bridge. Climber and Flyer: zero — this level's whole
     point is that the wall gets tunnelled, not climbed. Blocker: present,
     same as everywhere else, with nothing here that calls for it (see the
     note above). */
  supply: { digger: 3, builder: 2, blocker: 2, climber: 0, flyer: 0 },

  goose: { x0: 260, x1: 299, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Orchard": a gap, a wall, then a drop that has nothing to do with the
 * wall at all — the first level where a wall genuinely can be answered
 * either way, Climber or Digger, and the first fact worth knowing about
 * that choice is that they are not equivalent afterward.
 *
 * A wall's "far side" is really two different things depending on how it
 * was crossed. Dig it, and the tunnel holds the digging duckling's own
 * height the whole way through — cut down to nest level, there is no climb
 * and so nothing to come back down from either, and every duckling behind
 * it just walks through flat ground that used to be a wall. Climb it, and
 * the duckling is still standing at the wall's own elevation when the
 * plateau runs out, which is its own small drop back down — survivable
 * here (see the segments below), but real, and Digger quietly skips it.
 *
 * That asymmetry does not extend to the second hazard, on purpose: the
 * drop past the buffer at column 165 sits far enough past the wall — more
 * than DIG_MAX_STEPS beyond where the wall's own tunnel could reach, even
 * cut at full length — that no dig started at the wall can run into it.
 * Whichever way the wall was crossed, every duckling reaches that drop on
 * its own two feet, at a height only Flyer answers. Confirmed by actually
 * running it four ways: digger-and-flyer, climber-and-flyer, no-builder,
 * and no-flyer-at-all all come out exactly as their names say they should.
 *
 * And the pond itself sits apart from everything before it — a second gap,
 * right at the end, with the pond on the far side of it rather than just
 * more of the same ground. Bridged the same way the first one is, with the
 * same Builder, so the level's one new idea is not a new skill, just the
 * same one asked for twice: the last thing standing between a duckling and
 * the water is not the goose, it is one more span of open air. The goose's
 * beat ends right at that gap's edge rather than reaching over it — a
 * hazard that guarded a rock its patrol could not stand on would be
 * guarding something it can never actually threaten.
 */
export const LEVEL_3 = {
  id: 'orchard',
  name: 'The Orchard',
  width: SCENE_W,
  height: SCENE_H,

  /* [0, 35)    flat ground out of the nest
     [35, 55)   the gap — 20 columns of pit, wants a Builder
     [55, 85)   flat ground up to the wall
     [85, 130)  the wall — 45 columns, short enough to dig in one go with
                room to spare, but Climber answers it just as well
     [130, 165) flat ground the far side of the wall — long enough that a
                dig started at column 85 always runs out inside it
     [165, 290) a real drop, 25 columns past where any wall-tunnel could
                possibly still be cutting, and the goose's beat after it
     [290, 300) the second gap — 10 columns of open air with nothing below,
                same as the first, wants a second Builder
     [300, 320) the floating rock the pond sits on, its own island the far
                side of that gap */
  segments: [
    { from: 0, to: 35, y: 150 },
    { from: 35, to: 55, y: PIT_Y },
    { from: 55, to: 85, y: 150 },
    { from: 85, to: 130, y: 100 },
    { from: 130, to: 165, y: 150 },
    { from: 165, to: 290, y: 175 },
    { from: 290, to: 300, y: PIT_Y },
    { from: 300, to: 320, y: 175 },
  ],

  nestX: 6,
  goalX: 300,

  /* Twelve hatch, nine needed — the same margin The Orchard's neighbours
     carry, not a tighter one; the escalation here is in what a run asks of
     a player, not in how little room it leaves for one. */
  duckCount: 12,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 240,       // four minutes

  winRatio: 0.75,

  /* Climber and Digger both fully supplied — a real choice for the wall,
     not a rationed one. Flyer generous too: it is needed regardless of
     that choice (see the note above), so there is no reason to make it
     scarce on top of being mandatory. Builder: two required bridges now,
     not one, so the spare moves with it — one over two, same margin as
     everywhere else, not the same raw number. Blocker: present, same as
     everywhere else, with nothing on this level that calls for it. */
  supply: { digger: 3, builder: 3, blocker: 2, climber: 11, flyer: 11 },

  goose: { x0: 250, x1: 289, y: 175, speed: 1.5, catchRadius: 1.5 },
};

/* "The Grove": nest and pond both sit somewhere new — the first level not
 * built around the same 6-to-300 walk every other one shares. Otherwise the
 * same vocabulary as The Warren: a gap wants a bridge, a wall wants a
 * tunnel, and both are solved-once obstacles the whole flock walks through
 * behind whichever duckling answers them first.
 *
 * Blocker is present, same as everywhere else, and genuinely does two
 * things now rather than one (see content.js's SKILL_INFO) — but that is
 * exactly why it is worth being careful with here rather than reached for:
 * this level is one straight road from nest to pond with nothing beside it,
 * so a duckling planted anywhere on it, to hold the goose off, is a wall
 * for the rest of the flock too. Turning the goose back is real, but the
 * honest use of it on a level shaped like this one is the same as The
 * Warren's — a duckling can be planted, without anything here actually
 * asking for it.
 */
export const LEVEL_4 = {
  id: 'grove',
  name: 'The Grove',
  width: SCENE_W,
  height: SCENE_H,

  /* [0, 50)    flat ground out of the nest
     [50, 78)   the gap — 28 columns of pit, wants a Builder
     [78, 130)  flat ground up to the wall
     [130, 175) the wall — 45 columns, tunnelled the same way The Warren's
                are; there is no Climber supply on this level either
     [175, 320) flat ground the rest of the way, the goose's beat somewhere
                inside it, and the pond at the end of it */
  segments: [
    { from: 0, to: 50, y: 150 },
    { from: 50, to: 78, y: PIT_Y },
    { from: 78, to: 130, y: 150 },
    { from: 130, to: 175, y: 90 },
    { from: 175, to: 320, y: 150 },
  ],

  /* Neither number reused from The Park, The Warren or The Orchard. */
  nestX: 16,
  goalX: 288,

  /* Twelve hatch, nine needed — the same margin The Warren carries for the
     same shape of level. */
  duckCount: 12,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 240,       // four minutes
  winRatio: 0.75,

  /* Digger and Builder: one spare apiece over their one required use, same
     margin as everywhere else. Climber and Flyer: zero — the wall is
     tunnelled, not climbed, and nothing here falls. Blocker: present,
     without a winning use, same as The Warren. */
  supply: { digger: 3, builder: 2, blocker: 2, climber: 0, flyer: 0 },

  goose: { x0: 200, x1: 239, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Aerie": the pond is not on the ground at all. Past the usual gap, a
 * rock face — not a wall of dirt, actual rock (segments' `hard`, see
 * content.js's header note) — stands a hundred pixels tall, and a Digger
 * cannot start a tunnel into it no matter how many are handed out. Climbing
 * it works exactly the way climbing anything else does; digging is the one
 * thing rock refuses, confirmed by actually running a digger-only flock
 * into it rather than just reasoning about it (see
 * test/duck-duck-quack.test.js) — every one of them turns back at the face
 * and none ever reach the pond.
 *
 * The far side of that climb is not a landing, it is a ledge: a second gap,
 * with nothing under it but the rest of the drawn scene, wants a second
 * Builder the same way the first one did. What is on the other side of that
 * one is a floating island — a segment with a `floor` (see content.js's
 * header note again), a slab of ground with open air under it rather than
 * more ground standing on more ground the way every rise in every other
 * level here does — and the pond sits on top of it.
 *
 * The goose keeps its usual beat, just moved up onto the island with
 * everything else: it was never the thing guarding the height, the rock
 * was, and a hazard that cannot be reached until the real climb is already
 * behind a duckling is not adding anything by also being up there guarding
 * the last stretch. It works exactly the way it does everywhere else —
 * present, one bite, done.
 */
export const LEVEL_5 = {
  id: 'aerie',
  name: 'The Aerie',
  width: SCENE_W,
  height: SCENE_H,

  /* [0, 40)    flat ground out of the nest
     [40, 65)   the gap — 25 columns of pit, wants a Builder
     [65, 120)  flat ground up to the rock
     [120, 165) the rock — 45 columns, a hundred pixels of actual rock
                (`hard`); Digger cannot start a tunnel into it at all
     [165, 180) a short ledge at the top of the climb
     [180, 200) the second gap — open air over the rest of the scene, wants
                a second Builder
     [200, 320) the floating island (`floor: 85`, open air under the slab)
                the goose's beat somewhere inside it, and the pond at the
                end of it */
  segments: [
    { from: 0, to: 40, y: 150 },
    { from: 40, to: 65, y: PIT_Y },
    { from: 65, to: 120, y: 150 },
    { from: 120, to: 165, y: 50, hard: true },
    { from: 165, to: 180, y: 50 },
    { from: 180, to: 200, y: PIT_Y },
    { from: 200, to: 320, y: 50, floor: 85 },
  ],

  nestX: 6,
  goalX: 280,

  duckCount: 10,
  spawnInterval: TICK_RATE * 2,
  /* Five minutes rather than the usual three and a half to four — the climb
     alone is a hundred ticks at CLIMB_SPEED for every duckling that makes
     it, on top of everything else, and that time is spent once per
     duckling, not once for the whole flock the way a dig or a bridge is. */
  timeLimit: TICK_RATE * 300,
  winRatio: 0.7,

  /* Climber: nine for ten hatchlings, the same margin The Park gives its own
     mandatory Climber. Digger: a small honest supply rather than zero — it
     is on the page so a player who reaches for it out of habit discovers
     rock refuses it, rather than never getting the chance to find out.
     Builder: one spare over its two required bridges. Flyer: zero, nothing
     here falls. Blocker: present, without a winning use, same as
     everywhere else. */
  supply: { digger: 2, builder: 3, blocker: 2, climber: 9, flyer: 0 },

  goose: { x0: 240, x1: 279, y: 50, speed: 1.5, catchRadius: 1.5 },
};

export const LEVELS = [LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5];

export const winCount = level => Math.ceil(level.duckCount * level.winRatio);

/* ------------------------------------------------------------------ format */

export function formatTime(ticks){
  const s = Math.max(0, Math.ceil(ticks / TICK_RATE));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
