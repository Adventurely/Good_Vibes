/* Duck Duck Quack — the park, drawn.
 *
 * One entry point, `paintScene`, called by the game page every frame and by
 * the title screen and the front-page shelf for their own backdrops. It
 * takes the whole picture as arguments and reads nothing from anywhere
 * else, the same rule the other single-player games here follow: the card
 * on the shelf and the title screen behind it are this scene running, not a
 * screenshot of it.
 *
 * It has to stay cheap. Unlike Sunward's lot, which caches its sky and
 * ground in offscreen canvases because nothing else on its page is also
 * drawing sixty times a second, this scene is one of five running at once
 * on the shelf — there is no room for a layer of caching here, so the
 * drawing itself has to be built out of a few dozen `fillRect` calls a
 * frame rather than a few thousand. Dithering is used only in short seams —
 * a handful of rows, never a whole sky — for exactly that reason.
 *
 * The palette and the pixel font are the shared ones from Good Vibes rather
 * than a copy — this game ships in the same deploy, so there is no reason for
 * a second copy of sixteen hex values to drift out of step with the first.
 */

import { PALETTE, hex, drawSprite, drawTextOutlined } from '../good-vibes/pixel.js';
import { SCENE_W, SCENE_H, POOF_TICKS, goalHeading } from './content.js';

export { PALETTE, hex };

/* ------------------------------------------------------------------ sprites */

/* Facing right. `flip` mirrors it for a duckling walking the other way.
   Bigger than the first cut, with a back highlight and a wing patch, which
   between them are what turn a coloured blob into something with a front
   and a back. */
export const DUCK_ART = [
  '..yyyy..',
  '.yyyyyk.',
  'wyyyyyyo',
  'wyyyoyyo',
  '.yyyyyy.',
  '..o..o..',
];

export const GOOSE_ART = [
  '....kk......',
  '..kwwwk.....',
  '.wwwwwwwko..',
  'wwwwwwwwwwo.',
  'wwwwwswwwww.',
  '.wwwwwwwww..',
  '..o......o..',
];

/* What a duckling is carrying, worn over its head.
 *
 * Shape first, colour second. These were four two-pixel squares in four
 * palette colours, and at this size that is not readable — oak and ember
 * are a few shades apart and the squares were the same square, so "which
 * one is that" came down to squinting at a hue. An arrow pointing down is
 * never mistaken for a bridge no matter how small it is or what is behind
 * it, which is the whole point of giving each one its own silhouette.
 *
 * Each sits on a plate of ink, because the badge has to read against sky,
 * grass, dirt and water alike rather than against whichever one it was
 * designed over. Blocker is in here for the legend on the page only — it
 * is never drawn over a duckling's head at all (see sim.js's assignSkill);
 * a planted one wears its own red bar instead.
 */
const SKILL_BADGE = {
  digger:  ['...', '..N', 'NNN', '..N'],   // straight ahead — tunnels through
  builder: ['...', 'www', 'w.w', 'w.w'],   // a bridge standing on its legs
  climber: ['.t.', 'ttt', '.t.', '.t.'],   // up — scales the wall
  flyer:   ['c.c', 'ccc', '.c.', '...'],   // wingtips out, gliding
  blocker: ['...', 'rrr', 'rrr', '...'],   // the bar a planted duckling wears
};

/* Drawn in this order wherever more than one is held, so the same pair
   always reads the same way round rather than in whatever order they were
   handed out in. */
const BADGE_ORDER = ['digger', 'builder', 'climber', 'flyer'];

const BADGE_W = 3, BADGE_H = 4, BADGE_PAD = 1, BADGE_GAP = 1;
export const BADGE_PLATE_W = BADGE_W + BADGE_PAD * 2;
export const BADGE_PLATE_H = BADGE_H + BADGE_PAD * 2;

/* One badge, at any whole-number scale — 1 over a duckling's head in the
   scene, larger on the page itself, so the key beside the skill button is
   the same drawing the duckling wears rather than a second thing to learn. */
export function drawSkillBadge(ctx, skill, x, y, scale = 1){
  const rows = SKILL_BADGE[skill];
  if(!rows) return;
  ctx.fillStyle = hex('k');
  ctx.fillRect(x, y, BADGE_PLATE_W * scale, BADGE_PLATE_H * scale);
  for(let r = 0; r < rows.length; r++){
    for(let c = 0; c < rows[r].length; c++){
      const key = rows[r][c];
      if(key === '.') continue;
      ctx.fillStyle = hex(key);
      ctx.fillRect(x + (BADGE_PAD + c) * scale, y + (BADGE_PAD + r) * scale, scale, scale);
    }
  }
}

