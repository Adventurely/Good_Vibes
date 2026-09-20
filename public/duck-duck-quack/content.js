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
 * never touched once a level starts — a Digger and a Builder each leave their
 * mark somewhere else instead (`tunnelY` and `decks` in sim.js's game state).
 * A tunnel is one height per column, consulted in the terrain's place wherever
 * it is not null, which is what lets a dig leave the wall standing — a bored
 * hole through it, the wall still overhead — rather than quietly bulldozing
 * the whole column down to head height.
 *
 * A ramp is not a height for the column at all, it is a deck standing over
 * it, and a column can carry several: ramps cross, and crossing leaves both
 * whole. So the gap stays open underneath a ramp instead of filling in with
 * dirt, the ground under one is still ground to walk along, and which of a
 * column's surfaces a duckling is on depends on where that duckling already
 * was. See sim.js's surfacesAt and stepTargetAt, which is where all of that
 * is actually decided.
 *
 * A segment can carry three more things besides its height, all optional and
 * all expanded the same way `y` is (see buildLayer):
 *
 *   hard    true for a stretch of actual rock rather than dirt — a wall a
 *           Digger cannot start a tunnel into at all (see sim.js's rockAt).
 *           Climbing it works exactly as it would anywhere else; only
 *           digging is refused. Nothing about a plain wall changes when
 *           this is left off, which is every wall before The Aerie.
 *   hardBelow  the height rock starts at in a column that is dirt above and
 *           stone below, for a wall a Digger can only get through over the
 *           top of the seam. `hard` is a whole column of rock; this is a
 *           band of it with diggable ground on top — see The Grove.
 *   floor   how far down a segment's own ground actually reaches, for a
 *           stretch that does not go all the way to the bottom of the scene
 *           the way every other column does — an island sitting in open air
 *           rather than a plateau standing on more ground underneath it.
 *           Left off, a segment fills to the bottom of the scene same as
 *           always. This is purely what art.js draws: nothing below a
 *           column's surface height is ever solid to begin with (see
 *           groundAt again), so leaving it off changes no duckling's path.
 *
 * Two things a level carries that are not segments at all:
 *
 *   islands  platforms in the sky, each { from, to, y, floor }, standing
 *           over whatever the terrain underneath them happens to be. A
 *           segment cannot be one: `terrain` is one height per column, so a
 *           segment drawn up in the air would take the ground out from
 *           under itself and there would be nothing left to walk along
 *           below it. An island is a surface *as well as* the ground, the
 *           same way a ramp's deck is (see sim.js's surfacesAt), which is
 *           what lets a level open with a walkway running underneath one.
 *           Getting up onto one is a real problem and meant to be: a
 *           Builder's ramp climbs BUILD_RISE_HEIGHT and no further, so
 *           anything higher than that wants a teleporter, or a nest that is
 *           already up there.
 *   teleports  pairs of pads, each { ax, ay, bx, by }: two columns, and the
 *           height the pad stands at in each. A duckling that walks onto
 *           either pad comes out of the other one still facing the way it
 *           was going — the one thing in this game that moves a duckling
 *           somewhere its own two feet could not have carried it. Both ends
 *           work, and one that has just arrived has to walk off the pad
 *           before it can use it again, so a pair is a way through rather
 *           than a duckling bouncing between two pads forever. See sim.js's
 *           padUnder.
 *
 * And one more thing a level can say about its nest:
 *
 *   hatchDir  which way a duckling faces as it steps out, for a nest where
 *           that is not simply "towards the pond" (see goalHeading). The
 *           Spire's sits on top of the spire with the pond away to the
 *           right and the only way down to the left, so its hatchlings
 *           leave heading away from the water on purpose.
 */

/* Shown on the page itself (play.html's header, index.html's footer) so a
   player — or anyone checking that a change actually shipped — can read
   straight off the page whether they have the latest build, rather than
   having to guess from behavior alone. Bump it on every change that ships,
   however small. */
export const GAME_VERSION = '1.30';

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

/* And it does not come down in a straight line. A flying duckling drifts
   this far a tick in whichever direction it was already walking when it went
   over the edge, so a flight reads as a glide away from the ledge rather
   than a lift descending a shaft. Kept small on purpose — at a third of
   FLY_SPEED it is about eighteen degrees off vertical, which is plainly a
   slant without ever being a way to cross ground a Builder is for. Over the
   tallest drop in the game (The Spire's ledge, a hundred and twenty pixels)
   it carries a duckling forty columns; over an ordinary one, a handful.

   Drift never carries a duckling into a hillside: see sim.js's stepFalling,
   which only takes the sideways step when the column it would move into has
   nothing solid at that height. A flyer pinned against a cliff face comes
   straight down it and glides once it is past the bottom. */
export const FLY_DRIFT = 1 / 3;        // columns a flying duckling slides a tick

/* A step this tall or shorter is just the ground changing height under a
   walking duckling — up or down, no different than the last column. Taller
   than this going up and it is a wall; taller than this going down and it is
   a fall. */
export const WALK_STEP = 4;

/* The longest drop a duckling walks away from. Past this and a fall the level
   otherwise leaves alone is a duckling lost, so a platform's far edge always
   has to be either shorter than this or handled some other way (a dig, a
   bridge, a gentle staircase). Also, not by coincidence, about four times a
   duckling's own height — art.js's DUCK_ART is six rows drawn four pixels
   apart — which is what makes it the right number to also cap how high a
   Builder's own ramp is allowed to climb; see BUILD_RISE_HEIGHT below. */
export const FALL_SAFE = 24;

/* How long a Builder keeps laying ramp before it stops on its own, having
   run into nothing — see sim.js's stepBuilding. It starts the instant it is
   given, so this is the one thing that ever ends a ramp out in open air,
   and it is also what bounds how far one reaches: one tick of building is
   one column, so three seconds is thirty-three columns, about a tenth of
   the scene. Was ten, which reached a third of the way across a level off a
   single click and left very little a player could get wrong, then four.
   Stated as seconds, the same way spawnInterval and timeLimit are, and
   converted once into ticks here rather than written as a bare count. */
export const BUILD_SECONDS = 3;
export const BUILD_MAX_STEPS = TICK_RATE * BUILD_SECONDS;

/* How long a duckling stands at the end of a ramp it has just finished
 * before it walks on — see sim.js's stepBuilding and stepWalking.
 *
 * A ramp that runs out of clock ends in open air, and the duckling that laid
 * it is standing on the last column of it with nothing in front. It used to
 * take its next step on the very next tick, which is a ninetieth of a
 * second's warning: chaining a second ramp onto the end of the first — the
 * climb, level, climb staircase that half the later levels are built on —
 * meant clicking inside one tick, and mostly meant watching it walk off
 * instead. That is not difficulty, it is a reflex test nobody can pass, and
 * the level design already assumes the chain is possible (see The Stepping
 * Stones and The Belfry).
 *
 * A second and a half is long enough to see the ramp stop, find the Builder
 * button and click, and short enough that it still reads as a duckling
 * hesitating at an edge rather than waiting for instructions. It applies
 * however the ramp ended — out of clock, run into a wall, or run out of
 * level — because "it stopped building" is the moment a player reacts to,
 * not the reason it stopped.
 */
/* How fast "Hatch all" pours the rest of the flock out of the nest — see
 * sim.js's hatchAll. Two ticks apart rather than none at all: a whole hatch
 * arriving on one tick is a single stack of ducklings standing in one
 * column, which reads as one duckling and behaves like a crowd. Two ticks is
 * about a fifth of a second each, so twenty-four of them are out in four and
 * a half seconds and still leave the nest as a line rather than a lump.
 *
 * This is also what makes the time bonuses reachable at all (see runBonus):
 * a level that spawns one duckling every three seconds cannot be finished in
 * under thirty however well it is played, because most of that half-minute
 * is spent waiting for the nest.
 */
export const HATCH_RUSH_TICKS = 2;

export const BUILD_PAUSE_SECONDS = 1.5;
export const BUILD_PAUSE_TICKS = Math.round(TICK_RATE * BUILD_PAUSE_SECONDS);

/* How high a Builder's ramp climbs over the full BUILD_MAX_STEPS, if it
   never runs into ground first — see sim.js's stepBuilding. Kept at exactly
   FALL_SAFE on purpose, which is what makes the ordinary case safe: one
   ramp laid along level ground ends this far up, and this far is exactly
   the tallest drop a duckling walks away from, so stepping off the end of
   one costs nothing. Ground that has fallen away further under the ramp's
   far end is the case that is not safe, and deliberately so — see
   stepBuilding on why a ramp is a real thing left in the world.

   A staircase of them is not bounded by this at all. Builders alternate
   climbing and level runs (see sim.js's assignSkill), so the third one is
   twice this height above the ground and the fifth is three times, and the
   end of any of those is a ledge that kills. That is the whole risk of The
   Stepping Stones, and the reason it hands out Blockers by the handful. */
export const BUILD_RISE_HEIGHT = FALL_SAFE;

