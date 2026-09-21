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
 * Everything that is a sprite, a badge or a piece of built timber is drawn
 * out of those sixteen. The scenery — turf, earth, rock, sky, hills, water —
 * is drawn out of the ramps in ./palette.js, which fill in the steps between
 * them; see that file for why a hillside needs four greens where a duckling
 * needs one. No hex value is written down in here: palette.js holds them all,
 * and a test keeps it that way.
 */

import { PALETTE, hex, drawSprite, drawTextOutlined } from '../good-vibes/pixel.js';
import { GRASS, SOIL, SUBSOIL, STONE, SKY, HILLS, HILL_CROWN, WATER } from './palette.js';
import { SCENE_W, SCENE_H, POOF_TICKS, TUNNEL_HEADROOM, ZAP_TICKS, goalHeading } from './content.js';

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
 * a planted one wears its own red bar instead. Builder is drawn, but not
 * from a held trait the way the rest of BADGE_ORDER is — see drawDuck.
 */
const SKILL_BADGE = {
  digger:  ['...', '..N', 'NNN', '..N'],   // straight ahead — tunnels through
  builder: ['...', 'www', 'w.w', 'w.w'],   // a bridge standing on its legs
  climber: ['.t.', 'ttt', '.t.', '.t.'],   // up — scales the wall
  flyer:   ['c.c', 'ccc', '.c.', '...'],   // wingtips out, gliding
  jumper:  ['.g.', 'g.g', '...', 'ggg'],   // up off the ground, arc and all
  blocker: ['...', 'rrr', 'rrr', '...'],   // the bar a planted duckling wears
};

/* Drawn in this order wherever more than one is held, so the same pair
   always reads the same way round rather than in whatever order they were
   handed out in. Builder is not here — see drawDuck. */
const BADGE_ORDER = ['climber', 'flyer', 'jumper'];

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
 * since nothing else in the scene is that colour to anchor it. Pine is
 * already what a tree-covered ridge looks like everywhere else this palette
 * is used, and palette.js's HILLS is that pine blended a step further toward
 * the horizon's own cyan for each ridge that stands further off — the
 * ordinary trick of aerial perspective: what is far away is paler and
 * cooler, which is what actually tells three overlapping domes apart as
 * near, middle and far rather than as one flat frieze.
 *
 * Furthest first, which is both the order HILLS runs in (palest first) and
 * the order they have to be painted in, so a nearer ridge covers the one
 * standing behind it.
 */
const HILL_SHAPES = [
  { cx: 168, w: 130, h: 22 },
  { cx: 274, w: 110, h: 17 },
  { cx: 44, w: 100, h: 15 },
];

function drawHills(ctx){
  for(let i = 0; i < HILL_SHAPES.length; i++){
    const hill = HILL_SHAPES[i];
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
      ctx.fillStyle = HILLS[i];
      ctx.fillRect(left, y, width, 1);
    }
    // A single brighter row along the crown — sunlight catching the ridge
    // line, the same reasoning drawStoneColumn's paler top edge uses. In this
    // ridge's own light rather than one shared mint pixel on all three: the
    // same highlight on a far hill and a near one flattens exactly what the
    // haze is there to separate.
    const crownY = SKY_SEAM_Y + SKY_SEAM_H + 1;
    ctx.fillStyle = HILL_CROWN[i];
    ctx.fillRect(Math.round(hill.cx - 1), crownY, 2, 1);
  }
}

/* Two puffs drifting at their own speeds, wrapping around once they clear
   the far edge — `ticks` is the sim's own clock (see paintScene), not the
   page's, so the sky moves at the same rate the flock does regardless of
   frame rate. */
/* A cloud is a handful of overlapping discs sitting on one flat base, not a
 * tapered lens. That is what a fair-weather cumulus actually is and, more to
 * the point, it is what every side-on platformer draws: a lumpy top with
 * two or three crowns of different heights, and a bottom ruled straight
 * where the air stops rising. The old shape — one blob, thickest in the
 * middle, dithered edge to edge — read as a smear of static rather than as
 * a cloud, and at four times scale the dither was the only thing you saw.
 *
 * Solid bone through the body with the dither kept for a single fringe row
 * along the underside, which is where a cloud is actually soft.
 * `[dx, dy, r]`: a lobe's offset from the cloud's own origin and its radius.
 */
const CLOUDS = [
  { y: 20, speed: 0.32, lobes: [[-11, 1, 4], [-4, -2, 6], [4, -1, 5], [11, 1, 4]] },
  { y: 40, speed: 0.5,  lobes: [[-7, 0, 3], [0, -2, 5], [7, 0, 4]] },
];

