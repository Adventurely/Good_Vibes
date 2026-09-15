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
import { SCENE_W, SCENE_H } from './content.js';

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

/* A duckling standing still with a skill in hand gets a small mark over its
   head, so a busy one reads as busy at a glance rather than only on click. */
const SKILL_MARK = { digger: 'N', builder: 'o', blocker: 's', climber: 'c' };

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
   reads as a speed bump; three at different widths and heights read as a range.
   Each is drawn one row at a time, narrowing toward the top, the same technique
   Sunward's clouds use for the same reason: a shape built from a few dozen
   short horizontal runs costs nothing next to filling it pixel by pixel.
   Static rather than parallaxed — the flock never gets far enough from the
   camera for a fixed background to give the game away. */
const HILLS = [
  { cx: 44, w: 100, h: 15, key: 's' },
  { cx: 168, w: 130, h: 22, key: 'v' },
  { cx: 274, w: 110, h: 17, key: 's' },
];

function drawHills(ctx){
  for(const hill of HILLS){
    ctx.fillStyle = hex(hill.key);
    for(let row = 0; row < hill.h; row++){
      const y = SKY_SEAM_Y + SKY_SEAM_H + hill.h - row;
      if(y >= SCENE_H) continue;
      // A dome: wide at the base, narrowing to nothing at the crown, along
      // a quarter-circle rather than a triangle so the skyline curves.
      const t = row / hill.h;
      const width = Math.round(hill.w * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))));
      if(width <= 0) continue;
      ctx.fillRect(Math.round(hill.cx - width / 2), y, width, 1);
    }
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

export function drawSky(ctx, ticks = 0){
  ctx.fillStyle = hex('b');
  ctx.fillRect(0, 0, SCENE_W, SKY_SEAM_Y);
  ditherSeam(ctx, 0, SKY_SEAM_Y, SCENE_W, SKY_SEAM_H, 'b', 'c', 0.5);
  ctx.fillStyle = hex('c');
  ctx.fillRect(0, SKY_SEAM_Y + SKY_SEAM_H, SCENE_W, SCENE_H - SKY_SEAM_Y - SKY_SEAM_H);
  drawClouds(ctx, ticks);
  drawHills(ctx);
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

/* The terrain height array, filled column by column from its surface to the
 * bottom of the scene. A gap's columns sit far below SCENE_H (see content.js's
 * PIT_Y), so they simply paint nothing at all — an open chasm is the absence
 * of ground, not a colour of its own.
 *
 * Every column short of a pit gets the same cross-section: a shallow cap of
 * grass, a seam, then dirt the rest of the way down. That is what turns the
 * wall — one column with fifty pixels of fill instead of thirty — into
 * something that reads as a cliff with exposed dirt on its face, rather
 * than a taller rectangle of the same flat green.
 */
export function drawGround(ctx, terrain, level){
  for(let x = 0; x < terrain.length; x++){
    const y = terrain[x];
    if(y >= SCENE_H) continue;
    const fillH = SCENE_H - y;

    if(x >= level.goalX){
      drawWaterColumn(ctx, x, y, fillH);
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
  }
  drawTufts(ctx, terrain, level);
  drawFlowers(ctx, terrain, level);
  drawNest(ctx, level, terrain);
}

/* The pond: two bands of blue with a dithered seam, the same trick the sky
   uses, so the water reads as lit from above rather than as a flat tile. */
function drawWaterColumn(ctx, x, y, fillH){
  const shallow = Math.min(3, fillH);
  ctx.fillStyle = hex('c');
  ctx.fillRect(x, y, 1, shallow);
  if(fillH > shallow){
    ditherSeam(ctx, x, y + shallow, 1, Math.min(2, fillH - shallow), 'c', 'b', 0.5);
    const deepY = y + shallow + Math.min(2, fillH - shallow);
    if(deepY < y + fillH){
      ctx.fillStyle = hex('b');
      ctx.fillRect(x, deepY, 1, y + fillH - deepY);
    }
  }
}

/* Tufts of longer grass, scattered by a hash rather than stored, so the
   count stays fixed regardless of how much ground there is to decorate —
   the same reasoning Sunward's ground tufts use. A flat cap with nothing
   growing out of it reads as a floor tile; this is what makes it read as a
   lawn instead. */
const TUFT_COUNT = 90;

function drawTufts(ctx, terrain, level){
  for(let i = 0; i < TUFT_COUNT; i++){
    const h = Math.imul(i + 7, 2246822519) >>> 0;
    const x = h % terrain.length;
    const y = terrain[x];
    if(y >= SCENE_H || x >= level.goalX) continue;
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

function drawFlowers(ctx, terrain, level){
  for(let i = 0; i < FLOWER_COUNT; i++){
    const h = Math.imul(i + 401, 2654435761) >>> 0;
    const x = h % terrain.length;
    const y = terrain[x];
    if(y >= SCENE_H || x >= level.goalX) continue;
    ctx.fillStyle = hex(FLOWER_COLOURS[(h >>> 13) % FLOWER_COLOURS.length]);
    ctx.fillRect(x, y - 1, 1, 1);
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

/* ------------------------------------------------------------------ goose */

export function drawGoose(ctx, state){
  const g = state.level.goose;
  const x = Math.round(state.goose.x) - 4;
  const y = g.y - GOOSE_ART.length;
  drawSprite(ctx, GOOSE_ART, x, y, state.goose.dir < 0);
}

/* ----------------------------------------------------------------- a duck */

export function drawDuck(ctx, d){
  const x = Math.round(d.x) - 3;
  const y = Math.round(d.y) - DUCK_ART.length;
  drawSprite(ctx, DUCK_ART, x, y, d.dir < 0);

  if(d.state === 'blocking'){
    ctx.fillStyle = hex('r');
    ctx.fillRect(x + 1, y - 3, 4, 2);
  } else if(d.state === 'walking' && d.traits.size){
    // One small mark per trait held, side by side — a duckling can carry
    // more than one at once, and all of them should show, not just one.
    let mx = x;
    for(const skill of d.traits){
      const key = SKILL_MARK[skill];
      if(!key) continue;
      ctx.fillStyle = hex(key);
      ctx.fillRect(mx, y - 3, 2, 2);
      mx += 3;
    }
  }
}

/* ------------------------------------------------------------------ scene */

/* The whole picture, in back-to-front order. `state` is a sim.js game state;
   nothing here mutates it. */
export function paintScene(ctx, state){
  drawSky(ctx, state.ticks);
  drawGround(ctx, state.terrain, state.level);
  drawGoose(ctx, state);
  for(const d of state.ducks){
    if(d.state === 'saved' || d.state === 'lost') continue;
    drawDuck(ctx, d);
  }
}

/* A caption under the title screen's demo scene, drawn with the same font as
   the game so the two never look like they belong to different pages. */
export function drawCaption(ctx, text, x, y, key = 'w'){
  drawTextOutlined(ctx, text, x, y, key, 1);
}