/* How long a Digger keeps cutting, and so how far one tunnel reaches: one
   tick of digging is one column, so three seconds is thirty-three columns.
   Stated in seconds the way BUILD_SECONDS, spawnInterval and timeLimit are,
   and converted into ticks once, here.

   This is a real limit rather than the safety cap it used to be (it was
   sixty, further than any wall in the game was thick). A Digger now spends
   itself on one tunnel and the trait goes with it — see sim.js's
   stepDigging — so a wall thicker than thirty-three columns takes a second
   Digger handed to a second duckling standing in the hole the first one
   left. No level here is built to need that relay — every wall in the game
   is thirty columns or less, one tunnel's worth with a little room to
   spare, and several were narrowed to keep it that way when this stopped
   being a safety cap. It is a thing a player can do, not a thing a level
   asks for. */
export const DIG_SECONDS = 3;
export const DIG_MAX_STEPS = TICK_RATE * DIG_SECONDS;

/* What a Jumper can clear in one hop — see sim.js's stepWalking, which is
   where a jump is decided, and stepJumping, which flies it.

   JUMP_SPAN is how far the hop reaches, in columns, so the widest ditch it
   clears is one narrower than that: five reaches the far lip of a four-column
   ditch. Every real gap in the game is fifteen columns or more, so a Jumper
   is never a cheaper Builder — the two answer different sizes of the same
   thing, and nothing about a level has to be arranged to keep them apart.

   JUMP_RISE is how far up it can land, which is a low wall's worth and
   nothing like a real one: the shortest wall in the game is forty pixels, so
   a Jumper is not a cheaper Climber either. WALK_STEP is what a duckling
   steps up without any skill at all, so the band a Jumper owns is the
   awkward middle between the two.

   The crest is drawn from these rather than stated separately — see
   stepJumping. A hop that cleared more than it rose would read as a skid. */
export const JUMP_SPAN = 5;            // columns a hop reaches, so a 4-wide ditch
export const JUMP_RISE = 14;           // pixels of wall a hop can land on top of

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

/* And a teleporter fires a flash at both ends the moment a duckling goes
   through, kept the same way and for the same reason: a duckling that
   vanishes from one pad and appears on another somewhere across the level
   needs both halves of that to be visible, or the eye reads it as a glitch.
   Shorter than a poof — this is a spark, not a settling puff of down. */
export const ZAP_TICKS = 6;

/* ------------------------------------------------------------------ skills */

/* Digger, Builder and Blocker all change something the whole flock shares —
 * a tunnel, a bridge, a wall — and only ever have to work once. Climber and
 * Flyer do not: they ride on the one duckling that holds them and have to be
 * given out again to the next one. But when a skill actually takes hold is
 * its own, separate axis:
 *
 *   Digger, Climber,    deferred — given anywhere, held, and only actually
 *   Flyer               answer the hazard each one is for the moment the
 *                       duckling meets it, not before
 *   Builder             instant — starts laying ramp on the very next tick,
 *                       from wherever that duckling is standing, whether or
 *                       not there is anything there to answer
 *   Blocker             instant — plants that duckling for good, right
 *                       there, a wall nothing gets past — another duckling
 *                       or the goose alike, see sim.js's stepWalking and
 *                       stepGoose
 *
 * The two instant ones are the two you aim rather than merely spend: a
 * Blocker plants where you click it, and a Builder's ramp starts where you
 * click it and runs forward from there. The difference is that a Builder
 * cannot miss — it always builds, gap or no gap — so the question is never
 * whether the click took, only whether the ramp went anywhere worth going.
 * A ramp is also the only one of the five that outlives the duckling that
 * made it in a way the others don't quite: a tunnel is a hole the flock
 * walks through, but a ramp is ground the flock walks *up*, and it ends
 * wherever ten seconds left it. See sim.js's stepBuilding.
 */
export const SKILLS = ['digger', 'builder', 'blocker', 'climber', 'flyer', 'jumper'];

