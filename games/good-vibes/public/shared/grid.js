/* The map grid: dimensions, terrain kinds and tile maths. */


/* The ground the build phase happens on.
 *
 * The map is a grid because everything the build phase wants to ask is a
 * question about neighbours — does this tile drain into that one, is that
 * structure close enough to shelter this tile — and a grid answers those with
 * arithmetic instead of geometry.
 *
 * A new site is generated for every round of every run. Walking out is part
 * of the fiction, and it keeps the build phase a set of decisions instead of
 * a base someone finished in round one. What carries between rounds is the
 * pools — herbs, salvage, pages — not the ground they came from.
 */

/* Sized for a walk, not just a base. The features — water, hills, trees,
   crevices — need room to read as landscape rather than as noise, and at
   24x14 three blobs already touched. */
export const MAP_W = 30;
export const MAP_H = 17;

/* The smallest connected buildable area a generated site is allowed to have.
   Terrain is random, so this is the promise the generator has to keep: enough
   contiguous ground for a base, not merely enough tiles somewhere. */
export const BASE_ROOM = 60;

/* walk  can a player stand here
   build can a structure go here (the build phase's reason to care about terrain)
   grows can a herb spawn here */
export const TERRAIN = {
  grass:   { name: 'Overgrowth',  walk: true,  build: true,  grows: true },
  floor:   { name: 'Panel floor', walk: true,  build: true,  grows: false },
  rubble:  { name: 'Rubble',      walk: false, build: false, grows: false },
  water:   { name: 'Meltwater',   walk: false, build: false, grows: false },
  /* Landscape, not just obstacle. Hills can be walked but not built on — the
     ground is not flat enough; trees grow herbs at their feet but block the
     tile; a crevice blocks everything, including the eye line. */
  hill:    { name: 'Spoil hill',  walk: true,  build: false, grows: false },
  tree:    { name: 'Sapling',     walk: false, build: false, grows: false },
  crevice: { name: 'Crevice',     walk: false, build: false, grows: false },
  /* The camp. Three kinds, all of them terrain rather than buildings on
     purpose: every rule that matters — walking, building, growing, spawning,
     pathing — already reads TERRAIN, so the whole footprint costs these lines
     and a stamp instead of a footprint-aware rewrite of all of it.

     The fire is solid for the same reason a pond is: you do not stand in it,
     and it has to be unstandable for "the party spawns around the fire" to
     mean anything. */
  tent:    { name: 'The tent',    walk: false, build: false, grows: false },
  camp:    { name: 'The clearing', walk: true, build: true,  grows: false },
  fire:    { name: 'The fire',    walk: false, build: false, grows: false },
};

/* Where the camp stands. Dead centre, fixed rather than rolled: it is the one
 * thing on a site that is the same every run, which is what makes coming back
 * to it feel like coming back.
 *
 * CAMP_X/CAMP_Y is the middle of the clearing, and the fire is on it. The tent
 * sits above, as a backdrop — a tent is somewhere you sleep, and the fire is
 * the thing people actually gather at, so the fire is what the camp is
 * arranged around and what the party spawns in a ring about.
 *
 *        :###:      the tent, 3x3, solid
 *        :###:
 *        :###:
 *        :::::      the clearing
 *        ::*::      the fire, at its centre
 *        :::::
 */
export const CAMP_X = Math.floor(MAP_W / 2);
export const CAMP_Y = Math.floor(MAP_H / 2);
export const CAMP_RADIUS = 2;               // the clearing's half-width
/* Centre row of the 3x3 tent. Four rows up rather than three: at three, the
   seats on the near side of the fire stood directly against the tent's base and
   covered two thirds of it, so the backdrop the tent is meant to be was mostly
   a hat above somebody's head. */
export const TENT_Y = CAMP_Y - 4;

/* The camp's whole footprint, from the tent's top row to the clearing's foot.
   `margin` widens it, which is how the tree pass keeps a canopy far enough away
   that it cannot be drawn over the camp. */
export const inCamp = (x, y, margin = 0) =>
  Math.abs(x - CAMP_X) <= CAMP_RADIUS + margin &&
  y >= TENT_Y - 1 - margin && y <= CAMP_Y + CAMP_RADIUS + margin;

/* How many herbs a cycle puts out. Fewer than there are open tiles by a wide
   margin, so where they land still reads as a choice of where to walk. */
export const HERB_COUNT = 14;

export const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
export const tileIndex = (x, y) => y * MAP_W + x;
export const tileAt = (terrain, x, y) => (inBounds(x, y) ? terrain[tileIndex(x, y)] : null);

/* Deterministic PRNG (mulberry32). Same seed, same map, on both sides of the
 * wire and in the tests.
 *
 * This is a factory and not a value: calling it is what produces randomness, so
 * importing this module still costs nothing and decides nothing. The room seeds
 * it from the room code so a party can be told which ruin they are standing in.
 */