/* ---------------------------------------------------------------- dither */

/* The same 4x4 ordered matrix Sunward and Good Vibes grade their skies and
   grounds with — ordered rather than random so a still frame does not boil
   between redraws. Kept local rather than imported: it is four lines of
   pure arithmetic, not a palette that has to stay in lockstep with anyone
   else's. */
const BAYER = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];

/* A short dithered seam between two colours, `t` of the way from `a` to
   `b`. Only ever called on a handful of rows — the sky's horizon band, the
   grass-to-dirt line — never across a whole fill, which is what keeps this
   affordable at five scenes a frame. */
function ditherSeam(ctx, x, y, w, h, a, b, t){
  const level = Math.max(0, Math.min(1, t)) * 16;
  const keyA = hex(a), keyB = hex(b);
  for(let py = 0; py < h; py++){
    for(let px = 0; px < w; px++){
      const threshold = BAYER[(y + py) & 3][(x + px) & 3];
      ctx.fillStyle = level > threshold ? keyB : keyA;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

/* -------------------------------------------------------------------- sky */

const SUN_X = SCENE_W - 24;
const SUN_Y = 62;
const SUN_R = 8;

/* A lit disc rather than a flat square — the halo ring is one shade warmer
   than the sky it sits in, which at this size is what makes it read as
   glowing rather than as a coin stuck to the sky. */
function drawSun(ctx){
  for(let dy = -SUN_R - 1; dy <= SUN_R + 1; dy++){
    for(let dx = -SUN_R - 1; dx <= SUN_R + 1; dx++){
      const d = Math.sqrt(dx * dx + dy * dy);
      if(d > SUN_R + 1) continue;
      ctx.fillStyle = hex(d > SUN_R - 1.2 ? 'o' : 'y');
      ctx.fillRect(SUN_X + dx, SUN_Y + dy, 1, 1);
    }
  }
}

/* Two flat bands with a short dithered seam between them, rather than one
   flat fill — a gradient's worth of depth for the cost of four extra rows,
   not the fifty-odd thousand pixels a true per-pixel sky gradient would be
   at this scene's size. */
const SKY_SEAM_Y = 92;
const SKY_SEAM_H = 4;

/* Three overlapping domes rather than one ridge line — a single hill silhouette
 * reads as a speed bump; three at different widths and heights read as a range.
 * Each is drawn one row at a time, narrowing toward the top, the same technique
 * Sunward's clouds use for the same reason: a shape built from a few dozen
 * short horizontal runs costs nothing next to filling it pixel by pixel.
 * Static rather than parallaxed — the flock never gets far enough from the
 * camera for a fixed background to give the game away.
 *
 * Green, not the slate/violet this used to be — a purple dome against a blue
 * sky reads as a second, unrelated shape floating in the air, not as a hill,
 * since nothing else in the scene is that colour to anchor it. Pine (`G`) is
 * already what a tree-covered ridge looks like everywhere else this palette
 * is used. `haze` is how far each one blends toward the sky's own cyan —
 * `0` for the nearest hill, closer to `1` for the furthest — the ordinary
 * trick of aerial perspective: what is far away is paler and cooler, which is
 * what actually tells three overlapping domes apart as near, middle and far
 * rather than as one flat frieze.
 */
const HILLS = [
  { cx: 44, w: 100, h: 15, key: 'G', haze: 0.12 },
  { cx: 168, w: 130, h: 22, key: 'G', haze: 0.5 },
  { cx: 274, w: 110, h: 17, key: 'G', haze: 0.28 },
];

function drawHills(ctx){
  for(const hill of HILLS){
    for(let row = 0; row < hill.h; row++){
      const y = SKY_SEAM_Y + SKY_SEAM_H + hill.h - row;
      if(y >= SCENE_H) continue;
      // A dome: wide at the base (row 0, down at the seam), narrowing to
      // nothing at the crown (the highest row), along a quarter-circle
      // rather than a triangle so the skyline curves.
      const t = row / hill.h;
      const width = Math.round(hill.w * Math.sqrt(Math.max(0, 1 - t * t)));
      if(width <= 0) continue;
      const left = Math.round(hill.cx - width / 2);
      ditherSeam(ctx, left, y, width, 1, hill.key, 'c', hill.haze);
    }
    // A single brighter row along the crown — sunlight catching the ridge
    // line, the same reasoning drawStoneColumn's paler top edge uses.
    const crownY = SKY_SEAM_Y + SKY_SEAM_H + 1;
    ctx.fillStyle = hex('t');
    ctx.fillRect(Math.round(hill.cx - 1), crownY, 2, 1);
  }
}

/* Two puffs drifting at their own speeds, wrapping around once they clear
   the far edge — `ticks` is the sim's own clock (see paintScene), not the
   page's, so the sky moves at the same rate the flock does regardless of
   frame rate. */
const CLOUDS = [
  { y: 18, w: 34, h: 6, speed: 0.32 },
  { y: 38, w: 24, h: 5, speed: 0.5 },
];

function drawClouds(ctx, ticks){
  for(let i = 0; i < CLOUDS.length; i++){
    const c = CLOUDS[i];
    const span = SCENE_W + c.w * 2;
    const x = Math.round(((ticks * c.speed + i * 151) % span) - c.w);
    for(let py = 0; py < c.h; py++){
      const inset = Math.round(Math.abs(py - (c.h - 1) / 2) * 1.8);
      const w = c.w - inset * 2;
      if(w <= 0) continue;
      ditherSeam(ctx, x + inset, c.y + py, w, 1, 'w', 'c', 0.4);
    }
  }
}

/* Two birds, each three pixels in a shallow V, tracing a slow rise-and-fall
   across the high sky. Drawn as three fillRects rather than a sprite — at
   this size a "flying bird" is a chevron, nothing a bitmap would earn its
   keep over. Ticks-driven like the clouds, and each on its own sine so the
   pair never move in lockstep. */
const BIRDS = [
  { y: 14, speed: 0.46, bob: 3, phase: 0 },
  { y: 24, speed: 0.6, bob: 2, phase: 2.1 },
];

function drawBirds(ctx, ticks){
  ctx.fillStyle = hex('k');
  for(let i = 0; i < BIRDS.length; i++){
    const b = BIRDS[i];
    const span = SCENE_W + 8;
    const x = Math.round(((ticks * b.speed + i * 97) % span) - 4);
    const y = Math.round(b.y + Math.sin(ticks * 0.05 + b.phase) * b.bob);
    ctx.fillRect(x - 2, y, 1, 1);
    ctx.fillRect(x, y - 1, 1, 1);
    ctx.fillRect(x + 2, y, 1, 1);
  }
}

export function drawSky(ctx, ticks = 0){
  ctx.fillStyle = hex('b');
  ctx.fillRect(0, 0, SCENE_W, SKY_SEAM_Y);
  ditherSeam(ctx, 0, SKY_SEAM_Y, SCENE_W, SKY_SEAM_H, 'b', 'c', 0.5);
  ctx.fillStyle = hex('c');
  ctx.fillRect(0, SKY_SEAM_Y + SKY_SEAM_H, SCENE_W, SCENE_H - SKY_SEAM_Y - SKY_SEAM_H);
  drawClouds(ctx, ticks);
  drawHills(ctx);
  drawBirds(ctx, ticks);
  drawSun(ctx);
}

/* ----------------------------------------------------------------- ground */

/* How deep the grass cap runs before the dirt starts. Capped rather than
   proportional to how much ground a column has: on the wall, where a
   column runs fifty pixels deep, a grass cap that kept growing with it
   would still be grass at the bottom, and a cliff with no dirt showing on
   its face reads as a green wall, not a cut edge. */
const GRASS_DEPTH = 11;

/* Below the soil, rock — a second cross-section split rather than one flat
   dirt fill, so a deep column (the wall's face, fifty pixels of it) reads
   as strata rather than a slab of one colour. Proportional this time, not
   capped: unlike the grass cap, there is no shallow-column case where a
   fixed depth would swallow the whole dirt band. */
const SOIL_SHARE = 0.55;

/* A column of actual rock (content.js's segment `hard`) reads nothing like a
 * column of dirt — no grass cap, no seam, nothing grown on it — flat slate
 * the whole way down but for a paler top edge catching the light, plainer
 * than the strata a dirt wall's face gets because there is only the one
 * material here to show. */
function drawStoneColumn(ctx, x, y, fillH){
  ctx.fillStyle = hex('s');
  ctx.fillRect(x, y, 1, fillH);
  ctx.fillStyle = hex('v');
  ctx.fillRect(x, y, 1, Math.min(2, fillH));
}

/* The cut edge under a floating segment (content.js's `floor`) — a slab
 * with open air under it, not a plateau standing on more ground the way
 * every other rise in this game is. A flat line of ink would read as the
 * bottom just being clipped off-screen; a root hanging past it here and
 * there, sparse the same way the tufts and flowers are scattered, is what
 * says "this is where the island actually ends" instead of "the drawing
 * ran out". */
function drawFloatingEdge(ctx, x, bottom){
  ctx.fillStyle = hex('k');
  ctx.fillRect(x, bottom - 1, 1, 1);
  const h = Math.imul(x + 2917, 2246822519) >>> 0;
  if(h % 5 !== 0) return;
  ctx.fillStyle = hex('N');
  ctx.fillRect(x, bottom, 1, 1 + (h >>> 29));
}

/* Whether `x` is on the pond's side of `goalX` — see content.js's
   goalHeading. Shared by drawGround and the three scatters below it (tufts,
   flowers, rock speckle), all of which need to stop decorating the lawn
   once it turns into water, whichever side of `goalX` that water is on. */
const isPondAt = (level, x) => {
  const heading = goalHeading(level);
  return heading === 1 ? x >= level.goalX : x <= level.goalX;
};

/* The terrain height array, filled column by column from its surface down to
 * either the bottom of the scene or, for a floating segment, no further than
 * its own `floor` (see content.js's header note) — open air below that is
 * the absence of ground, exactly the way a gap's columns already are. A
 * gap's columns sit far below SCENE_H (see content.js's PIT_Y), so they
 * simply paint nothing at all either way.
 *
 * Every ordinary column gets the same cross-section: a shallow cap of grass,
 * a seam, then dirt the rest of the way down. That is what turns the wall —
 * one column with fifty pixels of fill instead of thirty — into something
 * that reads as a cliff with exposed dirt on its face, rather than a taller
 * rectangle of the same flat green. A rock column (`hard`) skips all of that
 * for drawStoneColumn instead — see it for why.
 */
export function drawGround(ctx, terrain, level, rock, floors){
  const heading = goalHeading(level);
  for(let x = 0; x < terrain.length; x++){
    const y = terrain[x];
    if(y >= SCENE_H) continue;
    const bottom = Math.min(floors ? floors[x] : SCENE_H, SCENE_H);
    const fillH = bottom - y;
    if(fillH <= 0) continue;

    if(isPondAt(level, x)){
      // The two columns nearest the shore get a wet-sand lip instead of
      // water reaching all the way to the surface — a hard cut from grass
      // straight to open water reads as a tile boundary, not a bank.
      const distFromShore = heading === 1 ? x - level.goalX : level.goalX - x;
      drawWaterColumn(ctx, x, y, fillH, distFromShore < 2);
      if(bottom < SCENE_H) drawFloatingEdge(ctx, x, bottom);
      continue;
    }

    if(rock && rock[x]){
      drawStoneColumn(ctx, x, y, fillH);
      if(bottom < SCENE_H) drawFloatingEdge(ctx, x, bottom);
      continue;
    }

    const grassH = Math.min(GRASS_DEPTH, fillH);
    ctx.fillStyle = hex('g');
    ctx.fillRect(x, y, 1, grassH);

    const dirtH = fillH - grassH;
    if(dirtH > 0){
      const soilH = Math.round(dirtH * SOIL_SHARE);
      ctx.fillStyle = hex('N');
      ctx.fillRect(x, y + grassH, 1, soilH);
      if(dirtH > soilH){
        ctx.fillStyle = hex('s');
        ctx.fillRect(x, y + grassH + soilH, 1, dirtH - soilH);
      }
      // The seam itself, one row of ink, so the cap reads as sitting on the
      // dirt rather than fading into it.
      ctx.fillStyle = hex('k');
      ctx.fillRect(x, y + grassH, 1, 1);
    }
    if(bottom < SCENE_H) drawFloatingEdge(ctx, x, bottom);
  }
  drawTufts(ctx, terrain, level, rock);
  drawFlowers(ctx, terrain, level, rock);
  drawRockSpeckle(ctx, terrain, level, rock, floors);
  drawNest(ctx, level, terrain);
  drawCattails(ctx, level, terrain);
  drawLilyPads(ctx, terrain, level);
}

/* How tall a Digger's tunnel reads on screen — enough headroom for a duck
   sprite (six pixels) with room to spare, capped at the wall's own surface
   (see drawTunnels) so a shallow wall never shows a hole poking out its
   top. Independent of DIG_MAX_STEPS in content.js: that is how far a dig
   can run, this is how tall one looks once it has. */
const TUNNEL_HEADROOM = 16;

/* A hole bored through a wall, one per tunnelled column — see sim.js's
 * stepDigging and content.js's header note on why this is a second layer
 * rather than `terrain` itself getting shorter. Ink rather than sky: this is
 * the inside of a hillside, not a view out of one, and a bore this small
 * reading as open air would look like the wall had simply been erased.
 * A sliver of slate along the floor is what keeps the cut edge legible
 * against the ink — without it the hole and the duck walking through it
 * blur into the same flat black.
 */
function drawTunnels(ctx, state){
  const { terrain, tunnelY } = state;
  for(let x = 0; x < tunnelY.length; x++){
    const floor = tunnelY[x];
    if(floor == null) continue;
    const top = Math.max(terrain[x], floor - TUNNEL_HEADROOM);
    if(floor <= top) continue;
    ctx.fillStyle = hex('k');
    ctx.fillRect(x, top, 1, floor - top);
    ctx.fillStyle = hex('s');
    ctx.fillRect(x, floor - 1, 1, 1);
  }
}

/* How thick a Builder's deck reads, and how far apart its support posts
   stand — a post every few columns rather than one per column, the same
   "suggest it, do not render every plank" economy the grass tufts and rock
   speckle use elsewhere in this file. */
const BRIDGE_DECK_H = 2;
const BRIDGE_POST_GAP = 8;
const BRIDGE_POST_H = 5;

/* A deck laid over open air, drawn one column at a time rather than one flat
 * run — see sim.js's stepBuilding, which angles the deck up toward a crest
 * over the middle of the gap and back down to meet the far bank, so each
 * column's own height is its own point on that arch rather than a shared
 * flat plank. `terrain` under a bridged column is still PIT_Y (see
 * buildTerrain), so drawGround has already painted nothing at all there;
 * this is what turns that absence into a crossing instead of leaving it
 * looking like an unfinished level.
 */
function drawBridges(ctx, state){
  const { bridgeY } = state;
  for(let x = 0; x < bridgeY.length; x++){
    const y = bridgeY[x];
    if(y == null) continue;
    ctx.fillStyle = hex('N');
    ctx.fillRect(x, y, 1, BRIDGE_DECK_H);
    ctx.fillStyle = hex('k');
    ctx.fillRect(x, y, 1, 1);
    // A post every few columns rather than one per column — the same
    // "suggest it, do not render every plank" economy the grass tufts and
    // rock speckle use elsewhere in this file — hung from this column's own
    // height, which is what keeps the posts themselves tracing the arch
    // rather than fanning out from underneath a flat deck.
    if(x % BRIDGE_POST_GAP === 0){
      ctx.fillStyle = hex('n');
      ctx.fillRect(x, y + BRIDGE_DECK_H, 1, BRIDGE_POST_H);
    }
  }
}

/* The pond: three bands rather than a flat rectangle of blue — a wet-sand
 * lip where the shore actually meets the water, then shallow cyan lit from
 * above, then a dithered seam down into the same deep blue the sky's own
 * horizon uses, so a pond reads as a body of water with a bed sloping away
 * from its edge rather than a tinted floor tile. `bank` is only true for the
 * column or two right at the shoreline (see drawGround) — everywhere else
 * the shallow band starts right at the surface, same as before.
 */
function drawWaterColumn(ctx, x, y, fillH, bank){
  let top = y, remaining = fillH;
  if(bank && remaining > 1){
    ctx.fillStyle = hex('N');
    ctx.fillRect(x, top, 1, 1);
    top += 1;
    remaining -= 1;
  }
  const shallow = Math.min(3, remaining);
  ctx.fillStyle = hex('c');
  ctx.fillRect(x, top, 1, shallow);
  if(remaining > shallow){
    ditherSeam(ctx, x, top + shallow, 1, Math.min(2, remaining - shallow), 'c', 'b', 0.5);
    const deepY = top + shallow + Math.min(2, remaining - shallow);
    if(deepY < top + remaining){
      ctx.fillStyle = hex('b');
      ctx.fillRect(x, deepY, 1, top + remaining - deepY);
    }
  }
}

/* A handful of short glints drifting across the surface, the same
 * `ticks`-driven technique the sky's clouds use — a pond that never moves is
 * the thing that reads as "a rectangle of blue", not the colour of it. Each
 * one is a single lit pixel a row or two below the surface rather than a
 * whole reflected sky, cheap enough to run alongside four other scenes a
 * frame the same way the clouds already do.
 */
const RIPPLE_COUNT = 5;

function drawRipples(ctx, terrain, level, ticks){
  const heading = goalHeading(level);
  const span = heading === 1 ? terrain.length - level.goalX : level.goalX;
  if(span <= 1) return;
  ctx.fillStyle = hex('t');
  for(let i = 0; i < RIPPLE_COUNT; i++){
    const speed = 0.18 + (i % 3) * 0.05;
    // Drifts the same direction as the goose's own patrol reads on this
    // level — away from the shore and back — wrapping across the pond's
    // own width rather than the whole scene's.
    const along = Math.round((ticks * speed + i * 67) % span);
    const x = heading === 1 ? level.goalX + along : level.goalX - along;
    if(x < 0 || x >= terrain.length) continue;
    const y = terrain[x];
    if(y >= SCENE_H) continue;
    const ry = y + 2 + (i % 2);
    ctx.fillRect(x, ry, 1, 1);
  }
}

/* Tufts of longer grass, scattered by a hash rather than stored, so the
   count stays fixed regardless of how much ground there is to decorate —
   the same reasoning Sunward's ground tufts use. A flat cap with nothing
   growing out of it reads as a floor tile; this is what makes it read as a
   lawn instead. */
const TUFT_COUNT = 90;

function drawTufts(ctx, terrain, level, rock){
  for(let i = 0; i < TUFT_COUNT; i++){
    const h = Math.imul(i + 7, 2246822519) >>> 0;
    const x = h % terrain.length;
    const y = terrain[x];
    if(y >= SCENE_H || isPondAt(level, x) || (rock && rock[x])) continue;
    ctx.fillStyle = hex((h >>> 17) & 1 ? 't' : 'g');
    ctx.fillRect(x, y - 1, 1, 1);
  }
}

/* A few flowers among the tufts — a different hash seed than the tufts use,
   so the two scatters land in different spots rather than one drawn over
   the other, and two petal colours picked the same way the tufts pick their
   two greens. Fixed count, same reasoning as the tufts: colour without a
   per-pixel cost. */
const FLOWER_COUNT = 22;
const FLOWER_COLOURS = ['r', 'p', 'y'];

function drawFlowers(ctx, terrain, level, rock){
  for(let i = 0; i < FLOWER_COUNT; i++){
    const h = Math.imul(i + 401, 2654435761) >>> 0;
    const x = h % terrain.length;
    const y = terrain[x];
    if(y >= SCENE_H || isPondAt(level, x) || (rock && rock[x])) continue;
    ctx.fillStyle = hex(FLOWER_COLOURS[(h >>> 13) % FLOWER_COLOURS.length]);
    ctx.fillRect(x, y - 1, 1, 1);
  }
}

/* A scatter of dark flecks in the rock band under ordinary dirt — the same
   fixed-count hash technique as the tufts and flowers, seeded a third way,
   so the slate below the soil reads as stone grain rather than a second
   flat fill. Only ever a few dozen pixels regardless of how much rock is on
   screen, same as every other scatter here. Skipped on an actual rock
   column (`hard`) — drawStoneColumn already has its own top edge and does
   not have the grass-then-soil-then-rock band this is speckling. */
const SPECKLE_COUNT = 40;

function drawRockSpeckle(ctx, terrain, level, rock, floors){
  ctx.fillStyle = hex('k');
  for(let i = 0; i < SPECKLE_COUNT; i++){
    const h = Math.imul(i + 1109, 2246822519) >>> 0;
    const x = h % terrain.length;
    const y = terrain[x];
    if(y >= SCENE_H || isPondAt(level, x) || (rock && rock[x])) continue;
    const bottom = Math.min(floors ? floors[x] : SCENE_H, SCENE_H);
    const fillH = bottom - y;
    if(fillH <= 0) continue;
    const grassH = Math.min(GRASS_DEPTH, fillH);
    const dirtH = fillH - grassH;
    if(dirtH <= 0) continue;
    const soilH = Math.round(dirtH * SOIL_SHARE);
    const rockH = dirtH - soilH;
    if(rockH <= 0) continue;
    const dy = (h >>> 11) % rockH;
    ctx.fillRect(x, y + grassH + soilH + dy, 1, 1);
  }
}

/* A bundle of twigs rather than two bare rectangles — a handful of crossed
   lines in two shades of oak, which at this size is enough to read as
   "woven" instead of "stacked". */
function drawNest(ctx, level, terrain){
  const x = level.nestX;
  const y = terrain[x];
  ctx.fillStyle = hex('N');
  ctx.fillRect(x - 5, y - 4, 11, 4);
  ctx.fillStyle = hex('n');
  ctx.fillRect(x - 5, y - 4, 11, 1);
  ctx.fillRect(x - 3, y - 6, 7, 3);
  ctx.fillStyle = hex('N');
  ctx.fillRect(x - 2, y - 7, 1, 2);
  ctx.fillRect(x + 2, y - 7, 1, 2);
}

/* A few cattails right at the shoreline, straddling the grass/pond seam —
   pine stems with an oak head, tall enough to break the line where lawn
   meets water the way real reeds do. A handful of fixed positions, not a
   scatter: unlike the tufts these need to actually stand at the edge, not
   anywhere on the lawn. Two of the four offsets sit on the grass side, two
   on the water side (see drawGround/isPondAt) — `heading` (content.js's
   goalHeading) is what keeps that split correct whichever side of `goalX`
   the water actually falls on, by flipping the sign of every offset the
   same way the shore itself flips. */
const CATTAIL_DX = [-4, -1, 3, 7];

function drawCattails(ctx, level, terrain){
  const heading = goalHeading(level);
  const landX = Math.max(0, Math.min(terrain.length - 1, level.goalX - heading));
  const bankY = terrain[landX];
  if(bankY >= SCENE_H) return;
  for(const dx of CATTAIL_DX){
    const x = level.goalX + dx * heading;
    if(x < 0 || x >= terrain.length) continue;
    ctx.fillStyle = hex('G');
    ctx.fillRect(x, bankY - 7, 1, 7);
    ctx.fillStyle = hex('N');
    ctx.fillRect(x, bankY - 9, 1, 3);
  }
}

/* Lily pads scattered across the pond, the tufts' hash-scatter trick seeded
 * a fourth way and aimed at the water columns instead of the lawn. Each pad
 * is a small round leaf with a dark notch cut into it — the slit every real
 * lily pad has, and the one detail that keeps it from reading as a plain
 * green dash — and roughly a third of them carry a tiny bloom just above,
 * a single bright petal-coloured pixel, so the pond reads as a place with
 * flowers in it, not just leaves. `heading` (content.js's goalHeading)
 * picks which side of `goalX` the water actually spans, same as the water
 * fill itself (see isPondAt).
 */
const LILY_COUNT = 7;
const LILY_COLOURS = ['w', 'p', 'y'];

function drawLilyPads(ctx, terrain, level){
  const heading = goalHeading(level);
  const span = heading === 1 ? terrain.length - level.goalX : level.goalX + 1;
  if(span <= 1) return;
  for(let i = 0; i < LILY_COUNT; i++){
    const h = Math.imul(i + 5303, 2246822519) >>> 0;
    const along = h % span;
    const x = heading === 1 ? level.goalX + along : level.goalX - along;
    if(x < 0 || x >= terrain.length) continue;
    const y = terrain[x];
    if(y >= SCENE_H) continue;
    const w = Math.min(3, heading === 1 ? terrain.length - x : x + 1);
    const left = heading === 1 ? x : x - w + 1;
    ctx.fillStyle = hex('G');
    ctx.fillRect(left, y, w, 1);
    ctx.fillStyle = hex('k');
    ctx.fillRect(heading === 1 ? left : left + w - 1, y, 1, 1);
    if((h >>> 9) % 3 === 0){
      ctx.fillStyle = hex(LILY_COLOURS[(h >>> 5) % LILY_COLOURS.length]);
      ctx.fillRect(left + (w >> 1), y - 1, 1, 1);
    }
  }
}

/* ------------------------------------------------------------------ goose */

export function drawGoose(ctx, state){
  if(state.goose.gone) return;
  const g = state.level.goose;
  const x = Math.round(state.goose.x) - 4;
  const y = g.y - GOOSE_ART.length - Math.round(state.goose.lift);
  drawSprite(ctx, GOOSE_ART, x, y, state.goose.dir < 0);
}

/* ----------------------------------------------------------------- a duck */

/* Spread out beside a duckling that is actually flapping its way down, and
   nothing at all the rest of the time. This is the one skill whose working
   state is worth drawing rather than badging: wings out mid-fall says what
   is happening to that duckling right now, which a mark over its head does
   not. Two frames, swapped on a slow beat rather than every tick — a real
   wingbeat this size reads as motion at two or three flaps a second, not
   the sixty-times-a-second flutter a per-frame swap would give it. */
const WING_UP = [[-4, 1], [-3, 0], [3, 0], [4, 1]];
const WING_DOWN = [[-4, -1], [-3, 0], [3, 0], [4, -1], [-3, 1], [3, 1]];
const WINGBEAT_TICKS = 4;

function drawWings(ctx, x, y, ticks){
  const up = Math.floor(ticks / WINGBEAT_TICKS) % 2 === 0;
  const cx = x + Math.round(DUCK_ART[0].length / 2);
  const cy = y + 2;
  ctx.fillStyle = hex('y');
  for(const [dx, dy] of (up ? WING_UP : WING_DOWN)) ctx.fillRect(cx + dx, cy + dy, 1, 1);
}

export function drawDuck(ctx, d, ticks = 0){
  const x = Math.round(d.x) - 3;
  const y = Math.round(d.y) - DUCK_ART.length;

  if(d.state === 'falling' && d.traits.has('flyer')){
    drawWings(ctx, x, y, ticks);
  }

  drawSprite(ctx, DUCK_ART, x, y, d.dir < 0);

  if(d.state === 'blocking'){
    ctx.fillStyle = hex('r');
    ctx.fillRect(x + 1, y - 3, 4, 2);
    return;
  }

  const held = BADGE_ORDER.filter(skill => d.traits.has(skill));
  if(!held.length) return;

  const total = held.length * BADGE_PLATE_W + (held.length - 1) * BADGE_GAP;
  let bx = Math.round(x + DUCK_ART[0].length / 2 - total / 2);
  const by = y - BADGE_PLATE_H - 1;
  for(const skill of held){
    drawSkillBadge(ctx, skill, bx, by);
    bx += BADGE_PLATE_W + BADGE_GAP;
  }
}

/* --------------------------------------------------------------- a poof */

/* Where a lost duckling went down (see sim.js's `loseDuckling`) — a small
   burst of pale down that spreads and fades over `POOF_TICKS`, rather than
   the duckling's sprite just being gone the next frame. Fixed offsets and a
   shrinking pixel count, the same cheap scatter every other flourish in
   this file uses, not a particle system. */
const POOF_OFFSETS = [
  [0, -1], [-1, 0], [1, 0], [-2, -2], [2, -2], [-2, 1], [2, 1], [0, -3],
];

function drawPoof(ctx, p){
  const t = p.age / POOF_TICKS;          // 0 just spawned, 1 about to clear
  const spread = 1 + t * 3;              // drifts outward as it ages
  const shown = Math.max(1, Math.round(POOF_OFFSETS.length * (1 - t)));
  const cx = Math.round(p.x), cy = Math.round(p.y) - 3;
  ctx.fillStyle = hex(t < 0.6 ? 'w' : 'N');
  for(let i = 0; i < shown; i++){
    const [dx, dy] = POOF_OFFSETS[i];
    ctx.fillRect(cx + Math.round(dx * spread), cy + Math.round(dy * spread), 1, 1);
  }
}

/* ------------------------------------------------------------------ scene */

/* The whole picture, in back-to-front order. `state` is a sim.js game state;
   nothing here mutates it. */
export function paintScene(ctx, state){
  drawSky(ctx, state.ticks);
  drawGround(ctx, state.terrain, state.level, state.rock, state.floors);
  drawRipples(ctx, state.terrain, state.level, state.ticks);
  drawTunnels(ctx, state);
  drawBridges(ctx, state);
  drawGoose(ctx, state);
  for(const d of state.ducks){
    if(d.state === 'saved' || d.state === 'lost') continue;
    drawDuck(ctx, d, state.ticks);
  }
  for(const p of state.poofs) drawPoof(ctx, p);
}

/* A caption under the title screen's demo scene, drawn with the same font as
   the game so the two never look like they belong to different pages. */
export function drawCaption(ctx, text, x, y, key = 'w'){
  drawTextOutlined(ctx, text, x, y, key, 1);
}