export const SKILL_INFO = {
  digger: { name: 'Digger', verb: 'Dig',
    blurb: `Tunnels straight through the next wall for ${DIG_SECONDS} seconds, leaving a way through for the rest. Then the knack is spent.` },
  builder: { name: 'Builder', verb: 'Build',
    blurb: `Starts a ramp the way it faces, right where you click it, for ${BUILD_SECONDS} seconds. From the ground it climbs; from a climbing ramp it carries on level; from a level one it climbs again — so a chain of them is a staircase.` },
  blocker: { name: 'Blocker', verb: 'Block',
    blurb: 'Plants itself, turning back anything that meets it — another duckling, or the goose. Click it again to stand it down, and it walks off back the way it came.' },
  climber: { name: 'Climber', verb: 'Climb',
    blurb: 'Scales the next wall instead of turning back from it. One duckling only.' },
  flyer: { name: 'Flyer', verb: 'Fly',
    blurb: 'Flaps down to a soft landing from any height. One duckling only.' },
  jumper: { name: 'Jumper', verb: 'Jump',
    blurb: 'Hops a ditch, a low step, or the goose itself — and a goose hopped over gives up and flies off without anybody. Small things only, and it keeps the knack. One duckling.' },
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

/* A run of treads climbing from `y0` to `y1`, `rise` pixels and `width`
 * columns at a time, written out as the segments a staircase would otherwise
 * take a dozen hand-typed lines to say. `from` is the leftmost column and the
 * run always reads left to right; which way it goes is read off `y0` and
 * `y1` rather than said twice, so `rise` is only ever how tall a tread is.
 *
 * How tall a tread is decides what the staircase actually is, and the two
 * levels that use this use it both ways. At WALK_STEP or less a tread is
 * ordinary ground a duckling walks up and down without a thought. Taller
 * than that and it is a wall going up and a drop coming down — which, kept
 * under FALL_SAFE, makes a flight of steps a duckling can only ever descend.
 * The Spire's face is that: ducklings come down it out of the nest, and
 * nothing walks back up.
 *
 * The last tread is the one that reaches `y1`, and the run ends there —
 * whatever comes next starts at from + (|y0 - y1| / |rise| + 1) * width.
 */
export function stairs(from, y0, y1, rise, width = 1){
  const out = [];
  const down = y1 < y0;
  const step = Math.abs(rise) * (down ? -1 : 1);
  for(let y = y0, x = from; down ? y >= y1 : y <= y1; y += step, x += width){
    out.push({ from: x, to: x + width, y });
  }
  return out;
}

/* --------------------------------------------------------------- the level */

/* "The Park": nest, a gap, a wall, a drop, a goose, a pond.
 *
 * Three obstacles, and deliberately one of each kind of answer. The gap is
 * solved once and stays solved — a ramp the whole flock walks over. The wall
 * and the drop are not: a Climber gets one duckling up and a Flyer gets one
 * duckling down, and the next duckling arrives at an obstacle exactly as
 * tall as the first one found it. That is why those two supplies are sized
 * for most of the flock while the builder supply is a handful.
 *
 * This gap is thirty-five columns and a ramp is thirty-three (see
 * BUILD_SECONDS), so it is also the one gap in the game that wants two
 * Builders rather than one: the first laid at the lip carries a duckling
 * most of the way over, and a second, given to a duckling standing out on
 * the end of that ramp, extends it the rest of the way. That is deliberate —
 * it is the level that introduces Builder, and a gap it cannot quite reach
 * across in one go is what teaches that a ramp can be carried on from where
 * the last one stopped.
 *
 * No Diggers here at all. A Digger tunnels through a wall, which would make
 * the wall a solved-once obstacle like the gap — worth meeting, but not on
 * the level that exists to teach that some things have to be paid for one
 * duckling at a time. The skill is still on the page, at zero, so it reads
 * as something held back rather than something missing.
 */
export const LEVEL_PARK = {
  id: 'park',
  name: 'The Park',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'A ramp is laid once and the whole flock walks over it; a Climber or a Flyer only ever helps the one duckling you spent it on. This gap is a little longer than one ramp reaches — lay the second from the end of the first.',


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
     is four: two to reach across the gap (see the level's note above) and
     two more, because getting a ramp wrong on the level that teaches ramps
     should cost a Builder, not the run. Digger is zero: see the note too. */
  supply: { digger: 0, builder: 4, blocker: 2, climber: 9, flyer: 9, jumper: 1 },

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
export const LEVEL_WARREN = {
  id: 'warren',
  name: 'The Warren',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'No Climbers and no Flyers down here, so every wall has to be tunnelled. A dig goes through once and stays open for everyone behind it, which is why two Diggers in the right places are most of the level.',


  /* [0, 40)    flat ground out of the nest
     [40, 65)   the gap — 25 columns of pit, wants a Builder
     [65, 120)  flat ground up to the first wall
     [120, 150) the first wall — 30 columns tall enough that only a tunnel
                gets through it; there is no Climber supply on this level.
                Thirty rather than the forty-five it used to be: a tunnel
                reaches thirty-three columns now (see DIG_SECONDS), and the
                promise this level is built on is one Digger per wall
     [150, 220) flat ground between the two walls
     [220, 250) the second wall — shorter, but the same deal, and the same
                thirty columns across
     [250, 300) flat ground, with the goose's beat in the far half of it
     [300, 320) the pond */
  segments: [
    { from: 0, to: 40, y: 150 },
    { from: 40, to: 65, y: PIT_Y },
    { from: 65, to: 120, y: 150 },
    { from: 120, to: 150, y: 70 },
    { from: 150, to: 220, y: 150 },
    { from: 220, to: 250, y: 90 },
    { from: 250, to: 320, y: 150 },
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
  supply: { digger: 3, builder: 2, blocker: 2, climber: 0, flyer: 0, jumper: 1 },

  goose: { x0: 260, x1: 299, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Orchard": nest and pond swapped ends — the first level run the other
 * way round (content.js's goalHeading is -1 here; see sim.js's hatchling
 * and stepWalking for what that changes about how a duckling starts and
 * finishes). The gap, the wall and the drop are the same three obstacles
 * this level has always had, in the same order relative to the walk, just
 * met heading left instead of right, and the nest sits well short of the
 * right edge rather than hard against it (see below) — 300 to 320 for the
 * water at 6 to 320 for solid ground was one thing; a duckling stepping off
 * the level the moment it opened its eyes would be another.
 *
 * The one thing that actually changed on purpose, not just moved: the
 * goose. It used to patrol the last stretch before the pond, a hazard with
 * nothing much before it to be careful about. Here it patrols the first
 * stretch out of the nest instead, close enough that the very first
 * hatchling can meet it before a player has done anything at all. Blocker
 * is the tool this is built to put in a player's hand early — plant one
 * near the nest and the goose turns back for good the moment it meets it,
 * the same way it would anywhere else in this game (see sim.js's stepGoose
 * and stepWalking). But a planted Blocker is a wall nothing gets past,
 * ducklings included, so one planted on the only road out of the nest
 * strands every hatchling still behind it — the same trade a Blocker always
 * offers, not a special case for this level. Without one, the goose still
 * only ever gets its first duckling (see sim.js's goosedAt) — the same cost
 * every other level with a goose already absorbs into its own quota.
 *
 * A wall's "far side" is really two different things depending on how it
 * was crossed. Dig it, and the tunnel holds the digging duckling's own
 * height the whole way through — no climb, and so nothing to come back down
 * from either, and every duckling behind it just walks through flat ground
 * that used to be a wall. Climb it, and the duckling is still standing at
 * the wall's own elevation when the plateau runs out, which is its own real
 * drop back down that only Flyer answers, and Digger quietly skips it.
 *
 * That asymmetry does not extend to the second hazard: the mandatory drop
 * into the low plain sits far enough past the wall that no dig started at
 * the wall can run into it, so every duckling reaches it on its own two
 * feet whichever way the wall was crossed.
 *
 * And that drop is now the level. It is twenty-five pixels, one more than a
 * duckling survives, and there are three Flyers for twenty-five ducklings —
 * so the answer cannot be "give everybody a Flyer" any more. It is:
 *
 *   one duckling Flies down, and is planted where it lands. It is not
 *     holding anything back; it is there to be walked into
 *   a second Flies down, meets it, turns, and is now the only duckling in
 *     the level facing back towards the ledge it just came off
 *   that one builds. A ramp laid towards the ledge climbs the
 *     twenty-four pixels back up to within a step of it, and the drop
 *     stops being a drop — the flock walks down what it used to fall
 *   both Blockers then stand down, and the low plain is a road again
 *
 * Which leaves the third Flyer spare, and it is meant to be: something has
 * to be forgiven if the first duckling down is walked into the second gap
 * before the ramp is in.
 *
 * The rest of the flock has to be held off the ledge while that happens,
 * and cannot be held until the two that fly are past — a Blocker planted
 * any earlier turns THEM round too, and then nobody goes down at all. The
 * hatch keeps arriving through all of it, which is where the quota went:
 * see winRatio below.
 *
 * Confirmed by actually running it: the route above wins, and removing any
 * one of the Flyers, the turning Blocker or the ramp drops it to nobody
 * home at all. The older cases still read the same — no-builder,
 * no-flyer-at-all and an early Blocker at the nest all come out exactly as
 * their names say they should.
 *
 * And the pond sits apart from everything else — a second gap, right at
 * the end, bridged the same way the first one is, with the same Builder:
 * the last thing standing between a duckling and the water is one more
 * span of open air, not a new skill.
 */
export const LEVEL_ORCHARD = {
  id: 'orchard',
  name: 'The Orchard',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'The pond is off to the left this time, and the flock hatches walking that way. Same gap, wall and drop as The Park — met in a mirror, and with a much bigger hatch to get through them.',


  /* [0, 20)    the pond
     [20, 35)   the second gap — 15 columns of pit, wants a Builder
     [35, 130)  the low plain the mandatory drop lands on, the goose's old
                beat before the reversal, now just open ground
     [130, 175) flat ground the wall's far side drops onto — the buffer
                past where any wall-tunnel could possibly still be cutting
     [175, 205) the wall — 30 columns, short enough to dig in one go with
                room to spare (a tunnel reaches thirty-three; see
                DIG_SECONDS), but Climber answers it just as well
     [205, 230) flat ground up to the wall
     [230, 250) the first gap — 20 columns of pit, wants a Builder
     [250, 320) flat ground out of the nest, with the goose patrolling right
                through it */
  segments: [
    { from: 0, to: 20, y: 175 },
    { from: 20, to: 35, y: PIT_Y },
    { from: 35, to: 130, y: 175 },
    { from: 130, to: 175, y: 150 },
    { from: 175, to: 205, y: 100 },
    { from: 205, to: 230, y: 150 },
    { from: 230, to: 250, y: PIT_Y },
    { from: 250, to: 320, y: 150 },
  ],

  // 24 short of the far edge rather than 6, the way the old nest sat short
  // of the left one — see the note above on why that margin matters more
  // on this side.
  nestX: 296,
  goalX: 20,

  duckCount: 25,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 300,       // five minutes — more ducklings, more time

  /* Three quarters for as long as every duckling could be handed a Flyer,
     because then nothing about the drop cost anything: the toll was clicks,
     not ducklings. Three Flyers makes it cost ducklings. Two have to be down
     on the low plain before the rest can be held back from the ledge, and
     the hatch keeps coming at one every two seconds while that is arranged,
     so somewhere around six of them walk off the edge before there is
     anything to walk down. That is the price of the route, not a mistake in
     playing it — a bot playing the whole thing perfectly saves nineteen.
     Asking for nineteen would therefore be asking for perfect, on the third
     level of the game. Fifteen leaves the four ducklings of room that the
     rest of the level's margins have always had. */
  winRatio: 0.6,

  /* Climber and Digger are both still fully supplied, but they stopped being
     an even choice the moment Flyer stopped being free. Climbing leaves a
     duckling standing at the wall's own height, and that plateau runs out in
     a fifty-pixel drop that only a Flyer answers — one Flyer per duckling
     that climbed. That cost nothing when there were twenty-five of them. On
     three, the tunnel is the way through, and the Climbers here now buy a
     scouting trip rather than a second route for the flock.

     Flyer used to be unlimited, because the twenty-five pixel drop past the
     wall is one pixel more than a duckling survives (FALL_SAFE) and every
     single one of them has to get down it. Handing out twenty-five Flyers
     is not a puzzle, though, it is a toll: the same click, twenty-five
     times, on the one hazard that cannot be solved once for the whole
     flock. Three of them now, and ten Builders instead, which turns that
     toll into the level's real question — the first duckling down is the
     only one that needs to fly, and what it does when it gets there is
     build the way down for everybody else. A ramp laid back up towards the
     ledge puts a deck within a step of it, and the flock walks down what it
     used to have to fall.

     Ten Builders because that answer costs three of them (two bridges and
     the way down) and finding it costs a few more: a ramp is spent where it
     is started and cannot be taken back, and the run-up for this one is
     about thirty columns.

     Blocker: five, and now one of them is load-bearing rather than a
     flourish — a duckling that has flown down is still walking towards the
     pond, and turning it round to face the ledge it came off is the only
     way to build back towards it. */
  supply: { digger: 3, builder: 10, blocker: 5, climber: 24, flyer: 3, jumper: 1 },

  // Patrols right past the nest rather than the far end of the walk — see
  // the note above on why that moved. Starts at x0 and heads toward x1
  // first (sim.js's newGame), so the very first hatchling gets a few
  // seconds' grace before the goose actually swings back through the nest.
  goose: { x0: 260, x1: 318, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Grove": nest and pond both sit somewhere new — the first level not
 * built around the same 6-to-300 walk every other one shares. A gap wants a
 * bridge and a wall wants a tunnel, both solved-once obstacles the whole
 * flock walks through behind whichever duckling answers them first — but the
 * wall here does not take a tunnel where a duckling meets it.
 *
 * Its bottom fifty pixels are rock (`hardBelow: 140`, see the header note):
 * a Digger walking into it at ground level is standing below the seam and
 * gets nowhere at all, however many are spent. The dirt is higher up, so the
 * way through is to put a ramp against the wall and dig from the top of it —
 * two skills in sequence on one obstacle, which nothing before this level
 * asks for. A ramp climbs BUILD_RISE_HEIGHT, so it has to be started far
 * enough back to actually be above the seam by the time it arrives: roughly
 * thirty columns of run-up, which is most of the flat ground between the gap
 * and the wall, and is the real puzzle here. Started too late it is still in
 * rock when it gets there; started too early it stops short and the duckling
 * walks the last stretch at ground level.
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
export const LEVEL_GROVE = {
  id: 'grove',
  name: 'The Grove',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'A Digger walking into the foot of that wall gets nowhere: the bottom of it is rock. The dirt is higher up, so stand a ramp against the wall and dig from the top of it.',


  /* [0, 50)    flat ground out of the nest
     [50, 78)   the gap — 28 columns of pit, wants a Builder
     [78, 130)  flat ground up to the wall
     [130, 160) the wall — 30 columns, one tunnel's worth (see DIG_SECONDS),
                and rock for everything below y=140 (`hardBelow`, see the
                header note): a Digger standing on the ground at 150 is
                below the seam and gets nowhere, so the way through is to
                come at it higher up. See the level's note.
     [160, 320) flat ground the rest of the way, the goose's beat somewhere
                inside it, and the pond at the end of it */
  segments: [
    { from: 0, to: 50, y: 150 },
    { from: 50, to: 78, y: PIT_Y },
    { from: 78, to: 130, y: 150 },
    { from: 130, to: 160, y: 90, hardBelow: 140 },
    { from: 160, to: 320, y: 150 },
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

  /* Builder is four: one for the gap, one for the ramp up the wall, and two
     spare, because a ramp started at the wrong spot is the mistake this
     level is built around and it should cost a Builder rather than the run.
     Digger: three for the one tunnel. Climber and Flyer: zero — there is no
     climbing the wall and nothing here falls, so the ramp is the only way to
     get high enough to dig. Blocker: present, without a winning use, same as
     The Warren. */
  supply: { digger: 3, builder: 4, blocker: 2, climber: 0, flyer: 0, jumper: 1 },

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
export const LEVEL_AERIE = {
  id: 'aerie',
  name: 'The Aerie',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'That face is rock, and rock is the one thing a Digger cannot start on — it has to be climbed. Watch the far side of the climb: it is a ledge with a gap under it, not a landing.',


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
  supply: { digger: 2, builder: 3, blocker: 2, climber: 9, flyer: 0, jumper: 1 },

  goose: { x0: 240, x1: 279, y: 50, speed: 1.5, catchRadius: 1.5 },
};

/* "The Spire": the one level whose ducklings start at the top of something
 * and have to get down off it. The nest sits on the spire's own summit —
 * eighteen columns of flat ledge, wide enough to be somewhere rather than
 * just an edge — and every hatchling steps out of it heading left, away
 * from the pond, because left is the only way down and the pond is not
 * going anywhere (see content.js's hatchDir).
 *
 * Down is a flight of six steps cut into the spire's left face, fifteen
 * pixels each. Fifteen is deliberately between the two numbers that matter:
 * past WALK_STEP, so nothing ever walks back *up* them, and inside
 * FALL_SAFE, so walking *down* them costs nothing. That one number is what
 * makes the descent one-way, and one-way is what makes the level a puzzle
 * rather than a stroll — a duckling that reaches the ground cannot go back
 * for another run at the top.
 *
 * And the last step is not a step. It is thirty pixels from the bottom
 * tread to the ground, past FALL_SAFE, so the first duckling out of the
 * nest walks off it and is lost — unless it has wings. That is the whole
 * opening move: a Flyer is the only thing that gets anybody down alive, and
 * three of them are all there are. The one that lands is the only duckling
 * on the ground, and what it does next decides the level.
 *
 * What it should do is build. A ramp laid along the ground towards the
 * spire ends up under that last drop, and thirty pixels onto a ramp deck is
 * a step rather than a fall, so every duckling behind it comes down the
 * face and lands safe without spending anything. The ramp has to start
 * early enough to have climbed by the time it gets there — anywhere in the
 * first twenty columns of open ground does it, and the far end of the pen
 * does not.
 *
 * Then the spire itself: thirty columns between the ground on the left and
 * the ground on the right, and a face too tall to walk up on either side.
 * One Digger tunnels it (thirty is inside a tunnel's thirty-three, see
 * DIG_SECONDS) and the flock walks through to the pond.
 *
 * But not at any height it likes. The spire is earth standing on rock, and
 * the seam runs level through it at 145 (`hardBelow`), which is the bottom
 * thirty-five pixels of the thing — where a column of this depth draws its
 * subsoil, and now draws stone instead. A Digger down on the grass at 150
 * is under that seam and gets nowhere, the same lesson The Grove teaches
 * with the same field. A Digger up on the ramp is above it, and cuts.
 *
 * So the ramp is not only how the flock survives the drop, it is how the
 * tunnel gets dug at all, and the order stops being a thing a player can
 * get wrong: a Digger handed out early simply holds the trait, walks into
 * rock, turns around, and cuts the moment the ramp has carried it up to
 * earth it can actually get through. The ramp wants starting in the first
 * twenty columns of the pen for the other reason too — a ramp begun much
 * past that ends its climb below the seam, and then the Digger riding it
 * is looking at stone as well.
 *
 * The bluff at the far left is `hard`, and it is the level's one piece of
 * real rock: forty pixels of undiggable stone that turns a duckling around
 * for free. It is what makes the strip of ground under the spire a pen
 * rather than a walk off the edge of the world — ducklings that come down
 * the face shuttle between the bluff and the spire's foot, indefinitely and
 * safely, for as long as it takes a player to get the tunnel open. A level
 * that killed the flock while it waited would be a level about clicking
 * fast.
 *
 * A tunnel is dug at whatever height the duckling that cut it was standing
 * at, which here is always the ramp's own deck: somewhere between a hundred
 * and twenty-nine and a hundred and forty-five, depending on where the ramp
 * was started. All of that band is earth. And a ramp laid over a tunnel
 * that already exists ends a step above its mouth rather than a wall above
 * it, so ducklings walking up the ramp step straight down off the end into
 * the hole — see sim.js's surfacesAt, which is what makes a tunnelled
 * column two floors, the hillside over the hole and the hole itself,
 * rather than only the lower one.
 */
export const LEVEL_SPIRE = {
  id: 'spire',
  name: 'The Spire',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'You start at the top and the pond is at the bottom. The steps down the spire\'s left face are short enough to walk down for nothing and too tall to walk back up, so everything here is one-way.',


  /* [0, 60)    the rock bluff — forty pixels of `hard` stone standing over
                the pen's floor, undiggable, there to turn a duckling
                around rather than to be got past
     [60, 90)   the pen: open ground under the spire's face, where the
                flock gathers and where the ramp wants laying
     [90, 102)  the spire's stepped left face — six treads two columns
                wide, fifteen pixels apart, walked down and never up
     [102, 120) the summit ledge, with the nest on it
     [120, 320) the ground on the spire's far side, the goose's beat
                somewhere inside it, and the pond at the end of it */
  segments: [
    { from: 0, to: 60, y: 110, hard: true },
    { from: 60, to: 90, y: 150 },
    // The spire is earth on top of rock, and the seam runs level right
    // through it at 145 — see the note above on what that costs a Digger.
    ...stairs(90, 120, 45, 15, 2).map(seg => ({ ...seg, hardBelow: 145 })),
    { from: 102, to: 120, y: 30, hardBelow: 145 },
    { from: 120, to: 320, y: 150 },
  ],

  /* On the ledge, near its right-hand end, with hatchDir sending every
     duckling out to the left — see the note above, and content.js's
     hatchHeading. */
  nestX: 117,
  hatchDir: -1,
  goalX: 300,

  duckCount: 30,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 300,       // five minutes
  winRatio: 0.65,

  /* Flyer: three, and the level cannot be won without spending at least
     one — the opening move is the only place in this game where a single
     duckling surviving a drop is the difference between a run and nothing.
     Builder: three for the one ramp that matters, because a ramp started
     too late is a wasted Builder rather than a lost run. Digger: four for
     the one tunnel that matters, the same kind of margin The Warren gives
     its own mandatory digs. Blocker: two, present with nothing here that
     needs it — the bluff already does the turning-around a Blocker would
     be for. Climber: zero; the only wall worth climbing is rock and leads
     off the left edge of the level. Jumper: one, as everywhere now
     — a hop over the goose sends it off empty-beaked. */
  supply: { digger: 4, builder: 3, blocker: 2, climber: 0, flyer: 3, jumper: 1 },

  goose: { x0: 250, x1: 299, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Falls": the nest sits in the upper right, the pond down in the lower
 * left, and the whole walk between them is one long descent — a hundred
 * and thirty-five pixels lower at the end than at the start — rather than
 * the roughly flat corridor every level before it shares. That alone
 * changes what a duckling meets along the way: three separate drops, not
 * one, each its own moment a Flyer either answers or doesn't, plus the two
 * gaps and the one wall this game's vocabulary already has words for.
 * Reversed the same way The Orchard is (content.js's goalHeading is -1
 * here too), and the nest sits well clear of the right edge for the same
 * reason The Orchard's does.
 *
 * Two of the three drops are real — past FALL_SAFE, lethal without a
 * Flyer — and one is not: a twenty-pixel step partway down that a
 * duckling just walks off of, the same as any ordinary ground. It is left
 * in on purpose, not cut: a level that made every single elevation change
 * dangerous would be teaching "always fall," which is not the same lesson
 * as "check before you step." Flyer answers both real drops with the one
 * assignment, since the trait rides the duckling rather than the moment
 * — the same reason it is worth giving early here more than almost
 * anywhere else in the game.
 *
 * Between the two drops sits the one wall, a rise breaking the descent
 * rather than a fall continuing it — Digger and Climber both answer it,
 * a real choice the way The Orchard's own wall is, not a rationed one.
 * The goose keeps its usual beat on the terrace just past it, a hazard
 * with nothing special asked of it here, same as most of the levels
 * before this one.
 *
 * What makes this level hard to navigate is not any one piece of it —
 * every hazard here already has a name and an answer somewhere else in
 * this game — it is that four different answers are all live across one
 * run, in an order that never repeats a beat: bridge, drop, wall, drop,
 * step, bridge, drop, pond. Confirmed by actually running it: a bot with
 * Flyer and Climber wins, the same bot with Digger in place of Climber
 * wins too, and pulling any one of Flyer, Builder, or a way past the wall
 * out from under it loses the whole flock.
 *
 * The wall is worth one note, because it is the only wall in the game a
 * ramp could ever reach the top of. This level descends, so the wall's top
 * (15) sits a mere five pixels above the nest's own ground (20) — well
 * inside a ramp's BUILD_RISE_HEIGHT — where every other level's walls stand
 * fifty to a hundred pixels above anywhere a ramp could start. What keeps
 * it a wall is reach, not height: at BUILD_SECONDS a ramp is forty-four
 * columns, and the wall is seventy past the first gap, so a Builder spent
 * there has long since stopped by the time a duckling arrives. Lengthen
 * BUILD_SECONDS much and this is the level that notices first.
 */
export const LEVEL_FALLS = {
  id: 'falls',
  name: 'The Falls',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'The whole walk runs downhill, and it is the drops rather than the gaps that cost ducklings. A Flyer saves only the duckling holding it, so keep them for the falls that are actually far enough to hurt.',


  /* Every height here is lower than it used to be, and the level's top is
     the reason: at fifteen pixels, the plateau on the wall was so close to
     the top of the scene that a Builder given anywhere along the upper half
     of the walk sent its ramp clean off the picture — BUILD_RISE_HEIGHT is
     twenty-four, and there was not twenty-four pixels of sky left above the
     nest, never mind above the plateau. Now the highest ground on the level
     is forty-five, so a ramp laid from the highest thing a duckling can
     stand on still has twenty-one pixels of air over it. The descent lost
     twenty of its hundred and thirty-five pixels in the move — the final
     drop into the low plain is thirty-five rather than sixty — and every
     drop on the walk is still on the same side of FALL_SAFE it always was.

     [0, 100)    the pond and the flat approach to it, goalX well inside it
     [100, 120)  flat ground at the foot of the second gap
     [120, 140)  the second gap — 20 columns of pit, wants a Builder
     [140, 170)  flat ground below the last drop
     [170, 210)  the goose's terrace, twenty pixels up from the base —
                 the drop down from the plateau to here is real, wants a
                 Flyer
     [210, 230)  the plateau on top of the one wall — forty-five is the
                 level's highest point, and the whole level is built down
                 from it
     [230, 260)  flat ground below the wall — the rise up to the plateau
                 wants a Digger or a Climber
     [260, 280)  a thirty-five-pixel step down from the nest's own height —
                 past FALL_SAFE, so this one is real too
     [280, 300)  the first gap — 20 columns of pit, wants a Builder
     [300, 320)  flat ground out of the nest, well short of the right edge */
  segments: [
    { from: 0, to: 100, y: 155 },
    { from: 100, to: 120, y: 120 },
    { from: 120, to: 140, y: PIT_Y },
    { from: 140, to: 170, y: 120 },
    { from: 170, to: 210, y: 100 },
    { from: 210, to: 230, y: 45 },
    { from: 230, to: 260, y: 85 },
    { from: 260, to: 280, y: 50 },
    { from: 280, to: 300, y: PIT_Y },
    { from: 300, to: 320, y: 50 },
  ],

  nestX: 310,
  goalX: 25,

  duckCount: 20,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 300,       // five minutes
  winRatio: 0.6,

  /* Climber and Digger: both fully supplied, a real choice for the one
     wall, the same margin The Orchard gives its own. Flyer: nineteen, one
     short of the flock — it answers every real drop on this level, all
     three of them, off the one assignment, so it is not rationed the way
     a level with a real choice rations its supply. Builder: one spare
     over its two required bridges. Blocker: present, same as most levels,
     with nothing here that calls for it specially. */
  supply: { digger: 3, builder: 3, blocker: 2, climber: 19, flyer: 19, jumper: 1 },

  goose: { x0: 175, x1: 205, y: 100, speed: 1.5, catchRadius: 1.5 },
};

/* "The Hedgerow": the level Jumper is for, and the only one that is.
 *
 * Everything along it is small — three ditches four columns wide, a stile of
 * a step fourteen pixels up, and the goose — and small is exactly the size
 * nothing else in the game answers. A ditch is far too narrow to be worth a
 * ramp and far too wide to walk over; the stile is too tall to step up and
 * nothing like a wall, so there is no tunnelling it and nothing to climb.
 * Every one of them is a hop, and a hop is the only thing that is.
 *
 * Which is why there is no Digger, Climber or Flyer here at all: not rationed
 * to nothing, simply absent, because not one of the three has anything on this
 * level to do. A duckling needs its own Jumper the way it needs its own
 * Climber on The Park — the knack rides the duckling, so the supply is sized
 * to the flock.
 *
 * The one thing a hop cannot answer is the gap in the middle, twenty columns
 * of it, which is a Builder's and nothing else's. So the level is two skills
 * and no more: a Jumper each for the small stuff, and one ramp for the one
 * thing that is not small. Confirmed by running it — with both it clears the
 * quota, with only the ramp the flock is in the first ditch, and with only
 * the hops they are all standing at the edge of the gap.
 *
 * The goose sits on the long flat run home, past everything else, where a
 * duckling that has already used its hop on three ditches still has it: the
 * knack is not spent by using it, which is the difference between Jumper and
 * every other per-duckling skill here.
 */
export const LEVEL_HEDGEROW = {
  id: 'hedgerow',
  name: 'The Hedgerow',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'Everything in the way is small — narrow ditches and one low stile — and small is the one size nothing else answers. There is no Digger, Climber or Flyer on the page because not one of them has anything to do here.',


  /* [0, 30)    flat ground out of the nest
     [30, 34)   the first ditch — four columns, a hop (see JUMP_SPAN)
     [34, 58)   flat ground
     [58, 62)   the second ditch
     [62, 80)   flat ground up to the stile
     [80, 120)  the stile and the ground above it — fourteen pixels up, too
                tall to step (WALK_STEP) and far too short to be a wall, so
                a hop is the only thing that takes it (see JUMP_RISE)
     [120, 124) the third ditch, up on the high ground
     [124, 150) flat ground up to the gap
     [150, 170) the gap — twenty columns, the one thing here a hop cannot
                answer and the only Builder on the level
     [170, 200) flat ground the ramp comes down onto
     [200, 320) back down the stile's own height — an ordinary step, not a
                drop — then the long run home with the goose on it */
  segments: [
    { from: 0, to: 30, y: 150 },
    { from: 30, to: 34, y: PIT_Y },
    { from: 34, to: 58, y: 150 },
    { from: 58, to: 62, y: PIT_Y },
    { from: 62, to: 80, y: 150 },
    { from: 80, to: 120, y: 136 },
    { from: 120, to: 124, y: PIT_Y },
    { from: 124, to: 150, y: 136 },
    { from: 150, to: 170, y: PIT_Y },
    { from: 170, to: 200, y: 136 },
    { from: 200, to: 320, y: 150 },
  ],

  nestX: 6,
  goalX: 306,

  duckCount: 16,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 270,
  winRatio: 0.6,

  /* Jumper: fifteen for sixteen hatchlings, one short of the flock, the same
     margin every other level gives the skill its whole design rests on.
     Builder: one required, one spare. Digger, Climber and Flyer: zero, and
     not as something held back — there is genuinely nothing here for any of
     them. Blocker: present, same as everywhere, and here it would only wall
     the one road home. */
  supply: { digger: 0, builder: 2, blocker: 2, climber: 0, flyer: 0, jumper: 16 },

  goose: { x0: 230, x1: 280, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Overlook": the level that teaches teleporters, and the only one where
 * the walk out of the nest goes underneath something rather than over it.
 *
 * A shelf of rock and grass hangs in the sky above the first half of the
 * level (see content.js's header note on `islands`), and the flock walks
 * along under it for fifty columns without any way at all of getting up
 * there — a ramp climbs twenty-four pixels and the shelf is seventy above
 * the ground. That is the point of it. The shelf is plainly a road, plainly
 * going the right way, and plainly out of reach, for long enough that a
 * player is asking the question before the answer turns up.
 *
 * The answer is the pair of pads. One stands on top of the bluff at the end
 * of the ground, the other on the shelf above; a duckling that walks onto
 * either comes out of the other still going the way it was going (see
 * sim.js's padUnder). A second pair at the shelf's far end brings the flock
 * back down onto the far bank. Between them is the chasm, a hundred columns
 * of open air that nothing in this game crosses — no ramp is a tenth of
 * that long — so the shelf is not a shortcut over the chasm, it is the only
 * way across it.
 *
 * What it costs to reach the first pad is two Builders and the level's one
 * real lesson about rock. The gap out of the nest wants a ramp, the usual
 * way. The bluff past it is twenty-four pixels of stone — exactly one
 * ramp's climb, and `hard` all the way through, so a Digger sent at it does
 * not even start (see sim.js's rockAt). A second Builder given to a
 * duckling standing on the end of the first ramp carries that ramp on level
 * to the bluff's face and the flock walks up onto it, which is The Park's
 * own two-Builder bridge doing a second job.
 *
 * Flyer is here for one thing and it is not a route: the shelf's left-hand
 * end is a seventy-pixel drop onto the ground the flock walked in on, and a
 * duckling turned around up there walks off it. Two of them, for the two
 * mistakes a player is likely to make, and not a way to skip anything —
 * every duckling that flies down lands back where it started.
 */
export const LEVEL_OVERLOOK = {
  id: 'overlook',
  name: 'The Overlook',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'The shelf overhead is plainly a road and plainly out of reach — no ramp climbs seventy pixels. The pads are the way up: a duckling that steps on one comes out of the other.',


  /* [0, 60)    flat ground out of the nest
     [60, 85)   the gap — 25 columns of pit, wants a Builder
     [85, 120)  the run-up, all of it underneath the shelf overhead
     [120, 160) the bluff — 24 pixels of `hard` rock, one ramp's climb and
                no tunnel's, with the first pad standing on top of it
     [160, 260) the chasm — a hundred columns, past anything
     [260, 320) the far bank the second pad lands on, the goose's beat, and
                the pond at the end of it */
  segments: [
    { from: 0, to: 60, y: 150 },
    { from: 60, to: 85, y: PIT_Y },
    { from: 85, to: 120, y: 150 },
    { from: 120, to: 160, y: 126, hard: true },
    { from: 160, to: 260, y: PIT_Y },
    { from: 260, to: 320, y: 150 },
  ],

  /* The shelf: seventy pixels over the run-up, spanning the bluff and most
     of the chasm. Sixteen pixels thick, so it reads as a slab with roots
     hanging off its underside rather than a line drawn in the sky. */
  islands: [
    { from: 100, to: 210, y: 56, floor: 72 },
  ],

  /* Up from the bluff onto the shelf's near end, and down from its far end
     onto the far bank. Both pairs work both ways, which matters here: a
     duckling that comes back to a pad it arrived on earlier goes back
     through it, so a player who sends the flock up too early can send it
     back down again. */
  teleports: [
    { ax: 145, ay: 126, bx: 110, by: 56 },
    { ax: 205, ay: 56, bx: 268, by: 150 },
  ],

  nestX: 6,
  goalX: 300,

  duckCount: 18,
  spawnInterval: TICK_RATE * 2,
  timeLimit: TICK_RATE * 240,       // four minutes
  winRatio: 0.6,

  /* Builder: four, for the two the route actually needs and two more,
     because both of them are placement decisions and a ramp in the wrong
     spot should cost a Builder rather than the run. Digger: two, on the
     page rather than at zero on purpose — the bluff is the one wall here
     and it is stone, and a player who reaches for a Digger out of habit
     should get to find that out. Flyer: two, for the shelf's own edge (see
     the note above). Climber: zero — one would take a single duckling up
     the bluff and leave the other seventeen at the bottom of it. Blocker:
     two. Jumper: one, as everywhere now
     — a hop over the goose sends it off empty-beaked. */
  supply: { digger: 2, builder: 4, blocker: 2, climber: 0, flyer: 2, jumper: 1 },

  goose: { x0: 270, x1: 299, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Stepping Stones": four islands in the sky, a pond on the last of
 * them, and no way up to any of it but ramps.
 *
 * The flock hatches on a strip of ground with a rock wall at each end — a
 * pen, deliberately, and the only ground in this game where doing nothing
 * costs nothing. Everything above it is the opposite. The first island is
 * one ramp's climb over the grass, so falling off it is exactly FALL_SAFE
 * and a duckling that gets it wrong just lands back in the pen and walks
 * round again. Every island after that is higher, and falling off one is
 * the end of that duckling.
 *
 * The islands zigzag, and that is the level. Island A is away to the right,
 * B is back over to the left and above it, C is right again, D is right
 * again and higher still. A duckling walks one way until something turns it
 * round, and the only thing in this game that turns one around in mid-air
 * is a Blocker — so two of them are not a safety net here, they are the
 * route. One near island A's right-hand end sends the flock back left to
 * the ramp up to B; one near island B's left-hand end sends it back right
 * to the ramp up to C. Both stay planted: stand either one down while
 * ducklings are still coming and the flock simply walks the wrong way again
 * and off the far end. The two ducklings holding them are the price of the
 * level, and the last thing a player does, once everything else is up, is
 * stand them down and let them walk up after the rest (see sim.js's
 * releaseBlocker).
 *
 * IN THAT ORDER, though, and this is the last thing between a good run and a
 * perfect one. A released Blocker turns and walks back the way it came, so
 * island A's turner sets off leftward — down island A, up the ramp to island
 * B, and straight along B toward the drop off its left-hand end, which is
 * forty-eight pixels and fatal. The thing that turns it round there is
 * island B's own turner. Stand them both down together and A's turner walks
 * past where B's used to be and off the end; stand A's down first, wait for
 * it to be turned and carried up to island C, and then stand B's down, and
 * the pair of them walk up behind everyone else. Two clicks in the right
 * order is the difference between twenty-three and twenty-four.
 *
 * The other four Blockers are the safety net: the end of a half-built ramp
 * is a ledge, and everything above island A is high enough that walking off
 * one is fatal. Planting one at the working end while the next ramp goes in
 * costs nothing and saves whatever would have walked off it.
 *
 * The climbing is the other half. A Builder handed to a duckling on the
 * ground or on an island climbs BUILD_RISE_HEIGHT; one handed to a duckling
 * already on a climbing ramp runs level; and one handed to a duckling on
 * *that* runs up again (see sim.js's assignSkill). So a chain of Builders
 * is a staircase, and the last hop — C to D, forty-eight pixels — is built
 * to need the whole of it: climb, level, climb, three Builders and
 * ninety-nine columns of it. The first three hops are one ramp each,
 * because an island is ground: a ramp off one starts a fresh staircase
 * rather than carrying on from whatever got the flock up there. That is
 * what the islands are for. Ramps alone gain twenty-four pixels every
 * sixty-six columns, which does not reach the top of this level inside the
 * width of the scene; ramps off islands gain it every thirty-three.
 *
 * The pond is the right-hand end of the top island, a hundred and twenty
 * pixels above the grass, and the first water in this game that is not on
 * the ground. There is nothing else up there and nothing to do once a
 * duckling arrives. The whole of the level is the getting there.
 */
export const LEVEL_STONES = {
  id: 'stones',
  name: 'The Stepping Stones',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'Only a Blocker turns a duckling round, so the two that turn the flock are the route, not a safety net. Every duckling that wants the water climbs the crag and hops the notch — and a duckling with a Jumper hops the goose too, and keeps the Jumper. Stand the turners down last, the lower one first.',


  /* [0, 12)    the left rock wall — `hard`, and there to turn a duckling
                back rather than let it walk off the edge of the level
     [12, 200)  the pen floor, with the nest at one end and the goose
                patrolling the middle
     [200, 212) the right rock wall
     [212, 230) the chasm between the pen and the crag. It is what keeps the
                crag off the pen's own floor: any walkable ground across
                here and a Climber could go straight up the crag from the
                pen and skip the whole climb
     [230, 246) the crag. Rock, and forty-eight pixels over the top island —
                too tall for one ramp, and too tall to hop from the deck of
                one either, which is what makes it a Climber's and nothing
                else's
     [246, 249) the notch. Three columns of nothing, and the last thing
                between a duckling and the water
     [249, 320) the shelf the pond sits on */
  segments: [
    { from: 0, to: 12, y: 110, hard: true },
    { from: 12, to: 200, y: 150 },
    { from: 200, to: 212, y: 110, hard: true },
    { from: 212, to: 230, y: PIT_Y },
    { from: 230, to: 246, y: 30, hard: true },
    { from: 246, to: 249, y: PIT_Y },
    { from: 249, to: 320, y: 30 },
  ],

  /* Right, then back left, then right again — each one a single ramp above
     the last, and the top one running all the way out over the chasm to the
     foot of the crag. */
  islands: [
    { from: 110, to: 190, y: 126, floor: 136 },   // A: one ramp up from the pen
    { from: 30, to: 100, y: 102, floor: 112 },    // B: back to the left
    { from: 60, to: 230, y: 78, floor: 88 },      // C: right again, and out to the crag
  ],

  nestX: 18,
  goalX: 290,

  duckCount: 24,
  spawnInterval: TICK_RATE * 3,
  timeLimit: TICK_RATE * 420,
  winRatio: 0.5,

  /* Three ramps, three Builders, and not one spare — which is the whole
   * reason the last two skills are skills rather than suggestions.
   *
   * A Builder is the most flexible thing in this game and it will answer
   * almost anything given room: a spare one laid on the top island climbs
   * to within six pixels of the crag, near enough to hop; a spare one laid
   * on the crag sails a deck straight over the notch and lands the flock on
   * the far shelf. Either one turns a required skill into an optional one.
   * So every ramp here is spoken for by the climb that gets the flock onto
   * the top island at all, and what is left over is nothing.
   *
   * That is a real cost and worth being plain about: this is now the one
   * level in the game where a ramp in the wrong place cannot be recovered
   * from. It used to carry four spare on purpose. It cannot carry any and
   * still ask for a Climber.
   *
   * Climber: twenty-six, and the count is the point. The crag is forty-eight
   * pixels of rock and every duckling that wants the water goes up it, so
   * this number is a hard ceiling on how many can ever be saved. At sixteen
   * that ceiling was sixteen, on a level that hatches twenty-four — pitched
   * at the quota plus four, back when the quota was the thing being aimed
   * at, which quietly made a perfect run impossible. Eight ducklings had
   * nowhere to go but the top island and nothing to do once they got there.
   * Twenty-four is one each. The two over are for the mistake in the next
   * paragraph, which is an easy one to make and used to cost a duckling and
   * the perfect run together.
   *
   * A Climber given down in the pen is a Climber wasted and a duckling with
   * it — it will scale the pen's own right-hand wall and walk off into the
   * chasm beyond. Where a skill is spent has always mattered here; this is
   * the level that says so out loud.
   *
   * Jumper: twenty-six, the same arithmetic. The notch is three columns of
   * nothing with the shelf level on the far side — no wall to climb, nothing
   * to tunnel, and no ramp left to lay across it. A Flyer is no use either:
   * it starts its glide already below the shelf it would have to reach.
   *
   * One of the twenty-six is worth spending early and a long way from the
   * notch. The goose patrols the pen, and a duckling that can jump hops
   * clean over it and sends it off empty-beaked (see sim.js's goose check) —
   * and keeps its Jumper, because nothing here spends a trait but a Digger.
   * So the Jumper that saves the flock its one certain loss is the same
   * Jumper that carries that duckling over the notch an hour later. Without
   * it the goose takes one and twenty-four is twenty-three.
   *
   * Blocker: six, for the two turns the climb cannot be walked without.
   * Flyer: two, which save a duckling that has walked off a ledge rather
   * than opening any route of their own. Digger: zero — every wall here is
   * rock. */
  supply: { digger: 0, builder: 3, blocker: 6, climber: 26, flyer: 2, jumper: 26 },

  goose: { x0: 90, x1: 150, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* "The Belfry": four floors stacked over one another, a chasm nothing can
 * bridge, and not a Digger on the page.
 *
 * The flock hatches in a pen on the ground — a rock wall at each end, so
 * nothing down there is in any danger — and every floor above it is one
 * ramp's climb above the last. That is the whole of the height: four
 * twenty-four-pixel steps, no wall to tunnel and nothing to fall down that
 * a Builder cannot answer. What makes it work is that the floors are
 * staggered left and right of each other, so the flock arrives at the end
 * of one going the wrong way for the next.
 *
 * A ramp climbs in whichever direction the duckling given it was already
 * walking, and the only thing that turns a duckling around in mid-air is a
 * Blocker (see sim.js's releaseBlocker for the other half of that). So the
 * climb alternates, and it has to:
 *
 *   pen -> floor A    a ramp left to right, off the pen floor
 *   A -> B            a Blocker at A's right-hand end, then a ramp built
 *                     right to left by a duckling walking back
 *   B -> C            a Blocker at B's left-hand end, then a ramp left to
 *                     right again — and this one is forty-eight pixels, so
 *                     it is the climb-level-climb staircase, three Builders
 *                     of it (see assignSkill)
 *
 * Two of those Blockers are the route rather than a safety net, and they
 * stay planted: stand either down while ducklings are still coming and the
 * flock walks the wrong way off the end of the floor it is on. Falling off
 * floor A lands in the pen unhurt, which is the one free mistake here.
 * Falling off B or C does not.
 *
 * And then the chasm. Fifty-one columns of open air between floor C and the
 * far platform, where a ramp reaches thirty-three — this is the one gap in
 * the game that is not a question of building it right, it is a question of
 * not building at all. The pads at either end of it are the way across, and
 * a duckling that walks onto one comes out of the other still going the way
 * it was going, which on floor C is rightward, towards the water. That is
 * the whole of the last move, and it needs nothing spent on it: getting a
 * flock to the pad is the level.
 */
export const LEVEL_BELFRY = {
  id: 'belfry',
  name: 'The Belfry',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'Each floor is one ramp above the last, but they are staggered, so the flock always arrives going the wrong way for the next climb. A ramp climbs whichever way the duckling was already walking, and only a Blocker turns one around.',


  /* [0, 10)    the left rock wall — `hard`, so nothing walks off the edge
     [10, 140)  the pen floor, with the nest at one end
     [140, 150) the right rock wall. Forty pixels, taller than one ramp
                climbs, so the pen stays a pen
     [150, 320) the chasm, and the open air the floors stand in */
  segments: [
    { from: 0, to: 10, y: 110, hard: true },
    { from: 10, to: 140, y: 150 },
    { from: 140, to: 150, y: 110, hard: true },
    { from: 150, to: 320, y: PIT_Y },
  ],

  /* Four floors. A, B and C are staggered so that each one is reached
     walking the opposite way to the last; D is across the chasm and has the
     water on the end of it. */
  islands: [
    { from: 30, to: 120, y: 126, floor: 136 },   // A: one ramp off the pen
    { from: 20, to: 110, y: 102, floor: 112 },   // B: back to the left
    { from: 60, to: 150, y: 54, floor: 64 },     // C: right again, and twice the climb
    { from: 200, to: 300, y: 54, floor: 64 },    // D: over the chasm, with the pond
  ],

  /* The one way across fifty-one columns of nothing. Both ends work, as
     always, which matters only if a player sends the flock over before it
     is ready — walking back onto the far pad brings them home again. */
  teleports: [
    { ax: 145, ay: 54, bx: 205, by: 54 },
  ],

  nestX: 20,
  /* Inside floor D, so its right-hand end is open water. */
  goalX: 270,

  duckCount: 24,
  spawnInterval: TICK_RATE * 3,
  timeLimit: TICK_RATE * 420,       // seven minutes: five ramps and a lot of walking

  winRatio: 0.5,

  /* Builder: ten, for the five the climb needs — one onto A, one onto B,
     and three for the staircase up to C. Five spare, because every one of
     them is a placement decision and a ramp cannot be taken back. Blocker:
     six, for the two turns the route cannot be walked without and four for
     holding a working edge while a ramp goes in. Digger: zero, and there is
     nothing here one could be spent on — no wall on this level, only air.
     Climber: zero; the only walls are the pen's own rock. Flyer: two, which
     save a duckling that has already walked off something. Jumper: one, as everywhere now
     — a hop over the goose sends it off empty-beaked. */
  supply: { digger: 0, builder: 10, blocker: 6, climber: 0, flyer: 2, jumper: 1 },

  goose: { x0: 60, x1: 120, y: 150, speed: 1.5, catchRadius: 1.5 },
};

/* ------------------------------------------------------------ 12: The Errand */

/* One duckling does all the work, and the rest stand still until it is done.
 *
 * The flock hatches on a shelf with a chasm off its left-hand end and a rock
 * tower off its right. The tower is a wall that turns them around, so the
 * only thing on this level that can kill them is the chasm — and they walk
 * straight at it. A Blocker is not a tactic here, it is the first move: plant
 * one and the whole hatch is safe indefinitely, pacing between it and the
 * tower. Leave it a few seconds too long and the level is already lost.
 *
 * That is the "everyone waits" half. The other half is that exactly one
 * duckling can leave, and it is the Climber that decides which: one Climber,
 * one tower, one duckling over it. Every other skill on this level is spent
 * by that same duckling, because it is the only one that is anywhere near
 * the work.
 *
 *   the tower      rock, so a Digger will not touch it (see rockAt) and
 *                  climbing is the only way up. Sixty-four pixels, which is
 *                  also taller than any ramp climbs, so a Builder spent here
 *                  is a Builder wasted
 *   the hill       dirt at the height the shelf runs at, so the Digger cuts
 *                  straight through it. A Climber could go over the top
 *                  instead — it still holds the trait, and stepWalking offers
 *                  climbing to anything that cannot dig — and the far side of
 *                  that hilltop is a thirty-six pixel drop onto the shelf
 *                  below. Over the top is the wrong answer and it costs the
 *                  duckling, which is the whole point of the hill being
 *                  exactly this shape
 *   the pads       what turns the errand around. A duckling cannot turn
 *                  itself around: a wall it can climb is not a wall, and the
 *                  one thing that reverses a walk is a Blocker, which needs a
 *                  second duckling there to be it. So the way back is a pad
 *                  at the end of the far shelf and its pair over the water,
 *                  and the duckling comes out of it still walking right —
 *                  which, on that side of the chasm, is now pointing home
 *   the perch      the island the far pad sits on, twenty pixels over the
 *                  shelf. It is there so the flock can walk underneath it at
 *                  the end without stepping on the pad and being posted back
 *                  across the level (padUnder wants the duckling within a
 *                  step of the pad's own height, and twenty is not). The
 *                  duckling steps off its right-hand end onto the shelf,
 *                  facing the chasm, with forty columns to spare
 *   the bridge     and there it is: the Builder, laid right to left across
 *                  the chasm, climbing the twenty-four pixels back up to the
 *                  shelf the flock is still standing on. A bridge built from
 *                  the far side, back to the others
 *
 * Then the Blocker comes off and the hatch walks down the bridge it did not
 * build, over the chasm it could not cross, and left along the far shelf to
 * the water — passing under the perch on the way.
 *
 * The bridge is the one piece of timing in it. A ramp reaches thirty-three
 * columns and the chasm's far lip is ten of them away, so a Builder given
 * early enough runs out of ramp in mid-air, and a flock walked onto a bridge
 * that stops short is a flock walked into the chasm. There is a window of
 * about two seconds where the ramp lands, and it is the last thing that
 * happens on the level.
 *
 * The Blocker has to stand between the nest and the chasm — anywhere right of
 * the nest and the hatch is turned the wrong way, into the drop, which is the
 * mistake this level is most likely to be lost to. That leaves about twenty
 * columns to choose from, and the goose is what makes the choice interesting:
 * it patrols from the middle of the pen rightwards, so a Blocker planted hard
 * against the chasm is out of its reach and the pen stays as big as it gets,
 * while one planted a little further right is something the goose walks into
 * and flees for good (see stepGoose). Floor, or the bird. Three Blockers, so
 * that is a choice and not a gamble.
 */
export const LEVEL_ERRAND = {
  id: 'errand',
  name: 'The Errand',
  width: SCENE_W,
  height: SCENE_H,

  /* What the page tells a player before they start — the obstacle that

     actually stops people here and the idea that answers it, not a

     walkthrough. See play.html, which prints it under the header. */

  hint: 'Plant a Blocker before anything else — the flock hatches walking straight at the chasm and a few seconds is all it takes. After that exactly one duckling makes the trip, and there is no second one to send if it goes wrong.',


  /* [0, 70)    the far shelf, with the water off its left-hand end. Where
                the errand comes out, and where the flock ends up
     [70, 80)   the chasm. Ten columns, and the only thing here that kills
     [80, 150)  the pen floor, with the nest in the middle of it
     [150, 158) the rock tower — sixty-four pixels, `hard`, and the only way
                out of the pen
     [158, 190) the high shelf along the top
     [190, 218) the hill. Dirt, twenty-eight columns thick, cut through at
                the height the shelf runs at — a tunnel is thirty-three, so
                it breaks through with five to spare
     [218, 250) the far end of the high shelf, with the pad on it
     [250, 312) the rest of it, which nothing ever walks
     [312, 320) rock, so nothing walks off the edge of the world */
  segments: [
    { from: 0, to: 70, y: 144 },
    { from: 70, to: 80, y: PIT_Y },
    { from: 80, to: 150, y: 120 },
    { from: 150, to: 158, y: 56, hard: true },
    { from: 158, to: 190, y: 56 },
    { from: 190, to: 218, y: 28 },
    { from: 218, to: 250, y: 56 },
    { from: 250, to: 312, y: 56 },
    { from: 312, to: 320, y: 28, hard: true },
  ],

  /* The perch. Twenty pixels over the far shelf, which is what keeps the
     flock's walk to the water clear of the pad sitting on it. */
  islands: [
    { from: 14, to: 28, y: 124, floor: 134 },
  ],

  teleports: [
    { ax: 240, ay: 56, bx: 16, by: 124 },
  ],

  nestX: 100,
  /* Out of the nest walking right, at the tower rather than at the chasm.
     The flock gets the length of the pen and back before the drop is a
     problem, which is the time the first Blocker has to go in. */
  hatchDir: 1,
  goalX: 8,

  duckCount: 18,
  spawnInterval: TICK_RATE * 3,
  timeLimit: TICK_RATE * 300,       // five minutes: the errand alone is most of one

  winRatio: 0.5,

  /* One of each of the three the errand spends, which is what makes it an
     errand: there is no second duckling to send if the first one is walked
     off something. Blocker: three, for the one the pen cannot do without,
     the one that buys the goose off, and one spare. Flyer: zero, and it
     would be the answer to the hilltop drop if there were any — there is
     not, and that drop is meant to cost. Jumper: one, as everywhere now
     — a hop over the goose sends it off empty-beaked. */
  supply: { digger: 1, builder: 1, blocker: 3, climber: 1, flyer: 0, jumper: 1 },

  goose: { x0: 90, x1: 140, y: 120, speed: 1.1, catchRadius: 1.5 },
};

/* The order they are played in, and the only place that order is written
 * down. Everything else in the game — the board, the per-level records, the
 * songs, the rooms, every link into a level — is keyed by a level's `id`, so
 * this list can be rearranged without stranding a single saved score. A
 * level's number on the page is its place in here plus one, and nothing
 * more.
 *
 * The constants are named for the level rather than for a position, which
 * they used to be (LEVEL_1 and so on). Positional names survive exactly
 * until the first reorder: The Warren opens the game now, and `LEVEL_1`
 * would have meant The Park sitting second, which is the kind of comment
 * nobody reads twice and everybody trips over once.
 *
 * The Warren before The Park, because it is the gentler of the two and it
 * had been second. The Park asks for eight of ten — the steepest quota in
 * the game — and its one gap is longer than a single ramp, so a first-time
 * player has to find the two-builder trick before they have found anything
 * else. The Warren asks nine of twelve, every wall it has is answered by the
 * one skill it hands out, and a tunnel stays dug for the whole flock behind
 * it. That is a better first thing to learn.
 */
export const LEVELS = [LEVEL_WARREN, LEVEL_PARK, LEVEL_ORCHARD, LEVEL_GROVE, LEVEL_AERIE, LEVEL_SPIRE, LEVEL_FALLS, LEVEL_HEDGEROW,
  LEVEL_OVERLOOK, LEVEL_STONES, LEVEL_BELFRY, LEVEL_ERRAND];

export const winCount = level => Math.ceil(level.duckCount * level.winRatio);

/* ------------------------------------------------------------------ score --- */

/* What a run is worth, which is no longer just how many got home.
 *
 * A level's score was its saved count and nothing else, which made every run
 * that cleared the quota comfortably worth the same as every other. These are
 * the two things a player can do beyond saving ducklings — solve it without
 * stopping to think, and solve it fast — and they are worth a few points each
 * on top.
 *
 * Both are only ever awarded on a WIN. A bonus for finishing quickly, handed
 * out on a loss, would pay a player for ending a hopeless run early; a bonus
 * for not pausing would pay them for not thinking about one. Neither is a
 * thing to reward, and "fail fast for points" is the shape of an exploit
 * rather than of a game.
 *
 * The clock is the sim's own tick count, not wall time, so a paused run is
 * not quietly fast and a slow machine is not quietly slow — see sim.js's
 * `ticks`, which only advances while the level is actually running.
 *
 * `paused` is decided by the page rather than by the sim, which knows nothing
 * about pausing: see play.html, where reopening the hint mid-run counts too.
 * It stops the clock exactly the way Pause does, and a bonus that a player
 * could keep by reading the hint instead of pausing would be a bonus for
 * knowing which button to press.
 */
export const NO_PAUSE_BONUS = 2;
export const SPRINT_SECONDS = 30, SPRINT_BONUS = 2;
export const BRISK_SECONDS = 60, BRISK_BONUS = 1;

/* The most any run can earn beyond its ducklings — never both time bonuses,
   they are one ladder. The board's own caps are a level's duckCount plus
   this (see src/duck-board.js), so a perfect run is postable rather than
   rejected for scoring too well. */
export const MAX_BONUS = NO_PAUSE_BONUS + SPRINT_BONUS;

/* The parts, not just the total, so the end-of-run screen can say what was
   earned and what was missed rather than showing a number that went up for
   no stated reason. */
export function runBonus({ won, ticks, paused }){
  if(!won) return { total: 0, parts: [] };
  const parts = [];
  if(!paused) parts.push({ label: 'never paused', points: NO_PAUSE_BONUS });
  const seconds = ticks / TICK_RATE;
  if(seconds < SPRINT_SECONDS) parts.push({ label: `under ${SPRINT_SECONDS} seconds`, points: SPRINT_BONUS });
  else if(seconds < BRISK_SECONDS) parts.push({ label: 'under a minute', points: BRISK_BONUS });
  return { total: parts.reduce((n, p) => n + p.points, 0), parts };
}

export const runScore = (saved, bonus) => saved + bonus.total;

/* Which way a level is actually walked: +1 for a nest to the left of the
   pond, the way every level before The Orchard's reversal reads, -1 for one
   built the other way round. Nothing about a duckling's own rules cares
   which — sim.js's hatchling and stepWalking read this once to know which
   direction counts as "toward the pond", and every duckling's own `dir` is
   set from it at the moment it hatches, including which way a Builder's
   ramp climbs. art.js reads it too, to know which side of `goalX` the water
   actually sits on (see drawGround). The
   `|| 1` only ever matters for a degenerate level where nestX and goalX are
   the same column, which no real level does. */
export const goalHeading = level => Math.sign(level.goalX - level.nestX) || 1;

/* Which way a duckling faces as it steps out of the nest. Almost always
   towards the pond, which is goalHeading and needs saying nowhere: a nest at
   one end of the walk and the water at the other leaves nothing to decide.
   A level only sets `hatchDir` where the nest is somewhere the pond is not
   simply "that way" — The Spire's sits on top of the spire, with the water
   away to the right and the only way down off the thing to the left, so its
   hatchlings step out heading away from where they are going. */
export const hatchHeading = level => level.hatchDir ?? goalHeading(level);

/* ------------------------------------------------------------------ format */

export function formatTime(ticks){
  const s = Math.max(0, Math.ceil(ticks / TICK_RATE));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