function drawClouds(ctx, ticks){
  for(let i = 0; i < CLOUDS.length; i++){
    const c = CLOUDS[i];
    const span = SCENE_W + 40;
    const x = Math.round(((ticks * c.speed + i * 151) % span) - 20);
    ctx.fillStyle = hex('w');
    for(const [dx, dy, r] of c.lobes){
      for(let py = -r; py <= r; py++){
        const yy = c.y + dy + py;
        if(yy > c.y) continue;                     // the flat underside
        const w = Math.floor(Math.sqrt(r * r - py * py));
        ctx.fillRect(x + dx - w, yy, w * 2 + 1, 1);
      }
    }
    // One soft row under the base, so the cloud is not a cut-out.
    for(const [dx, , r] of c.lobes) ditherSeam(ctx, x + dx - r, c.y + 1, r * 2 + 1, 1, 'w', 'c', 0.55);
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

/* The ramp from the deep blue overhead down to the cyan at the horizon.
 *
 * Stated rather than dithered. Blue and cyan sit a long way apart in the
 * shared palette, so a checkerboard between them is not a blend, it is a
 * checkerboard — bands of it ruled across the sky were more visible than the
 * one hard seam they replaced. palette.js's SKY is that blend mixed properly
 * instead, and it runs lightest first like every ramp there, so it is read
 * from the back: the last entry is the deep overhead, the first is the
 * horizon, and the eight between them are the bands.
 *
 * And spread over the WHOLE sky rather than over the two dozen rows above
 * the horizon. That was all six steps would stretch to without the banding
 * showing, which left seventy rows of flat blue overhead with a gradient
 * squeezed underneath it, and a flat sky with a graded strip at the bottom
 * reads as a flat sky with a strip at the bottom. Nine steps over ninety-six
 * rows is about ten rows to a band, which is gentle enough that no edge
 * announces itself, and it is still nine fillRects.
 */
export function drawSky(ctx, ticks = 0){
  const horizon = SKY_SEAM_Y + SKY_SEAM_H;
  const bands = SKY.length - 1;   // the lightest is the flat band below the horizon
  for(let i = 0; i < bands; i++){
    const top = Math.round(i * horizon / bands);
    ctx.fillStyle = SKY[SKY.length - 1 - i];
    ctx.fillRect(0, top, SCENE_W, Math.round((i + 1) * horizon / bands) - top);
  }
  ctx.fillStyle = SKY[0];
  ctx.fillRect(0, horizon, SCENE_W, SCENE_H - horizon);
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

/* Under the topsoil, subsoil: a second cross-section split rather than one
   flat dirt fill, so a deep column reads as layered ground rather than a
   slab of one colour.

   Capped, like the grass, and that cap matters more than it sounds. It used
   to be a flat 45% of the dirt, which on a hundred-pixel column put a
   fifty-pixel slab of near-black at the bottom of everything — The Spire
   was a brown tower standing on a dark block half its own height, and the
   block read as the more solid thing of the two. Sixteen pixels is a seam
   between the soil and whatever is under it, which is what subsoil is.
   `SUBSOIL_SHARE` still governs a shallow column, where sixteen pixels
   would be the whole of the dirt. */
const SUBSOIL_DEPTH = 16;
const SUBSOIL_SHARE = 0.45;

/* The soil's own weave.
 *
 * Flat oak with a scatter of specks in it was the one part of this scene
 * with no structure at all — at any size above a thumbnail it read as a
 * painted rectangle rather than as ground that had been cut through. Real
 * platformer dirt is drawn as courses: a brick or a woven strand catching
 * light along its top and losing it along its bottom, with the joints
 * offset course to course so the eye reads a weave rather than a grid.
 *
 * Five rows to a course and nine columns to a brick, which at this scene's
 * size puts two or three courses on an ordinary platform and a dozen down
 * The Spire. Anchored to absolute height and absolute column, exactly as
 * the rock strata are (see drawStoneColumn), so the courses run level
 * across a whole formation instead of following its surface up and down —
 * which is the difference between ground that was cut and a pattern that
 * was painted on afterwards.
 */
const BRICK_H = 4;
const BRICK_W = 7;

/* One step either side of the body of the soil — SOIL[1] and SOIL[3] around
 * SOIL[2] — rather than the lit and shadowed tones at either end of the
 * ramp, which the cut faces use. The first cut of this did use those, and at
 * full contrast a course reads as a course of BRICKS: the platforms came out
 * looking like garden walls. Soil is not masonry. The weave wants to be felt
 * rather than counted, so the light and the shade are pulled in to about
 * half their reach and the lit edge is a fleck at the head of each strand
 * rather than a stripe along all of it.
 *
 * Contrast was only half of it, though. A seam drawn under every row of
 * every course and a joint down every column of every brick closes each
 * clod into a box, and a wall of boxes is masonry at any contrast — the tall
 * columns still came out as brickwork. So neither line is ever drawn whole:
 * the seam is a dash under the middle of a clod rather than a rule across
 * the course, the joint is a two-pixel tick rather than a full height, and
 * the same hash the tufts and the rock grain use drops about a fifth of it
 * again. What is left is clods packed against each other with the light
 * catching their heads, which is what a cut bank of earth looks like.
 */
function drawSoilWeave(ctx, x, top, h){
  for(let py = top; py < top + h; py++){
    const course = Math.floor(py / BRICK_H);
    const row = py - course * BRICK_H;
    // Every other course steps half a clod along, which is what stops the
    // joints lining up into columns.
    const along = ((x + (course % 2) * Math.floor(BRICK_W / 2)) % BRICK_W + BRICK_W) % BRICK_W;
    if((Math.imul(x * 31 + course * 131 + 5381, 2246822519) >>> 0) % 5 === 0) continue;
    if(row === BRICK_H - 1 ? along >= 1 && along <= 3 : along === 0 && row >= 1 && row <= 2){
      ctx.fillStyle = SOIL[3];   // the shadow under a clod, and between two
      ctx.fillRect(x, py, 1, 1);
    }else if(row === 0 && along >= 1 && along <= 2){
      ctx.fillStyle = SOIL[1];   // a catch of light on the head of it
      ctx.fillRect(x, py, 1, 1);
    }
  }
}

/* How far the light on an exposed face runs down it. A lip, not a stripe:
   the first pass ran the rim the whole height of the dirt and The Spire's
   stepped face came out looking like paint had run down it. Five pixels
   catches the turn of the edge and stops. */
const EDGE_LIP = 5;

/* How far apart rock's strata run. Small enough that even a short face
   shows two or three of them, which is what the banding is for: it has to
   be legible on a twenty-four-pixel bluff, not just on The Aerie's cliff. */
const STONE_BAND = 5;

/* A column of actual rock (content.js's segment `hard` or the band under a
 * `hardBelow` seam) reads nothing like a column of dirt — no grass cap, no
 * seam, nothing grown on it — cool grey the whole way down, banded with
 * darker strata and capped with a line of shadow at the top.
 *
 * Both of those are the fix for a real complaint: a Digger appeared to
 * tunnel straight through rock. It never did (see sim.js's rockAt, which
 * has always refused), but rock used to be drawn in the same slate as the
 * bottom band of an ordinary dirt column, so the purple a player saw a
 * tunnel bored through on The Warren looked precisely like the purple they
 * could not dig on The Aerie. Dirt is brown going dark violet with depth
 * now, and rock is grey and layered. Two materials, two pictures.
 *
 * The bands are anchored to absolute height rather than to the top of each
 * column, so they run level across a whole formation instead of following
 * its surface up and down — which is what makes them read as strata rather
 * than as a pattern painted on a slope. Every fifth row is a stratum, but
 * not every stratum is the same one: they alternate between the deepest grey
 * and a softer one by height, so a tall face shows beds of different
 * hardness rather than one rule repeated all the way down it. The lit fleck
 * rides the band under each stratum, on a scatter of columns and in the
 * matching brightness, so the grain has a direction without anything having
 * to be stored.
 */
function drawStoneColumn(ctx, x, y, fillH){
  ctx.fillStyle = STONE[2];
  ctx.fillRect(x, y, 1, fillH);

  const grain = Math.imul(x + 7717, 2246822519) >>> 0;
  for(let band = Math.ceil(y / STONE_BAND) * STONE_BAND; band < y + fillH; band += STONE_BAND){
    const deep = Math.floor(band / STONE_BAND) % 2 === 0;
    ctx.fillStyle = deep ? STONE[4] : STONE[3];
    ctx.fillRect(x, band, 1, 1);
    if(band + 1 < y + fillH && (grain >>> (band % 11)) % 3 === 0){
      ctx.fillStyle = deep ? STONE[0] : STONE[1];
      ctx.fillRect(x, band + 1, 1, 1);
    }
  }

  ctx.fillStyle = STONE[4];
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
  ctx.fillStyle = SOIL[3];
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

/* One column of ground, from its surface at `y` down to `bottom`, in whatever
 * cross-section that column calls for: open water on the pond's side of
 * goalX, flat slate for a column of rock, and otherwise a shallow cap of
 * grass over a seam over dirt, with stone under it wherever this column has
 * a `hardBelow` seam of its own.
 *
 * Every ordinary column gets the same cross-section: a shallow cap of grass,
 * a seam, then dirt the rest of the way down. That is what turns the wall —
 * one column with fifty pixels of fill instead of thirty — into something
 * that reads as a cliff with exposed dirt on its face, rather than a taller
 * rectangle of the same flat green. A rock column (`hard`) skips all of that
 * for drawStoneColumn instead — see it for why.
 *
 * Shared by the terrain and by the islands standing over it (see
 * drawIslands), which are made of exactly the same stuff and should read as
 * exactly the same stuff.
 */
function drawGroundColumn(ctx, level, x, y, bottom, isRock, rockBelowY, edge = 0, rockAboveY = null){
  const fillH = bottom - y;
  if(fillH <= 0) return;

  if(isPondAt(level, x)){
    // The two columns nearest the shore get a wet-sand lip instead of
    // water reaching all the way to the surface — a hard cut from grass
    // straight to open water reads as a tile boundary, not a bank.
    const distFromShore = goalHeading(level) === 1 ? x - level.goalX : level.goalX - x;
    drawWaterColumn(ctx, x, y, fillH, distFromShore < 2);
    if(bottom < SCENE_H) drawFloatingEdge(ctx, x, bottom);
    return;
  }

  if(isRock){
    drawStoneColumn(ctx, x, y, fillH);
    if(bottom < SCENE_H) drawFloatingEdge(ctx, x, bottom);
    return;
  }

  /* And the mirror of that: rock from the surface down to a seam, with
   * diggable earth under it — content.js's `hardAbove`, a crag standing on an
   * earth base. Drawn as the two things it is: a stone column down to the
   * seam, then ordinary ground carrying on below, with no grass anywhere
   * because nothing grows on the top of a crag. The ground below gets no
   * grass either, since it is under a hill rather than out in the light.
   */
  if(rockAboveY != null && rockAboveY > y){
    const cap = Math.min(bottom, rockAboveY);
    drawStoneColumn(ctx, x, y, cap - y);
    if(cap < bottom){
      ctx.fillStyle = SOIL[2];
      ctx.fillRect(x, cap, 1, bottom - cap);
      if(bottom - cap > 2) drawSoilWeave(ctx, x, cap + 1, bottom - cap - 1);
      // A line of ink where the stone sits on the earth, the same seam the
      // turf gets where it sits on soil.
      ctx.fillStyle = hex('k');
      ctx.fillRect(x, cap, 1, 1);
    }
    if(bottom < SCENE_H) drawFloatingEdge(ctx, x, bottom);
    return;
  }

  /* A column can also be dirt down to a certain height and rock below that
     — see content.js's `hardBelow` and sim.js's rockAt. Where the two meet
     is the whole of what such a wall is about, since a Digger can only get
     through above it, so it is drawn as the stone it is rather than left
     looking like ordinary dirt a tunnel ought to go straight through. */
  const stoneTop = rockBelowY != null ? Math.max(y, Math.min(bottom, rockBelowY)) : bottom;
  const softH = stoneTop - y;

  const grassH = Math.min(GRASS_DEPTH, softH);
  ctx.fillStyle = GRASS[2];
  ctx.fillRect(x, y, 1, grassH);
  /* The turf's sunlit crown, and a lip of it hanging a pixel over the edge
     on the swell of a slow wave. A platform's top used to be ruled dead
     straight for its whole length, which is the one line in this scene
     nothing in nature draws: grass sits on soil in a rolling scallop, and
     four pixels of wavelength is enough to read as one without costing the
     flock a single pixel of the surface they actually walk on — the lip is
     drawn above `y`, never into it. The lip is a step brighter than the
     crown, because a blade standing clear of the turf is catching the light
     from more than one side. */
  if(grassH > 1){
    ctx.fillStyle = GRASS[1];
    ctx.fillRect(x, y, 1, 1);
    if(Math.sin(x * 0.68) + Math.sin(x * 0.23) > 0.75){
      ctx.fillStyle = GRASS[0];
      ctx.fillRect(x, y - 1, 1, 1);
    }
  }
  /* The underside of the turf, going into its own shadow in steps rather
     than in one drop. Grass used to fall straight from its body colour to
     pine, which is nearly black beside it, and a cut bank of it read as a
     green rectangle sitting on a brown one. Three tones over the lower half
     of the cap — a couple of rows each, so the light rolls off rather than
     stopping — is a cap of turf with a thickness to it. */
  if(grassH > 6){
    ctx.fillStyle = GRASS[3];
    ctx.fillRect(x, y + grassH - 6, 1, 2);
    ctx.fillStyle = GRASS[4];
    ctx.fillRect(x, y + grassH - 4, 1, 2);
    ctx.fillStyle = GRASS[5];
    ctx.fillRect(x, y + grassH - 2, 1, 2);
  }else if(grassH > 3){
    ctx.fillStyle = GRASS[4];
    ctx.fillRect(x, y + grassH - 2, 1, 1);
    ctx.fillStyle = GRASS[5];
    ctx.fillRect(x, y + grassH - 1, 1, 1);
  }

  const dirtH = softH - grassH;
  if(dirtH > 0){
    const subsoilH = Math.min(SUBSOIL_DEPTH, Math.round(dirtH * SUBSOIL_SHARE));
    const soilH = dirtH - subsoilH;
    ctx.fillStyle = SOIL[2];
    ctx.fillRect(x, y + grassH, 1, soilH);
    // The courses, over the flat fill and under everything else.
    if(soilH > 2) drawSoilWeave(ctx, x, y + grassH + 1, soilH - 1);
    // The last rows of the soil, darkening into whatever is under it, so
    // the two bands meet in a gradation rather than a cut. Without it the
    // boundary was as hard as the ink seam at the top of the dirt, and
    // read as a third material rather than as the bottom of the second.
    if(soilH > 4){
      ctx.fillStyle = SOIL[4];
      ctx.fillRect(x, y + grassH + soilH - 2, 1, 1);
      ctx.fillStyle = SOIL[5];
      ctx.fillRect(x, y + grassH + soilH - 1, 1, 1);
    }
    if(subsoilH > 0){
      // Subsoil, and deliberately darker than the grey rock is drawn in
      // rather than the same colour it used to be — see drawStoneColumn
      // for what that cost. Lighter where it meets the soil and deeper at
      // the bottom, the same reasoning as the turf above it: a band with
      // its own light in it reads as a layer, a flat one as a slab.
      const top = y + grassH + soilH;
      ctx.fillStyle = SUBSOIL[1];
      ctx.fillRect(x, top, 1, subsoilH);
      ctx.fillStyle = SUBSOIL[0];
      ctx.fillRect(x, top, 1, 1);
      if(subsoilH > 3){
        ctx.fillStyle = SUBSOIL[2];
        ctx.fillRect(x, top + subsoilH - 2, 1, 1);
        ctx.fillStyle = SUBSOIL[3];
        ctx.fillRect(x, top + subsoilH - 1, 1, 1);
      }
    }
    // The seam itself, one row of ink, so the cap reads as sitting on the
    // dirt rather than fading into it.
    ctx.fillStyle = hex('k');
    ctx.fillRect(x, y + grassH, 1, 1);
  }
  if(stoneTop < bottom) drawStoneColumn(ctx, x, stoneTop, bottom - stoneTop);

  /* The rim of an exposed face, lit from the right because that is where
     the sun is (see SUN_X). `edge` is +1 for a face whose right-hand side
     is open air and -1 for one whose left is; a column with ground either
     side of it gets neither. One pixel wide, which at this scale is the
     difference between a cliff with a shape and a stack of coloured
     rectangles. */
  if(edge !== 0 && !isRock){
    ctx.fillStyle = edge > 0 ? GRASS[0] : GRASS[5];
    ctx.fillRect(x, y, 1, Math.min(2, fillH));
    const dirtTop = y + grassH;
    const lip = Math.min(Math.max(0, stoneTop - dirtTop - 1), EDGE_LIP);
    if(lip > 0){
      ctx.fillStyle = edge > 0 ? SOIL[0] : SOIL[4];
      ctx.fillRect(x, dirtTop + 1, 1, lip);
    }
  }

  if(bottom < SCENE_H) drawFloatingEdge(ctx, x, bottom);
}

/* Which way an exposed face at this column looks, or 0 for a column with
   ground of about its own height either side. A neighbour a real step lower
   (or missing entirely, which is what a gap is) leaves this column's side
   showing, and the side that shows is the one that catches the light or
   loses it. Right-hand faces are lit; left-hand ones are in shadow. */
function faceEdge(terrain, x, y){
  const right = x + 1 < terrain.length ? terrain[x + 1] : SCENE_H + 200;
  const left = x > 0 ? terrain[x - 1] : SCENE_H + 200;
  if(right - y > WALK_FACE) return 1;
  if(left - y > WALK_FACE) return -1;
  return 0;
}

/* How much lower a neighbour has to be before this column counts as having
   a face rather than a slope. Matched to the game's own WALK_STEP: what a
   duckling steps over without noticing should not be drawn as a cliff. */
const WALK_FACE = 4;

/* The terrain height array, painted column by column from each surface down
 * to either the bottom of the scene or, for a floating segment, no further
 * than its own `floor` (see content.js's header note) — open air below that
 * is the absence of ground, exactly the way a gap's columns already are. A
 * gap's columns sit far below SCENE_H (see content.js's PIT_Y), so they
 * simply paint nothing at all either way.
 */
export function drawGround(ctx, terrain, level, rock, floors, rockBelow, rockAbove){
  for(let x = 0; x < terrain.length; x++){
    const y = terrain[x];
    if(y >= SCENE_H) continue;
    const bottom = Math.min(floors ? floors[x] : SCENE_H, SCENE_H);
    drawGroundColumn(ctx, level, x, y, bottom,
      Boolean(rock && rock[x]), rockBelow ? rockBelow[x] : null,
      faceEdge(terrain, x, y), rockAbove ? rockAbove[x] : null);
  }
  drawTufts(ctx, terrain, level, rock);
  drawFlowers(ctx, terrain, level, rock);
  drawSoilGrain(ctx, terrain, level, rock, floors);
  drawSubsoilSpeckle(ctx, terrain, level, rock, floors);
  drawIslands(ctx, level);
  drawNest(ctx, level, terrain);
  // The pond's own decoration follows the pond, which is not always the
  // ground: The Stepping Stones' sits on the top island. See pondRow.
  const water = pondRow(level, terrain);
  drawCattails(ctx, level, water);
  drawLilyPads(ctx, water, level);
}

/* An island's slab is a stretch of ordinary ground that happens to be up in
 * the air — same grass, same seam, same dirt, and the same hanging roots
 * along its cut underside that any other floating segment gets. It is drawn
 * after the terrain rather than with it because it stands over that terrain
 * rather than replacing it: the ground below carries on underneath, and the
 * walkway there is real (see content.js's header note on `islands`, and
 * sim.js's surfacesAt).
 *
 * An island wants a `floor` — it is a slab hanging in open air, and one
 * without a stated underside would be drawn all the way to the bottom of
 * the scene, which is a pillar, not an island. Left off, it gets a
 * shallow one rather than that.
 */
const ISLAND_DEPTH = 14;

export function drawIslands(ctx, level){
  for(const isle of level.islands ?? []){
    const bottom = Math.min(isle.floor ?? isle.y + ISLAND_DEPTH, SCENE_H);
    const from = Math.max(0, isle.from), to = Math.min(SCENE_W, isle.to);
    for(let x = from; x < to; x++){
      // An island is all face: open air at both ends of it.
      const edge = x === to - 1 ? 1 : (x === from ? -1 : 0);
      drawGroundColumn(ctx, level, x, isle.y, bottom, Boolean(isle.hard), null, edge);
    }
    drawTufts(ctx, tuftRow(level, isle), level, null);
  }
}

/* The surface the water actually sits on at each column: the terrain,
   except where an island stands over it, in which case the island's own
   top. Every pond in this game but one is on the ground and this hands back
   `terrain` unchanged for them; the one that is not is The Stepping Stones'
   (see content.js), and its ripples, lily pads and cattails would otherwise
   be drawn a hundred and twenty pixels below the water. */
function pondRow(level, terrain){
  if(!level.islands?.length) return terrain;
  const row = terrain.slice();
  for(const isle of level.islands){
    for(let x = Math.max(0, isle.from); x < Math.min(row.length, isle.to); x++){
      if(isle.y < row[x]) row[x] = isle.y;
    }
  }
  return row;
}

/* A height array shaped like `terrain` but empty everywhere except this one
   island, so the same scatter that decorates the ground decorates an island
   top too without knowing anything about islands. */
function tuftRow(level, isle){
  const row = new Array(SCENE_W).fill(SCENE_H + 200);
  for(let x = Math.max(0, isle.from); x < Math.min(SCENE_W, isle.to); x++) row[x] = isle.y;
  return row;
}

/* A hole bored through a wall, one per tunnelled column — see sim.js's
 * stepDigging and content.js's header note on why this is a second layer
 * rather than `terrain` itself getting shorter. Ink rather than sky: this is
 * the inside of a hillside, not a view out of one, and a bore this small
 * reading as open air would look like the wall had simply been erased.
 * A sliver of the deepest soil along the floor is what keeps the cut edge
 * legible against the ink — without it the hole and the duck walking through
 * it blur into the same flat black — and it is soil rather than the slate it
 * used to be because the floor of a bore through a hillside is the hillside.
 */
function drawTunnels(ctx, state){
  const { terrain, tunnels } = state;
  for(let x = 0; x < tunnels.length; x++){
    // Every cut through this column, not just one: two tunnels crossing
    // leave two holes with hillside between them — see sim.js's `tunnels`.
    for(const floor of tunnels[x]){
      const top = Math.max(terrain[x], floor - TUNNEL_HEADROOM);
      if(floor <= top) continue;
      ctx.fillStyle = hex('k');
      ctx.fillRect(x, top, 1, floor - top);
      ctx.fillStyle = SOIL[4];
      ctx.fillRect(x, floor - 1, 1, 1);
    }
  }
}

/* How thick a Builder's deck reads, and how far apart its support posts
   stand — a post every few columns rather than one per column, the same
   "suggest it, do not render every plank" economy the grass tufts and rock
   speckle use elsewhere in this file. */
const BRIDGE_DECK_H = 2;
const BRIDGE_POST_GAP = 8;
const BRIDGE_POST_H = 5;

/* Ramp decks, drawn a column at a time rather than as flat runs — see
 * sim.js's stepBuilding, which climbs a fraction of a pixel a column, so
 * each column's own height is its own point on the slope. A column can carry
 * more than one: ramps cross, and both are still standing and both still
 * walkable (see sim.js's `decks` and surfacesAt), so both are drawn.
 * `terrain` under a deck is untouched — still open pit where the ramp
 * crosses a gap (see buildTerrain) — which is what makes a ramp read as a
 * thing standing over the scene rather than the ground quietly changing
 * shape.
 */
function drawBridges(ctx, state){
  const { decks } = state;
  for(let x = 0; x < decks.length; x++){
    for(const y of decks[x]){
      ctx.fillStyle = hex('N');
      ctx.fillRect(x, y, 1, BRIDGE_DECK_H);
      ctx.fillStyle = hex('k');
      ctx.fillRect(x, y, 1, 1);
      // A post every few columns rather than one per column — the same
      // "suggest it, do not render every plank" economy the grass tufts and
      // rock speckle use elsewhere in this file — hung from this column's
      // own height, which is what keeps the posts tracing the slope rather
      // than fanning out from underneath a flat deck.
      if(x % BRIDGE_POST_GAP === 0){
        ctx.fillStyle = hex('n');
        ctx.fillRect(x, y + BRIDGE_DECK_H, 1, BRIDGE_POST_H);
      }
    }
  }
}

/* The pond: a wet-sand lip where the shore actually meets the water, a lit
 * line along the surface, and then bands stepping down palette.js's WATER
 * into the deep, so a pond reads as a body of water with a bed sloping away
 * from its edge rather than a tinted floor tile. `bank` is only true for the
 * column or two right at the shoreline (see drawGround) — everywhere else
 * the shallows start right at the surface.
 *
 * Stated rather than dithered, for the same reason the sky above it is: the
 * step from cyan to blue used to be a two-row checkerboard, which is a
 * checkerboard, not a blend. WATER carries the step between them now.
 */
const WATER_BANDS = [3, 2, 3];   // shallow, mid, deep — the bed takes the rest

function drawWaterColumn(ctx, x, y, fillH, bank){
  let top = y, remaining = fillH;
  if(bank && remaining > 1){
    ctx.fillStyle = SOIL[1];
    ctx.fillRect(x, top, 1, 1);
    top += 1;
    remaining -= 1;
  }
  let py = top;
  for(let i = 0; i < WATER_BANDS.length && py < top + remaining; i++){
    const h = Math.min(WATER_BANDS[i], top + remaining - py);
    ctx.fillStyle = WATER[i + 1];
    ctx.fillRect(x, py, 1, h);
    py += h;
  }
  if(py < top + remaining){
    ctx.fillStyle = WATER[WATER.length - 1];
    ctx.fillRect(x, py, 1, top + remaining - py);
  }
  // The surface itself, one lit row, which is what tells the top of the
  // water from the next band down at a glance.
  if(remaining > 0){
    ctx.fillStyle = WATER[0];
    ctx.fillRect(x, top, 1, 1);
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
  ctx.fillStyle = WATER[0];
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
    // Two greens off the top of the turf's own ramp. These used to be grass
    // and mint, and mint is the pond's colour: a lawn speckled with it read
    // as wet rather than as long in places.
    ctx.fillStyle = (h >>> 17) & 1 ? GRASS[0] : GRASS[1];
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

/* A scatter of dark flecks through the subsoil under ordinary dirt — the
   same fixed-count hash technique as the tufts and flowers, seeded a third
   way, so the band below the soil reads as grit rather than a second flat
   fill. Only ever a few dozen pixels regardless of how much ground is on
   screen, same as every other scatter here. Skipped on an actual rock
   column (`hard`): that has its own strata (see drawStoneColumn) and none
   of the grass-then-soil-then-subsoil banding this is speckling. */
const SPECKLE_COUNT = 40;

/* And a second, larger scatter of darker oak through the topsoil above it.
   The soil band is the biggest flat area in the whole picture — The
   Warren's wall is eighty pixels of one brown — and a fill that size with
   nothing in it reads as a painted rectangle rather than as a cut through
   ground. Same fixed-count hash, seeded a fourth way. */
const GRAIN_COUNT = 90;

function drawSoilGrain(ctx, terrain, level, rock, floors){
  ctx.fillStyle = SOIL[3];
  for(let i = 0; i < GRAIN_COUNT; i++){
    const h = Math.imul(i + 3313, 2654435761) >>> 0;
    const x = h % terrain.length;
    const y = terrain[x];
    if(y >= SCENE_H || isPondAt(level, x) || (rock && rock[x])) continue;
    const bottom = Math.min(floors ? floors[x] : SCENE_H, SCENE_H);
    const fillH = bottom - y;
    if(fillH <= 0) continue;
    const grassH = Math.min(GRASS_DEPTH, fillH);
    const dirtH = fillH - grassH;
    const soilH = dirtH - Math.min(SUBSOIL_DEPTH, Math.round(dirtH * SUBSOIL_SHARE));
    if(soilH <= 2) continue;
    const dy = 1 + (h >>> 9) % (soilH - 1);
    ctx.fillRect(x, y + grassH + dy, 1, 1);
  }
}

function drawSubsoilSpeckle(ctx, terrain, level, rock, floors){
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
    const subsoilH = Math.min(SUBSOIL_DEPTH, Math.round(dirtH * SUBSOIL_SHARE));
    if(subsoilH <= 0) continue;
    const dy = (h >>> 11) % subsoilH;
    ctx.fillRect(x, y + grassH + (dirtH - subsoilH) + dy, 1, 1);
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
    ctx.fillStyle = GRASS[5];
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
    ctx.fillStyle = GRASS[4];
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

  /* A scrap of shadow on whatever it is standing on. Four pixels of ink at
     a third strength, and it is the single cheapest thing in this file:
     without it a duckling is a yellow shape floating a pixel above the
     grass, and with it the flock is standing on the level. Skipped while
     one is in the air, where there is nothing under it to cast onto. */
  if(d.state !== 'falling' && d.state !== 'jumping'){
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = hex('k');
    ctx.fillRect(x + 1, Math.round(d.y), 4, 1);
    ctx.globalAlpha = 1;
  }

  drawSprite(ctx, DUCK_ART, x, y, d.dir < 0);

  if(d.state === 'blocking'){
    ctx.fillStyle = hex('r');
    ctx.fillRect(x + 1, y - 3, 4, 2);
    return;
  }

  /* Every state a duckling can be carrying something in, not just walking:
     the one currently climbing the wall or laying a ramp is exactly the one
     you most want to be able to pick out of the flock, and it was the one
     showing nothing at all. Builder is never in `d.traits` (see sim.js's
     assignSkill) — it is drawn straight from the state itself, for exactly
     as long as that duckling is actively building and not a tick longer,
     which is the one badge here that is not saying "this is held" but "this
     is happening right now". */
  const held = BADGE_ORDER.filter(skill => d.traits.has(skill));
  if(d.state === 'building') held.unshift('builder');
  // Digger acts on the click too, so like Builder it is shown while it is
  // happening rather than carried as a mark over a duckling's head.
  if(d.state === 'digging') held.unshift('digger');
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

/* A teleporter pad: a shallow dish of mint sunk into whatever it is standing
 * on, with two posts at its corners and a spark hanging between them. Drawn
 * in a colour nothing else in this scene uses — no grass, no dirt, no duck,
 * no goose is mint — because the one thing a pad has to do before a player
 * has ever seen one work is read as "this is not scenery".
 *
 * Both ends of a pair are drawn identically, because both ends work the same
 * way (see sim.js's padUnder). A pad that looked like an entrance and a pad
 * that looked like an exit would be saying something about this game that
 * is not true.
 */
function drawPad(ctx, pad, ticks){
  const x = Math.round(pad.x), y = Math.round(pad.y);
  // The dish: a slab of mint on an ink shadow, sitting on the surface
  // rather than hovering over it.
  ctx.fillStyle = hex('k');
  ctx.fillRect(x - 4, y - 1, 9, 1);
  ctx.fillStyle = hex('t');
  ctx.fillRect(x - 4, y - 3, 9, 2);
  ctx.fillStyle = hex('w');
  ctx.fillRect(x - 4, y - 3, 9, 1);

  /* The posts are plum rather than anything in the mint-and-cyan family the
     rest of the pad uses, which looks like an odd choice written down and is
     not: the sky behind a pad standing on an island is very close to cyan,
     and two cyan posts against it disappeared completely. Plum is the one
     colour in this palette that holds up against both the sky and grass. */
  ctx.fillStyle = hex('p');
  ctx.fillRect(x - 4, y - 7, 1, 4);
  ctx.fillRect(x + 4, y - 7, 1, 4);

  // The spark between the posts, blinking on its own slow beat so a pad
  // standing untouched still reads as something powered rather than a
  // painted marking.
  const lit = Math.floor(ticks / 7) % 3 !== 0;
  ctx.fillStyle = hex(lit ? 'w' : 't');
  ctx.fillRect(x, y - 7, 1, 1);
  if(lit){
    ctx.fillStyle = hex('t');
    ctx.fillRect(x - 2, y - 6, 5, 1);
  }
}

/* The flash at both ends of a trip, fired by sim.js the moment a duckling
   goes through and aged out the same way a poof is. A ring opening outward
   rather than a puff drifting up — the shape says "something arrived here",
   which is the half of a teleport the eye would otherwise miss entirely at
   the far end of the level. */
function drawZap(ctx, z){
  const t = z.age / ZAP_TICKS;
  const r = 1 + Math.round(t * 5);
  const cx = Math.round(z.x), cy = Math.round(z.y) - 3;
  ctx.fillStyle = hex(t < 0.5 ? 'w' : 't');
  ctx.fillRect(cx - r, cy, 1, 1);
  ctx.fillRect(cx + r, cy, 1, 1);
  ctx.fillRect(cx, cy - r, 1, 1);
  ctx.fillRect(cx, cy + Math.min(r, 2), 1, 1);
  const d = Math.round(r * 0.7);
  ctx.fillRect(cx - d, cy - d, 1, 1);
  ctx.fillRect(cx + d, cy - d, 1, 1);
}

/* ------------------------------------------------------------------ scene */

/* The whole picture, in back-to-front order. `state` is a sim.js game state;
   nothing here mutates it. */
export function paintScene(ctx, state){
  drawSky(ctx, state.ticks);
  drawGround(ctx, state.terrain, state.level, state.rock, state.floors, state.rockBelow, state.rockAbove);
  drawRipples(ctx, pondRow(state.level, state.terrain), state.level, state.ticks);
  drawTunnels(ctx, state);
  drawBridges(ctx, state);
  for(const pad of state.pads) drawPad(ctx, pad, state.ticks);
  drawGoose(ctx, state);
  for(const d of state.ducks){
    if(d.state === 'saved' || d.state === 'lost') continue;
    drawDuck(ctx, d, state.ticks);
  }
  for(const p of state.poofs) drawPoof(ctx, p);
  for(const z of state.zaps) drawZap(ctx, z);
}

/* A caption under the title screen's demo scene, drawn with the same font as
   the game so the two never look like they belong to different pages. */
export function drawCaption(ctx, text, x, y, key = 'w'){
  drawTextOutlined(ctx, text, x, y, key, 1);
}
