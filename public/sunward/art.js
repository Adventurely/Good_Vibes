/* Sunward — the lot, drawn.
 *
 * One scene, painted at 320x240 and scaled up by whole numbers, and one entry
 * point: `paintLot`. The game page calls it sixty times a second and the shelf
 * on the front page calls it once for its thumbnail, which is the reason it
 * takes everything it needs as arguments and reads nothing from anywhere — the
 * card on the shelf is this scene, not a screenshot of it that goes stale the
 * next time somebody repaints a sky.
 *
 * The palette and the font are imported from the other game rather than
 * copied. Good Vibes' art.js keeps a copy of Solarium's palette and says why:
 * the two are synced from different repositories, so an import would only
 * resolve on the deployed site. That does not apply here — Sunward lives in
 * this repo and ships in the same deploy — and the alternative is a second
 * copy of sixteen hex values that drifts the first time one of them is tuned.
 *
 * --- The tree is grown, not drawn -----------------------------------------
 *
 * There is no tree sprite. It is a recursion over limbs whose depth, length
 * and trunk width all come off one number, `growth`, which is how many growers
 * are on the lot. A player who plants forty things sees a bigger tree than one
 * who planted four, and neither of them is a sprite anybody had to author.
 * Nothing in it is random: the angles are fixed and the only thing that moves
 * is a sway term threaded through from the caller, so the same lot draws the
 * same tree on every frame and in every session.
 *
 * --- Night is a remap, not a wash -----------------------------------------
 *
 * Everything on this canvas is one flat opaque palette colour. Darkening by
 * drawing black over the top at low alpha would put 200 blended colours on a
 * 16-colour screen, so instead every key is looked up through `shade`, which
 * swaps it for a darker key from the same palette as the sun goes down. Sixteen
 * colours at noon and sixteen colours at midnight; different sixteen.
 */

import { PALETTE, hex } from '../good-vibes/pixel.js';

export { PALETTE, hex };

/* The scene's own size. Both callers author against these rather than against
   whatever their canvas happens to be, and scale the element instead.

   Four by three rather than sixteen by nine, which is where this started. A
   320x180 letterbox on a phone held upright is a strip across the top of a
   screen with six hundred pixels of nothing under it, and the thing the strip
   is showing is a tall tree. The extra sixty rows go mostly to the sky, which
   is where the sun spends its day, and the rest to the lot. */
export const SCENE_W = 320;
export const SCENE_H = 240;

/* Where the lot's floor is: seven tenths of the way down, so the sky gets the
   larger share. Everything that stands on the ground is anchored to this line
   and nothing hardcodes the number anywhere else. */
export const GROUND_Y = 168;

/* ------------------------------------------------------------------ light */

/* Which key stands in for which when the light goes. Two steps down, applied
 * once below the horizon and twice in the small hours, so a green leaf goes
 * pine and then violet rather than going grey — a night scene drawn in greys
 * reads as a black-and-white photograph of a day scene.
 */
const DARKER = {
  w: 's', y: 'o', o: 'r', r: 'p', n: 'N', N: 'v', g: 'G', G: 'v',
  t: 'c', c: 'b', b: 's', s: 'v', v: 'd', p: 'v', d: 'k', k: 'k',
};

/* `light` is the sun's height, +1 at noon and -1 at midnight. */
export function shade(key, light){
  let out = key;
  if(light < 0.06) out = DARKER[out] || out;
  if(light < -0.45) out = DARKER[out] || out;
  return out;
}

const fill = (ctx, key, light, x, y, w = 1, h = 1) => {
  ctx.fillStyle = hex(shade(key, light));
  ctx.fillRect(x | 0, y | 0, w, h);
};

/* ------------------------------------------------------------------ dither */

/* A 4x4 ordered matrix, the same one the other games grade their ground with.
   Ordered rather than random because a random dither crawls: every redraw
   picks different pixels and a still sky boils. */
const BAYER = [
  [0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5],
];

/* Fill a rectangle with a mix of two keys, `t` of the way from a to b. */
export function ditherRect(ctx, x, y, w, h, a, b, t, light = 1){
  const level = Math.max(0, Math.min(1, t)) * 16;
  const keyA = hex(shade(a, light));
  const keyB = hex(shade(b, light));
  for(let py = 0; py < h; py++){
    for(let px = 0; px < w; px++){
      const threshold = BAYER[(y + py) & 3][(x + px) & 3];
      ctx.fillStyle = level > threshold ? keyB : keyA;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

/* ------------------------------------------------------------------- sky */

/* Nine skies, and every minute in between is a dither between the two it falls
 * between. Named by where the sun is rather than by the hour, because that is
 * what the growers read too.
 *
 * Nine rather than four, which is where this started, because an ordered
 * dither between two colours that are far apart does not read as a blend — it
 * reads as speckle. Halfway between midnight ink and dawn plum is not a dusky
 * violet, it is black with bright pink dots in a 4x4 grid, which looks like a
 * fault in the screen. Neighbouring stops that are already close is the whole
 * fix: every pair below is one or two steps apart in the palette.
 */
export const SKIES = [
  { at: 0.00, top: 'd', mid: 'p', low: 'o' },   // first light
  { at: 0.08, top: 'v', mid: 'r', low: 'y' },   // sunrise
  { at: 0.18, top: 'b', mid: 'c', low: 'w' },   // morning
  { at: 0.32, top: 'b', mid: 'c', low: 'w' },   // noon
  { at: 0.42, top: 'b', mid: 'c', low: 'y' },   // afternoon
  { at: 0.50, top: 'v', mid: 'r', low: 'o' },   // dusk
  { at: 0.58, top: 'd', mid: 'v', low: 'r' },   // twilight
  { at: 0.70, top: 'k', mid: 'd', low: 'v' },   // night
  { at: 0.86, top: 'k', mid: 'd', low: 'd' },   // the small hours
];

/* The two skies either side of a phase, and how far between them it is. */
export function skyBlend(phase){
  const p = ((phase % 1) + 1) % 1;
  for(let i = 0; i < SKIES.length; i++){
    const a = SKIES[i];
    const b = SKIES[(i + 1) % SKIES.length];
    const to = i === SKIES.length - 1 ? 1 : b.at;
    if(p >= a.at && p < to) return { a, b, t: (p - a.at) / (to - a.at) };
  }
  return { a: SKIES[SKIES.length - 1], b: SKIES[0], t: 0 };
}

/* A sky's key at a height, as the pair either side of it and how far between.
   Top to mid over the upper half, mid to low over the lower. */
function skyStop(sky, v){
  return v < 0.5
    ? { a: sky.top, b: sky.mid, t: v * 2 }
    : { a: sky.mid, b: sky.low, t: (v - 0.5) * 2 };
}

/* Stars, at fixed places. A hash rather than a stored table so there are as
   many as the sky is wide, and a hash rather than Math.random so they are in
   the same places every night. */
const starAt = i => {
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  return { x: h % SCENE_W, y: 4 + ((h >>> 9) % 130), bright: ((h >>> 20) & 3) };
};

/* The sky is two dithers at once: down the frame between three stops, and
 * across the clock between two times of day. Each gets its own cell of the
 * Bayer matrix — offset from the other so the two patterns do not line up and
 * turn into stripes — and between them the sky is a gradient in both
 * directions using only palette colours and no blending.
 */
export function drawSky(ctx, phase, light){
  const { a, b, t } = skyBlend(phase);
  const level = t * 16;
  for(let y = 0; y < GROUND_Y; y++){
    /* Not linear down the frame. An even split puts the three colours in three
       equal stripes, which reads as a flag rather than as a sky; the curve
       gives the top colour most of the height and squeezes the warm horizon
       colours into the bottom third, where a horizon actually is. */
    const v = Math.pow(y / (GROUND_Y - 1), 1.9);
    const stopA = skyStop(a, v);
    const stopB = skyStop(b, v);
    const rowA = stopA.t * 16;
    const rowB = stopB.t * 16;
    for(let x = 0; x < SCENE_W; x++){
      const time = BAYER[y & 3][x & 3];
      const down = BAYER[(y + 2) & 3][(x + 1) & 3];
      const stop = level > time ? stopB : stopA;
      const frac = level > time ? rowB : rowA;
      ctx.fillStyle = hex(frac > down ? stop.b : stop.a);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  if(light < 0.25){
    const strength = Math.min(1, (0.25 - light) / 0.7);
    for(let i = 0; i < 70; i++){
      const s = starAt(i);
      if(s.bright / 3 > strength) continue;
      fill(ctx, s.bright === 3 ? 'w' : 'c', 1, s.x, s.y);
    }
  }
}

/* The sun and the moon, on the same circle half a day apart. Anything below
   the horizon is simply not drawn — there is no need to clip a thing you can
   decline to paint. */
export function drawSkyBodies(ctx, phase, light){
  const bodies = [
    { angle: phase * Math.PI * 2, r: 7, key: 'y', halo: 'o', face: false },
    { angle: (phase + 0.5) * Math.PI * 2, r: 5, key: 'w', halo: 's', face: true },
  ];
  for(const body of bodies){
    const x = Math.round(SCENE_W / 2 - Math.cos(body.angle) * (SCENE_W / 2 - 18));
    const y = Math.round(GROUND_Y - 16 - Math.sin(body.angle) * 112);
    if(y > GROUND_Y - 6) continue;
    for(let dy = -body.r - 1; dy <= body.r + 1; dy++){
      for(let dx = -body.r - 1; dx <= body.r + 1; dx++){
        const d = Math.sqrt(dx * dx + dy * dy);
        if(d > body.r + 1) continue;
        const key = d > body.r - 0.4 ? body.halo : body.key;
        // The moon keeps its craters: two dark pixels, in the same place every
        // night, because a moon that reshuffles its face is a disco ball.
        const crater = body.face && ((dx === -1 && dy === -1) || (dx === 2 && dy === 1));
        fill(ctx, crater ? 's' : key, 1, x + dx, y + dy);
      }
    }
  }
}

/* Cloud, drifting. One shape, three copies at three heights and three speeds,
   which at this size is more convincing than any one cloud could be. */
export function drawClouds(ctx, now, light){
  const shapes = [
    { y: 26, w: 38, h: 7, speed: 0.0040 },
    { y: 52, w: 26, h: 5, speed: 0.0065 },
    { y: 76, w: 46, h: 6, speed: 0.0028 },
  ];
  for(let i = 0; i < shapes.length; i++){
    const c = shapes[i];
    const span = SCENE_W + c.w * 2;
    const x = Math.round(((now * c.speed + i * 137) % span) - c.w);
    for(let py = 0; py < c.h; py++){
      const inset = Math.round(Math.abs(py - (c.h - 1) / 2) * 2.2);
      const w = c.w - inset * 2;
      if(w <= 0) continue;
      ditherRect(ctx, x + inset, c.y + py, w, 1, 'w', 'c', py / c.h, light);
    }
  }
}

/* ---------------------------------------------------------------- ground */

/* The far ridge, then the lot. Two fixed sine humps rather than noise: at this
   width a noisy skyline reads as a dirty edge, and the ridge only has to say
   "the world carries on past the fence". */
export function drawGround(ctx, light){
  for(let x = 0; x < SCENE_W; x++){
    const ridge = 12 + Math.sin(x * 0.031) * 6 + Math.sin(x * 0.0117 + 2) * 5;
    const top = Math.round(GROUND_Y - ridge);
    for(let y = top; y < GROUND_Y; y++){
      // Further away is lighter and bluer, which is the depth rule the other
      // two games follow, so the three read as one world.
      fill(ctx, y < top + 2 ? 's' : 'G', light, x, y);
    }
  }

  /* And the lot itself: grass that gets darker toward the front rather than
     lighter, which is the same rule the other way up — what is near you is in
     your own shade. It was a band of soil across the bottom third for a while,
     and a hard brown line two thirds of the way down read as the edge of the
     drawing rather than as ground. */
  const band = SCENE_H - GROUND_Y;
  for(let y = 0; y < band; y++){
    const near = y / (band - 1);
    ditherRect(ctx, 0, GROUND_Y + y, SCENE_W, 1, 'g', 'G', 0.18 + near * 0.72, light);
  }
  // A lip of turned soil at the very bottom, three rows, where the lot ends.
  ditherRect(ctx, 0, SCENE_H - 3, SCENE_W, 3, 'G', 'N', 0.55, light);

  // Tufts, on a hash so they do not crawl between frames.
  for(let i = 0; i < 140; i++){
    const h = Math.imul(i + 7, 2246822519) >>> 0;
    const x = h % SCENE_W;
    const y = GROUND_Y + 3 + ((h >>> 8) % (SCENE_H - GROUND_Y - 8));
    fill(ctx, (h >>> 17) & 1 ? 't' : 'g', light, x, y);
    fill(ctx, 'G', light, x, y + 1);
  }
}

/* ----------------------------------------------------------------- props */

/* One sprite per grower, rows of palette keys, '.' transparent — the same way
 * both the other games author art, so a sprite can be read and edited in the
 * source without a tool.
 *
 * Nine of them and nothing else: the lot is meant to fill up with the things
 * you bought, and a thing you bought that does not appear is the clearest way
 * for a clicker to feel like a spreadsheet.
 */
export const PROP_ART = {
  /* The two green ones carry mint highlights and a dark edge, and moss sits on
     turned soil. Drawn in grass green alone they were green on green: at 26
     moss beds and 22 fern banks the lot read as empty, which is the one thing
     a clicker's picture must never do to somebody who has just spent an hour
     filling it. */
  moss: [
    '....tt......',
    '..tggggt.t..',
    '.gGgggggggt.',
    'gGGgGgggGGgg',
    'NGGNGGNNGGNN',
  ],
  fern: [
    '.....t.....',
    '.t...g...t.',
    '.tGg.g.gGt.',
    '..gGtgtGg..',
    '.tGg.g.gGt.',
    '..gG.g.Gg..',
    '.t...g...t.',
    '.....g.....',
    '.....G.....',
    '....NGN....',
  ],
  panel: [
    '......bbbbbb.',
    '.....bccccb..',
    '....bccccb...',
    '...bccccb....',
    '..bccccb.....',
    '..bbbbb......',
    '.....N.......',
    '.....N.......',
    '....NNN......',
  ],
  hive: [
    '..oooooo..',
    '.oNNNNNNo.',
    '.oNNNNNNo.',
    '..oooooo..',
    '.oNNNNNNo.',
    '.oNNkkNNo.',
    '..oooooo..',
    '...NNNN...',
    '...NNNN...',
    '..NNNNNN..',
  ],
  mushroom: [
    '..rrrr......',
    '.rwrrrr.....',
    '.rrrrrr.....',
    '...ww...rrr.',
    '...ww..rwrr.',
    '...ww..rrrr.',
    'rrr.ww...ww.',
    'rwr.ww...ww.',
    '.w..NN...NN.',
  ],
  orchard: [
    '...ggg....ggg...',
    '..gGggg..gGggg..',
    '.gggrgg.gggrgg..',
    '.ggggGg.ggggGg..',
    '..gGgg...gGgg...',
    '....N.....N.....',
    '....N.....N.....',
    '....N.....N.....',
    '...NNN...NNN....',
  ],
  turbine: [
    '.....w.....',
    '.....w.....',
    '....ww.....',
    '....w......',
    '.wwwswww...',
    '....ww.....',
    '....s.w....',
    '....s..w...',
    '....s......',
    '....s......',
    '....s......',
    '....s......',
    '....s......',
    '...sss.....',
  ],
  glasshouse: [
    '......wwwwww......',
    '....wwccccccww....',
    '...wcccccccccw....',
    '..wccccccccccccw..',
    '..wcgcccgcccgccw..',
    '..wcgcccgcccgccw..',
    '..wccccccccccccw..',
    '..wwwwwwwwwwwwww..',
    '..NNNNNNNNNNNNNN..',
  ],
  canopy: [
    '....ggg......',
    '...gGggg.....',
    '..ggggggg....',
    '...gGggg.....',
    '....sss......',
    '...sswss.....',
    '...sswss.....',
    '..ggsssgg....',
    '.gGgsssgGg...',
    '..ggsssgg....',
    '...sswss.....',
    '...sswss.....',
    '..ggsssgg....',
    '.gGgsssgGg...',
    '..ggsssgg....',
    '...sswss.....',
    '...sswss.....',
    '...sswss.....',
    '..sssssss....',
  ],
};

/* A sprite, drawn through the same light the rest of the scene is drawn
 * through. pixel.js has a `drawSprite` and this is not it: that one looks its
 * keys up in the palette directly, which is right for a game whose lighting
 * never changes and wrong here — a hive in full orange at midnight sits on a
 * violet lot looking like it has been cut out and pasted on.
 */
export function drawPiece(ctx, piece, light){
  if(piece.footed) footing(ctx, piece.x + 1, piece.ground, piece.rows[0].length - 2, light);
  drawProp(ctx, piece.rows, piece.x, piece.y, light);
}

export function drawProp(ctx, rows, x, y, light){
  /* One step down at night and never two. The ground and the tree take both,
     because they are the scene; the things you bought are the point of the
     screen, and at two steps a full lot at midnight was an empty lot with a
     faint bruise on it. Holding them one step brighter than their surroundings
     reads as them catching what light there is, which is what you want to
     believe about a garden you planted. */
  const lit = Math.max(light, -0.4);
  const w = rows[0].length;
  for(let r = 0; r < rows.length; r++){
    for(let c = 0; c < w; c++){
      const key = rows[r][c];
      if(key === '.') continue;
      fill(ctx, key, lit, x + c, y + r);
    }
  }
}

/* Where each kind stands, and where the second, third and fourth of them go.
 *
 * Hand-placed rather than laid out by a rule. A rule that packs nine sprites
 * into 320 pixels without any of them landing on the tree or walking off the
 * edge is a harder thing to write than thirty-six numbers, and it goes wrong
 * silently — a sprite half off the canvas looks like a rendering fault.
 *
 * `y` is the sprite's ground line, and everything on the lot is drawn in order
 * of it, so a thing standing further forward is painted over the thing behind.
 */
export const PROP_SPOTS = {
  orchard:    [{ x: 4, y: 184 }, { x: 24, y: 191 }, { x: 46, y: 179 }, { x: 66, y: 187 }],
  glasshouse: [{ x: 196, y: 182 }, { x: 218, y: 190 }, { x: 176, y: 177 }, { x: 240, y: 185 }],
  turbine:    [{ x: 276, y: 179 }, { x: 262, y: 188 }, { x: 292, y: 185 }, { x: 248, y: 177 }],
  hive:       [{ x: 62, y: 207 }, { x: 76, y: 215 }, { x: 48, y: 213 }, { x: 90, y: 206 }],
  panel:      [{ x: 212, y: 204 }, { x: 230, y: 212 }, { x: 246, y: 202 }, { x: 196, y: 213 }],
  canopy:     [{ x: 296, y: 206 }, { x: 282, y: 215 }, { x: 306, y: 220 }, { x: 270, y: 209 }],
  moss:       [{ x: 20, y: 234 }, { x: 40, y: 226 }, { x: 4, y: 221 }, { x: 58, y: 238 }],
  mushroom:   [{ x: 92, y: 229 }, { x: 108, y: 238 }, { x: 76, y: 235 }, { x: 122, y: 226 }],
  fern:       [{ x: 246, y: 227 }, { x: 262, y: 237 }, { x: 230, y: 235 }, { x: 278, y: 229 }],
};

/* How many you have to own before the second, third and fourth copies appear.
   The lot should keep changing well past the first purchase, and it should
   stop changing before it is a wall of sprites. These were 1, 10, 25 and 60,
   which put four sprites on the lot for a garden of ninety-one growers — the
   picture was a third of the way through the game while the shop was most of
   the way. */
export const PROP_STEPS = [1, 5, 15, 40];

export const propCount = owned => {
  let n = 0;
  for(const step of PROP_STEPS) if(owned >= step) n++;
  return n;
};

/* ------------------------------------------------------------------ tree */

/* One repaint of the sky per second of a four-minute day. Finer than this is
   work nobody can see; coarser and dusk arrives in visible steps. */
const DAY_BUCKETS = 240;

/* Where it stands. The lot is drawn around this, so it is the one coordinate
   in the file that other things are placed relative to. */
export const TREE_X = 160;
export const TREE_Y = 192;

/* How big the tree is for a given number of growers. Logarithmic, because the
   difference between nothing and ten things planted deserves to be visible and
   the difference between four hundred and four hundred and ten does not. */
export const growthFor = growers =>
  Math.max(0, Math.min(1, Math.log(1 + Math.max(0, growers)) / Math.log(801)));

/* A run of pixels, which is how everything organic here is drawn. A blob of
   radius seven is 150 pixels and fifteen spans; at sixty frames a second and
   sixty blobs that is the difference between a tree and a slideshow. */
const run = (ctx, key, light, x, y, w) => {
  if(w <= 0) return;
  ctx.fillStyle = hex(shade(key, light));
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), 1);
};

/* --------------------------------------------------------------- winters */

/* How the tree comes back after each winter — which is what replanting the lot
 * is. `growth` says how planted the lot is; `age` says how many winters the
 * tree has stood through, and a tree that has stood through seven should not
 * be the first-year sapling with a thicker trunk. Each stage keeps everything
 * the earlier ones added and adds one thing of its own, so a player who has
 * replanted four times can see all four winters in the tree, not just the
 * last.
 *
 * The multipliers are on the trunk width, the leaf-blob radius and the spread
 * of the forks — not on the height. At full growth the first-year tree already
 * stands 178 pixels in a 240-pixel frame, so an older tree has to read as older
 * by being stouter, broader and busier rather than taller, which is also how an
 * old tree looks next to a young one. `reach` trims the limbs where a stage
 * would otherwise put its crown through the top of the frame; the last stage
 * is allowed to, on purpose — a tree too big for its picture is the point of
 * seven winters. `fork` is the angle, in radians off vertical, of the low limb
 * that leaves the trunk from the second winter on. `hit` is how much wider and
 * taller the tap target gets, measured off the drawn extents.
 *
 * Stage 0 is today's tree and has to draw it pixel for pixel: the shelf card
 * and the tests both depend on it. Every multiplier here is exactly 1, and a
 * float times 1 is that float.
 */
const WINTERS = [
  { id: 'sapling',     trunk: 1,    leaf: 1,    spread: 1,   depthBonus: 0, reach: 1,    fork: 0,    hit: [1, 1],
    adds: [] },
  { id: 'stout',       trunk: 1.35, leaf: 1.08, spread: 1,   depthBonus: 0, reach: 1,    fork: 0,    hit: [1.38, 1.28],
    adds: ['flare', 'leaves'] },
  { id: 'forked',      trunk: 1.6,  leaf: 1.15, spread: 1,   depthBonus: 0, reach: 1,    fork: 0.95, hit: [1.62, 1.28],
    adds: ['fork'] },
  { id: 'gnarled',     trunk: 1.85, leaf: 1.2,  spread: 1,   depthBonus: 1, reach: 0.94, fork: 0.95, hit: [1.7, 1.34],
    adds: ['knot', 'moss'] },
  { id: 'broad',       trunk: 2.1,  leaf: 1.25, spread: 1.3, depthBonus: 1, reach: 0.94, fork: 1.3,  hit: [1.8, 1.34],
    adds: ['swing'] },
  { id: 'rooted',      trunk: 2.4,  leaf: 1.3,  spread: 1.3, depthBonus: 1, reach: 0.96, fork: 1.3,  hit: [1.82, 1.36],
    adds: ['buttress', 'glow', 'blossom'] },
  { id: 'lantern-lit', trunk: 2.7,  leaf: 1.35, spread: 1.3, depthBonus: 1, reach: 0.98, fork: 1.3,  hit: [1.85, 1.37],
    adds: ['lanterns', 'bench'] },
  { id: 'ancient',     trunk: 3,    leaf: 1.42, spread: 1.3, depthBonus: 1, reach: 1,    fork: 1.3,  hit: [1.9, 1.42],
    adds: ['twins', 'vines', 'mushrooms'] },
];

/* The same table with each stage's `features` filled in cumulatively and a
   `has` lookup built off it, so the painter asks `stage.has.swing` rather than
   searching an array sixty times a second. */
export const TREE_STAGES = WINTERS.map((row, winters) => {
  const features = [];
  for(let i = 0; i <= winters; i++) features.push(...WINTERS[i].adds);
  const has = {};
  for(const f of features) has[f] = true;
  return { winters, ...row, features, has };
});

/* The stage for a number of winters. Clamped at both ends and safe against a
   save that reads as NaN: a tree with no legible age is a first-year tree. */
export const stageFor = age => {
  const i = Math.floor(age);
  return TREE_STAGES[i > 0 ? Math.min(i, TREE_STAGES.length - 1) : 0];
};

/* Past the last stage the last design is reused and the tree simply goes on
   thickening — four percent a winter on the trunk and the canopy, and never
   more than half again in all. A tree that grew without bound would one day
   fill the frame with a single colour. */
export const AGED_STEP = 0.04;
export const AGED_CAP = 1.5;
export const agedScale = age => {
  const past = Math.floor(age) - (TREE_STAGES.length - 1);
  return past > 0 ? Math.min(AGED_CAP, 1 + past * AGED_STEP) : 1;
};

/* A hash off an index, for anything that has to be scattered but must land in
   the same place on every frame: fallen leaves, blossom, vines. */
const scatter = i => Math.imul(i + 11, 2654435761) >>> 0;

/* ---------------------------------------------------------------- raster */

/* The tree is painted into a pixel buffer, not onto the canvas.
 *
 * Everything below draws through two verbs, `run` and `fill`, and a
 * full-grown tree is seven thousand of them a frame — thirty thousand once it
 * has stood through a few winters. On the canvas each one is a fillRect: a
 * call across into the browser's painter, a fill style parsed from a hex
 * string, a rectangle clipped and composited. Measured in Chromium that is
 * five milliseconds a frame for a first-year tree and nineteen for an old one;
 * on a phone's processor, four times that, which is eleven frames a second for
 * the one thing on this page that has to move.
 *
 * Writing the same pixels into a Uint32Array is a loop over a typed array,
 * which is the cheapest thing JavaScript does. The buffer goes onto an
 * offscreen canvas in one call and onto the lot in a second, so a frame costs
 * two canvas calls whatever the tree looks like. The picture is the same to
 * the pixel: the buffer's `run` rounds exactly as the canvas one does and
 * then clips where the canvas would have, and a test draws the same tree both
 * ways and compares every pixel.
 *
 * Where there is no ImageData — Node, and the tests — the tree draws through
 * the canvas calls it always did. Nothing about the shape of the tree lives in
 * the target; the target only decides where the pixels land.
 */

/* Each palette key as one packed pixel, in whichever byte order this machine's
   ImageData wants. Worked out once: a hex string parsed per pixel is the very
   cost the buffer is here to avoid. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const packed = key => {
  const h = hex(key);
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return (LITTLE_ENDIAN ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
};
export const PACKED = Object.fromEntries(Object.keys(PALETTE).map(key => [key, packed(key)]));

/* A scene-sized pixel buffer with the same two verbs the canvas path has, and
   a record of the box it has been written in — so only that box is ever
   cleared, uploaded or drawn, and an empty sky costs nothing. */
export class Raster {
  constructor(w = SCENE_W, h = SCENE_H){
    this.w = w;
    this.h = h;
    this.data = new Uint32Array(w * h);
    this.x0 = w; this.y0 = h; this.x1 = 0; this.y1 = 0;
  }

  /* Blank what the last frame wrote, and nothing more. */
  clear(){
    if(this.x1 > this.x0){
      for(let y = this.y0; y < this.y1; y++) this.data.fill(0, y * this.w + this.x0, y * this.w + this.x1);
    }
    this.x0 = this.w; this.y0 = this.h; this.x1 = 0; this.y1 = 0;
  }

  /* The same rounding the canvas `run` does, and then the clip the canvas
     would have applied at the edge of the scene. */
  run(key, light, x, y, w){
    x = Math.round(x); y = Math.round(y); w = Math.round(w);
    if(w <= 0 || y < 0 || y >= this.h) return;
    const a = x > 0 ? x : 0;
    const b = x + w < this.w ? x + w : this.w;
    if(b <= a) return;
    this.data.fill(PACKED[shade(key, light)], y * this.w + a, y * this.w + b);
    if(a < this.x0) this.x0 = a;
    if(b > this.x1) this.x1 = b;
    if(y < this.y0) this.y0 = y;
    if(y >= this.y1) this.y1 = y + 1;
  }

  fill(key, light, x, y, w = 1, h = 1){
    x = x | 0; y = y | 0;
    for(let i = 0; i < h; i++) this.run(key, light, x, y + i, w);
  }

  /* The box written since the last clear, or null if nothing was. */
  get dirty(){
    return this.x1 > this.x0 ? { x: this.x0, y: this.y0, w: this.x1 - this.x0, h: this.y1 - this.y0 } : null;
  }
}

/* The canvas path, for where there is no buffer to blit: the same two verbs,
   bound to a context. This is exactly what every call in the tree used to be. */
const rectTarget = ctx => ({
  run: (key, light, x, y, w) => run(ctx, key, light, x, y, w),
  fill: (key, light, x, y, w, h) => fill(ctx, key, light, x, y, w, h),
});

/* The one buffer and the offscreen canvas it is stamped through. Made on first
   use, and `false` once it is known there is nothing to make it from. */
let layer = null;
function treeLayer(){
  if(layer !== null) return layer || null;
  try {
    if(typeof ImageData !== 'function') throw new Error('no ImageData');
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(SCENE_W, SCENE_H)
      : Object.assign(document.createElement('canvas'), { width: SCENE_W, height: SCENE_H });
    const ctx = canvas.getContext('2d');
    if(!ctx || typeof ctx.putImageData !== 'function') throw new Error('no 2d context');
    const raster = new Raster();
    // The ImageData looks at the same bytes the buffer writes: there is no copy.
    const image = new ImageData(new Uint8ClampedArray(raster.data.buffer), SCENE_W, SCENE_H);
    layer = { raster, image, canvas, ctx };
  } catch {
    layer = false;
  }
  return layer || null;
}

function leafBlob(dst, cx, cy, r, o){
  const R = Math.max(1, Math.round(r));
  for(let dy = -R; dy <= R; dy++){
    const half = Math.floor(Math.sqrt(Math.max(0, R * R - dy * dy + 0.5)));
    if(half < 0) continue;
    const x0 = Math.round(cx) - half;
    const w = half * 2 + 1;
    // Lit from above: more of the light green on the upper rows, more of the
    // dark on the lower ones. Two spans a row rather than a per-pixel dither,
    // which at this radius is a tenth of the work and reads the same.
    const split = Math.max(0, Math.min(w, Math.round(w * (dy < 0 ? 0.7 : 0.34))));
    dst.run('g', o.light, x0, Math.round(cy) + dy, split);
    dst.run('G', o.light, x0 + split, Math.round(cy) + dy, w - split);
  }

  /* Blossom, from the fifth winter: five specks of rose and skin in one blob
     in sixteen, placed off a hash of the blob's index so they hold still, and
     drawn after the blob so they sit on top of it. */
  if(o.blossom){
    const h = scatter(o.blobs++);
    if((h & 15) === 0){
      for(let k = 0; k < 5; k++){
        const bits = h >>> (4 + k * 5);
        const dx = (bits % (R + 1)) - (R >> 1);
        const dy = ((bits >>> 3) % (R + 1)) - (R >> 1);
        dst.fill(k & 1 ? 'n' : 'r', o.light, Math.round(cx) + dx, Math.round(cy) + dy);
      }
    }
  }
}

/* One straight run of wood between two points, `width` across, lit on the sun
   side and shadowed on the other. Every limb is one of these; so is the low
   bough and the stub under the twin trunks, which is why it is its own
   function rather than the top of limb(). */
function bough(dst, x, y, x2, y2, width, o){
  const w = Math.max(1, Math.round(width));
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x, y2 - y)));
  for(let i = 0; i <= steps; i++){
    const t = i / steps;
    const px = x + (x2 - x) * t - w / 2;
    const py = y + (y2 - y) * t;
    dst.run('N', o.light, px, py, w);
    if(w > 2){
      // A highlight on whichever side the sun is, and a shadow on the other.
      dst.run('n', o.light, o.sunSide < 0 ? px : px + w - 1, py, 1);
      dst.run('v', o.light, o.sunSide < 0 ? px + w - 1 : px, py, 1);
    }
  }
}

/* A strand hanging off the crown: pine, six to twelve pixels, with a grass
   tip. Only from tips that point sideways or down — the ones on the outside
   and underside of the canopy — because a vine off a tip at the top of the
   crown hangs inside the leaves where nobody can see it. One tip in five. */
function vine(dst, x, y, a, o){
  const h = scatter(o.tips++);
  if(Math.sin(a) < -0.35 || h % 5) return;
  const drop = 6 + (h >>> 4) % 7;
  const vx = Math.round(x) + ((h >>> 8) % 3) - 1;
  const vy = Math.round(y) + Math.max(1, Math.round(o.leaf)) - 1;
  dst.fill('G', o.light, vx, vy, 1, drop);
  dst.fill('g', o.light, vx, vy + drop);
}

/* A lantern hung from the middle of a limb's lower side: an ink hook and a
   two-by-three body with the flame in the middle row. Drawn unshaded, as the
   fireflies are, because it is a light; at night it gets a pixel of gold at
   each compass point, which at this size is what a glow is. */
function lantern(dst, x, y, x2, y2, width, o){
  const dx = x2 - x, dy = y2 - y;
  const L = Math.hypot(dx, dy) || 1;
  // The perpendicular that points down — or, on a near-vertical limb,
  // outward — so the lantern hangs clear of the wood rather than over it.
  let nx = -dy / L, ny = dx / L;
  if(ny < 0){ nx = -nx; ny = -ny; }
  const off = Math.max(1, Math.round(width)) / 2 + 1;
  const hx = Math.round((x + x2) / 2 + nx * off);
  const hy = Math.round((y + y2) / 2 + ny * off);
  dst.fill('k', o.light, hx, hy);
  dst.fill('o', 1, hx, hy + 1, 2, 1);
  dst.fill('y', 1, hx, hy + 2, 2, 1);
  dst.fill('o', 1, hx, hy + 3, 2, 1);
  if(o.light < 0){
    dst.fill('y', 1, hx - 1, hy + 2);
    dst.fill('y', 1, hx + 2, hy + 2);
    dst.fill('y', 1, hx + 1, hy);
    dst.fill('y', 1, hx, hy + 4);
  }
}

function limb(dst, x, y, angle, len, width, depth, o){
  // The sway is applied more to the thin ends than to the trunk, which is what
  // a tree in wind actually does and what stops the whole thing sliding.
  const a = angle + o.sway * (o.depth - depth + 1) * 0.35;
  const x2 = x + Math.cos(a) * len;
  const y2 = y + Math.sin(a) * len;
  bough(dst, x, y, x2, y2, width, o);

  if(depth <= 0){
    leafBlob(dst, x2, y2, o.leaf, o);
    if(o.vines) vine(dst, x2, y2, a, o);
    return;
  }
  /* A broad stage widens the two forks nearest the trunk and leaves the twigs
     alone. The outer path of this recursion always curls over as the spreads
     add up, and widening every level by the same number curled the crown down
     to the grass either side: a weeping willow, not a broad oak. */
  const spread = (0.26 + depth * 0.042) * (depth >= o.depth - 1 ? o.spread : 1);
  limb(dst, x2, y2, a - spread, len * 0.74, width * 0.66, depth - 1, o);
  limb(dst, x2, y2, a + spread * 0.88, len * 0.7, width * 0.66, depth - 1, o);

  /* A leader carrying straight on out of the first fork, so the crown is not
     a perfect binary Y. Two branches and nothing else is the shape of a
     catapult, and it was the single thing that made the first cut of this
     read as a diagram of a tree rather than as a tree. `leaderAt` is the root
     of the tree, except on twin trunks, where each trunk gets its own. */
  if(depth === o.leaderAt && o.depth >= 3){
    limb(dst, x2, y2, a + 0.05, len * 0.82, width * 0.62, depth - 1, o);
  }

  /* And a smaller blob at the last fork as well as at the tips. The gaps
     between eight tip blobs are bigger than the blobs at this size, and a
     canopy you can see the sky through in eight places is a canopy that reads
     as being under construction. */
  if(depth === 1) leafBlob(dst, x2, y2, o.leaf * 0.62, o);
  if(depth === 2 && o.depth >= 5) leafBlob(dst, x2, y2, o.leaf * 0.5, o);

  // Lanterns hang from the first limbs out of the trunk, which are the low
  // ones, and are drawn after the limb's own crown so nothing paints over them.
  if(o.lanterns && depth === o.depth - 1) lantern(dst, x, y, x2, y2, width, o);
}

/* ---- what stands at the foot of an older tree --------------------------- */

/* One row of roots either side of the trunk, `ext` pixels out, lit on the sun
   side and shadowed on the other like the wood above it. */
function rootRow(dst, left, right, y, ext, o){
  if(ext <= 0) return;
  dst.run('N', o.light, left - ext, y, ext);
  dst.run('N', o.light, right, y, ext);
  dst.run(o.sunSide < 0 ? 'n' : 'v', o.light, left - ext, y, 1);
  dst.run(o.sunSide < 0 ? 'v' : 'n', o.light, right + ext - 1, y, 1);
}

/* The root flare — two splayed runs each side at the ground line — and, from
   the fifth winter, buttress roots over it: three runs each side reaching
   about fourteen pixels out on a full-grown tree and stepping in as they
   climb, so they taper. Both are sized off the trunk, so a sapling that has
   stood through five winters has roots in proportion and not a plinth. */
function roots(dst, cx, trunk, o){
  const w = Math.max(1, Math.round(trunk));
  const left = Math.round(cx - w / 2);
  const right = left + w;
  const flare = 1 + Math.round(w * 0.25);
  rootRow(dst, left, right, TREE_Y - 1, flare, o);
  rootRow(dst, left, right, TREE_Y, flare * 2, o);
  if(!o.buttress) return;
  const reach = 4 + Math.round(w * 0.6);
  rootRow(dst, left, right, TREE_Y - 2, Math.round(reach * 0.25), o);
  rootRow(dst, left, right, TREE_Y - 1, Math.round(reach * 0.5), o);
  rootRow(dst, left, right, TREE_Y, Math.round(reach * 0.75), o);
  // The lowest row runs under the trunk as well, so the tree stands on its
  // roots rather than on a line of grass between them.
  dst.run('N', o.light, left - reach, TREE_Y + 1, w + reach * 2);
  dst.run(o.sunSide < 0 ? 'n' : 'v', o.light, left - reach, TREE_Y + 1, 2);
  dst.run(o.sunSide < 0 ? 'v' : 'n', o.light, right + reach - 2, TREE_Y + 1, 2);
}

/* Fallen leaves round the base: ten of them, ember and gold, at places hashed
   off their index and kept clear of the trunk so none lands on the wood. Two
   pixels wide, not one — one pixel of ember on a dithered lawn is a tuft that
   has gone wrong, and two is a leaf. */
function fallenLeaves(dst, cx, trunk, o){
  const half = Math.max(1, Math.round(trunk)) / 2;
  for(let i = 0; i < 10; i++){
    const h = scatter(i + 200);
    const side = h & 1 ? 1 : -1;
    const x = Math.round(cx + side * (half + 2 + (h >>> 3) % 24));
    const y = TREE_Y - 1 + (h >>> 9) % 8;
    dst.fill((h >>> 13) & 1 ? 'o' : 'y', o.light, x, y, 2, 1);
  }
}

/* The knot hole: an oval of ink with a violet rim, sized off the trunk so it
   is three by five on a middling tree and not a hole wider than the wood on a
   sapling. The upper half is deep violet rather than ink — the light is from
   above, and the top of a hole is the part you can see into. From the fifth
   winter it glows gold at night, and the glow is drawn unshaded, like the
   lanterns, because it is the light and not a thing lit. */
function knot(dst, cx, cy, trunk, o){
  const kw = Math.max(2, Math.min(5, Math.round(trunk * 0.38)));
  const kh = (kw + 2) | 1;
  const half = kh >> 1;
  const x0 = Math.round(cx) - (kw >> 1);
  const y0 = Math.round(cy);
  const glow = o.glow && o.light < 0;
  for(let dy = -half; dy <= half; dy++){
    const y = y0 + dy;
    if(Math.abs(dy) === half){
      const w = Math.max(1, kw - 2);
      dst.run('v', o.light, x0 + ((kw - w) >> 1), y, w);
      continue;
    }
    dst.fill('v', o.light, x0, y);
    if(kw > 2) dst.fill('v', o.light, x0 + kw - 1, y);
    if(glow) dst.fill('y', 1, x0 + 1, y, Math.max(1, kw - 2), 1);
    else dst.fill(dy < 0 ? 'd' : 'k', o.light, x0 + 1, y, Math.max(1, kw - 2), 1);
  }
}

/* Moss on the shaded side of the trunk, low down, where moss is: five short
   runs at heights fixed as fractions of the trunk, so they climb with it. One
   pixel in from the edge, on the wood — on the edge itself, grass green
   against the grass behind it read as a notch out of the trunk. */
const MOSS_AT = [0.06, 0.13, 0.22, 0.31, 0.44];
function moss(dst, cx, len, trunk, o){
  const w = Math.max(1, Math.round(trunk));
  if(w < 4) return;
  const left = Math.round(cx - w / 2);
  for(let i = 0; i < MOSS_AT.length; i++){
    const mw = 1 + (i & 1);
    dst.run('g', o.light, o.sunSide < 0 ? left + w - 1 - mw : left + 1, TREE_Y - len * MOSS_AT[i], mw);
  }
}

/* A swing: two ropes from the low bough to a plank six pixels off the ground.
   The ropes are as long as they need to be rather than a fixed fourteen,
   because the bough is lower on a tree that has just been replanted, and a
   fixed rope would put the seat in the soil. */
function swing(dst, hx, hy, o){
  const seat = TREE_Y - 6;
  const x0 = Math.round(hx) - 3;
  const top = Math.round(hy) + 1;
  const drop = seat - top;
  if(drop < 3) return;
  dst.fill('w', o.light, x0, top, 1, drop);
  dst.fill('w', o.light, x0 + 7, top, 1, drop);
  dst.fill('N', o.light, x0, seat, 8, 1);
  dst.fill('v', o.light, x0, seat + 1, 8, 1);
  dst.fill('n', o.light, o.sunSide < 0 ? x0 : x0 + 7, seat);
}

/* A bench to the left of the trunk, under the bough the swing hangs from: a
   plank of oak with its shadow under it, on two short legs. Left because that
   is the side of the lot with nothing standing on it at that height. */
function bench(dst, cx, o){
  const x = Math.round(cx) - 46, y = TREE_Y + 3;
  dst.fill('N', o.light, x, y, 12, 1);
  dst.fill('n', o.light, o.sunSide < 0 ? x : x + 11, y);
  dst.fill('v', o.light, x, y + 1, 12, 1);
  dst.fill('v', o.light, x + 1, y + 2, 1, 2);
  dst.fill('v', o.light, x + 10, y + 2, 1, 2);
}

/* A ring of small mushrooms round the base — rose caps on skin stalks, two
   pixels by two — three a side, at fixed offsets from the trunk edge. */
const MUSHROOM_AT = [[4, 2], [10, 5], [16, 3]];
function mushrooms(dst, cx, trunk, o){
  const w = Math.max(1, Math.round(trunk));
  const left = Math.round(cx - w / 2);
  const right = left + w;
  for(let i = 0; i < MUSHROOM_AT.length; i++){
    const [out, down] = MUSHROOM_AT[i];
    const y = TREE_Y + down;
    dst.fill('r', o.light, left - out - 2, y, 2, 1);
    dst.fill('n', o.light, left - out - 1, y + 1);
    dst.fill('r', o.light, right + out, y, 2, 1);
    dst.fill('n', o.light, right + out, y + 1);
  }
}

/* `pulse` is how hard the tree is still ringing from a tap, 0 to 1: the
   canopy swells by up to a third of its blob radius and settles. It is the
   tap's own animation, and it is on the tree rather than on the number that
   floats away, because the tree is what you tapped. */
export function paintTree(dst, growth, { sway = 0, light = 1, sunSide = -1, shake = 0, pulse = 0, age = 0 } = {}){
  const g = Math.max(0, Math.min(1, growth));
  const stage = stageFor(age);
  const has = stage.has;
  const more = agedScale(age);
  const depth = 3 + Math.round(g * 3) + stage.depthBonus;
  const o = {
    sway, light, sunSide, depth,
    leaderAt: depth,
    spread: stage.spread,
    // Bigger blobs on a young tree than the growth curve alone would give it.
    // A sapling drawn with a one-pixel trunk and eight two-pixel leaves is a
    // thread with specks on it, not a plant somebody wants to look after.
    leaf: (3.8 + g * 4.2) * (1 + Math.max(0, Math.min(1, pulse)) * 0.35) * stage.leaf * more,
    blossom: has.blossom, vines: has.vines, lanterns: has.lanterns,
    glow: has.glow, buttress: has.buttress,
    blobs: 0, tips: 0,
  };
  /* Nine pixels tall was the first cut of a fresh lot, and a nine-pixel sapling
     is not a thing anybody is going to want to tap four thousand times — it
     read as a weed. Twenty-six was the second, and it was right for a 180-tall
     frame and lost in a 240-tall one: the number that matters is the share of
     the picture the tree takes, and growing the frame by a third shrank it. A
     new lot is fifty-six, which draws about eighty-four pixels of tree — a
     third of the frame — and a full one is nearly twice that. The thing you
     are here to tap should be the thing you look at first. */
  const cx = TREE_X + shake;
  const len = (62 + g * 50) * 0.44 * stage.reach;
  const trunk = (2 + g * 5) * stage.trunk * more;

  // What lies on the ground goes down first, so the trunk stands on its roots
  // and not the other way round.
  if(has.flare) roots(dst, cx, trunk, o);
  if(has.leaves) fallenLeaves(dst, cx, trunk, o);
  if(has.mushrooms) mushrooms(dst, cx, trunk, o);
  if(has.bench) bench(dst, cx, o);

  // The trunk's own lean — the same sway term limb() applies at the root — so
  // the fork and the knot stay on the wood when the tree moves.
  const lean = -Math.PI / 2 + sway * 0.35;

  let hangX = 0, hangY = 0;
  if(has.fork){
    /* The low fork: a bough out of the trunk a third of the way up, with a
       crown of its own on the end of it aimed back upward. Running limb()
       straight off a near-horizontal bough puts its outer branches under the
       horizontal and into the ground. It leaves on the left every day of the
       year rather than on the sunward side: the sun crosses the trunk twice a
       day here, and a limb that jumped across at noon to stay sunward would
       read as a fault, where a highlight that swaps sides does not. */
    const fx = cx + Math.cos(lean) * len * 0.34;
    const fy = TREE_Y + Math.sin(lean) * len * 0.34;
    const af = -Math.PI / 2 - stage.fork + sway * 0.7;
    const fl = len * 0.8;
    const ex = fx + Math.cos(af) * fl, ey = fy + Math.sin(af) * fl;
    bough(dst, fx, fy, ex, ey, trunk * 0.6, o);
    // The bough's crown is drawn at the plain spread whatever the stage: it
    // starts out leaning, and widening it as well hung it down beside the
    // bough like a lobe of wet washing.
    const spread = o.spread;
    o.spread = 1;
    limb(dst, ex, ey, -Math.PI / 2 - 0.3, len * 0.7, trunk * 0.4, depth - 1, o);
    o.spread = spread;
    hangX = fx + (ex - fx) * 0.72;
    hangY = fy + (ey - fy) * 0.72 + Math.round(trunk * 0.6) / 2;
  }

  if(has.twins){
    /* Twin trunks: a stub, then two leaders each carrying its own crown. Each
       is a limb one level down from the root, so the pair together costs what
       the single trunk's three first limbs did — the tree gets no dearer to
       draw for being twice the tree. */
    const sl = len * 0.4;
    const sx = cx + Math.cos(lean) * sl, sy = TREE_Y + Math.sin(lean) * sl;
    bough(dst, cx, TREE_Y, sx, sy, trunk, o);
    o.leaderAt = depth - 1;
    limb(dst, sx, sy, -Math.PI / 2 - 0.26, len * 0.98, trunk * 0.7, depth - 1, o);
    limb(dst, sx, sy, -Math.PI / 2 + 0.22, len * 0.94, trunk * 0.7, depth - 1, o);
  } else {
    limb(dst, cx, TREE_Y, -Math.PI / 2, len, trunk, depth, o);
  }

  // On the trunk, after the trunk. The knot sits lower on twin trunks, where
  // forty percent of the way up is the crotch.
  const knotAt = has.twins ? 0.22 : 0.4;
  if(has.knot) knot(dst, cx + Math.cos(lean) * len * knotAt, TREE_Y + Math.sin(lean) * len * knotAt, trunk, o);
  if(has.moss) moss(dst, cx, len, trunk, o);
  if(has.swing) swing(dst, hangX, hangY, o);
}


/* Paint the tree onto `ctx`: through the buffer where there is one, and
   through the canvas calls where there is not. */
export function drawTree(ctx, growth, opts = {}){
  const via = treeLayer();
  if(!via){
    paintTree(rectTarget(ctx), growth, opts);
    return;
  }
  const raster = via.raster;
  raster.clear();
  paintTree(raster, growth, opts);
  const box = raster.dirty;
  if(!box) return;
  via.ctx.putImageData(via.image, 0, 0, box.x, box.y, box.w, box.h);
  ctx.drawImage(via.canvas, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
}

/* The canvas path on demand, whatever the browser has. It exists so the two
   paths can be drawn side by side and compared to the pixel. */
export const drawTreeWithRects = (ctx, growth, opts = {}) => paintTree(rectTarget(ctx), growth, opts);

/* A burst at the point of a tap: a dozen pixels flung outward and falling
 * back, in the tree's own greens with a spark of gold. `age` runs 0 to 1 over
 * the burst's life. Deterministic in everything but time — the spread comes
 * off the particle's index, not a die — so two taps in the same place throw
 * the same shape, which is what makes it read as the tree reacting rather
 * than as confetti.
 *
 * `size` is for the windfall tap: twice the pixels, thrown half again as far,
 * and more of them gold. Still the same shape, so it reads as the same tree
 * reacting harder rather than as a different effect.
 */
export function drawBurst(ctx, x, y, age, light = 1, size = 1){
  const t = Math.max(0, Math.min(1, age));
  const count = 12 * Math.max(1, Math.round(size));
  const reach = size > 1 ? 1.5 : 1;
  for(let i = 0; i < count; i++){
    const angle = -Math.PI * (0.15 + 0.7 * (i / (count - 1))) + ((i % 3) - 1) * 0.12;
    const speed = (22 + (i % 4) * 7) * reach;
    const px = x + Math.cos(angle) * speed * t;
    const py = y + Math.sin(angle) * speed * t + 34 * t * t;   // and gravity
    if(t > 0.85 && (i % 2)) continue;                           // thinning out
    const key = i % (size > 1 ? 2 : 5) === 0 ? 'y' : i % 3 === 0 ? 't' : 'g';
    fill(ctx, key, light, Math.round(px), Math.round(py), 2, 2);
  }
}

/* The area a tap should feel like it landed on. Generous on purpose: a target
   you have to aim at is a target that hurts to click four thousand times. */
export function treeBounds(growth, age = 0){
  const g = Math.max(0, Math.min(1, growth));
  const stage = stageFor(age);
  /* An older tree's box grows with its crown. Past the last stage the crown
     only thickens, so the box takes a fraction of that growth; and both sides
     are clamped to the frame, because the last stage's crown is allowed to
     leave the picture and the thing you tap is not. Symmetric about the trunk
     even though the low bough leans left — a box that covers the bough and a
     little sky on the other side is a box that is easy to hit. */
  const more = 1 + (agedScale(age) - 1) * 0.3;
  const reach = Math.min(TREE_X, (32 + g * 46) * stage.hit[0] * more);
  const height = Math.min(TREE_Y, (66 + g * 90) * stage.hit[1] * more);
  return { x: TREE_X - reach, y: TREE_Y - height, w: reach * 2, h: height + 6 };
}

/* ------------------------------------------------------------------- lot */

/* Everything that stands on the ground, in order of how far forward it is. The
   sort is by ground line in pixels and not by any list order, which is the
   rule the other games arrived at the hard way: a thing top-anchored to a tile
   and a thing standing on the tile floor cannot be compared by row. */
/* A shadow under whatever is standing there, so nothing floats and everything
   green has a dark edge to sit against. Two rows, tapered, which at this size
   is the difference between a sprite on a lawn and a sprite in one. */
export function footing(ctx, x, y, w, light){
  for(let i = 0; i < w; i++){
    const t = Math.abs(i - w / 2) / (w / 2);
    if(t > 0.9) continue;
    fill(ctx, 'G', Math.min(light, -0.2), x + i, y - 1, 1, t > 0.55 ? 1 : 2);
  }
}

function lotPieces(owned){
  const pieces = [];
  for(const [id, rows] of Object.entries(PROP_ART)){
    const spots = PROP_SPOTS[id] || [];
    const n = Math.min(propCount(owned[id] || 0), spots.length);
    for(let i = 0; i < n; i++){
      const spot = spots[i];
      pieces.push({ rows, x: spot.x, y: spot.y - rows.length, ground: spot.y, footed: true });
    }
  }
  return pieces.sort((a, b) => a.ground - b.ground);
}

/* Fireflies, once it is dark enough and there is something for them to be
   over. They are the only thing on the lot that is not a purchase, and they
   are here because a night scene with nothing moving in it reads as a paused
   game rather than as a night. */
function drawMotes(ctx, now, light, growers){
  if(light > -0.05 || growers < 3) return;
  const many = Math.min(18, 3 + Math.floor(growers / 6));
  for(let i = 0; i < many; i++){
    const h = Math.imul(i + 3, 374761393) >>> 0;
    const baseX = h % SCENE_W;
    const baseY = 120 + ((h >>> 7) % 70);
    const x = baseX + Math.sin(now / (900 + (h & 511)) + i) * 14;
    const y = baseY + Math.cos(now / (1300 + (h & 255)) + i * 2) * 7;
    const blink = Math.sin(now / 320 + i * 1.7);
    if(blink < -0.2) continue;
    fill(ctx, blink > 0.6 ? 'w' : 'y', 1, Math.round(x), Math.round(y));
  }
}

/* Paint the whole scene into `ctx`, which is expected to be SCENE_W x SCENE_H
 * pixels of unsmoothed canvas. Everything it needs is an argument: this is the
 * function the game page calls sixty times a second and the one the shelf
 * calls once, and neither of them can tell the other apart.
 */
export function paintLot(ctx, {
  phase = 0.25, growth = 0, owned = {}, now = 0, sway = 0, shake = 0, growers = 0, pulse = 0, age = 0,
} = {}){
  const light = Math.sin(phase * Math.PI * 2);
  const sunSide = Math.cos(phase * Math.PI * 2) > 0 ? -1 : 1;

  drawSky(ctx, phase, light);
  drawSkyBodies(ctx, phase, light);
  drawClouds(ctx, now, light);
  drawGround(ctx, light);

  const pieces = lotPieces(owned);
  // Everything behind the tree, then the tree, then everything in front of it.
  for(const p of pieces) if(p.ground <= TREE_Y) drawPiece(ctx, p, light);
  drawTree(ctx, growth, { sway, light, sunSide, shake, pulse, age });
  for(const p of pieces) if(p.ground > TREE_Y) drawPiece(ctx, p, light);

  drawMotes(ctx, now, light, growers);
}

/* The same scene, with the parts that do not change every frame kept in
 * offscreen canvases.
 *
 * The sky alone is 320 by 168 pixels of ordered dither, which is fifty-four
 * thousand `fillRect` calls; at sixty frames a second that is a slideshow with
 * a fan running. It is a pure function of the time of day, so it is painted
 * once per bucket and stamped back with a single `drawImage` — the same trick
 * the build map in Good Vibes uses, for the same reason and with the same
 * effect on the frame time.
 *
 * The tree is not cached: it sways, so it is different on every frame by
 * design, and it is drawn in spans rather than pixels precisely so it can be.
 */
export function createLot(){
  let sky = null, ground = null, props = null;
  let skyKey = null, groundKey = null, propKey = null;

  const buffer = () => {
    const canvas = document.createElement('canvas');
    canvas.width = SCENE_W;
    canvas.height = SCENE_H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  };

  return function paint(ctx, opts = {}){
    const { phase = 0.25, growth = 0, owned = {}, now = 0, sway = 0, shake = 0, growers = 0, pulse = 0, age = 0 } = opts;
    const light = Math.sin(phase * Math.PI * 2);
    const sunSide = Math.cos(phase * Math.PI * 2) > 0 ? -1 : 1;

    if(!sky) sky = buffer();
    if(!ground) ground = buffer();
    if(!props) props = buffer();

    // One bucket per second of a four-minute day: the sky moves, but not
    // faster than the eye can be told about.
    const nextSky = Math.round(phase * DAY_BUCKETS);
    if(nextSky !== skyKey){
      skyKey = nextSky;
      sky.ctx.clearRect(0, 0, SCENE_W, SCENE_H);
      drawSky(sky.ctx, phase, light);
      drawSkyBodies(sky.ctx, phase, light);
    }

    const nextGround = Math.round(light * 8);
    if(nextGround !== groundKey){
      groundKey = nextGround;
      ground.ctx.clearRect(0, 0, SCENE_W, SCENE_H);
      drawGround(ground.ctx, light);
    }

    const pieces = lotPieces(owned);
    const nextProps = pieces.map(p => `${p.x},${p.ground}`).join('|') + '@' + nextGround;
    if(nextProps !== propKey){
      propKey = nextProps;
      props.ctx.clearRect(0, 0, SCENE_W, SCENE_H);
      for(const p of pieces) drawPiece(props.ctx, p, light);
    }

    ctx.drawImage(sky.canvas, 0, 0);
    drawClouds(ctx, now, light);
    ctx.drawImage(ground.canvas, 0, 0);
    // The props are one image, so the tree cannot be drawn between the near
    // ones and the far ones. It is drawn first and the near props over it,
    // which is the same order the uncached path produces for everything that
    // stands in front of the trunk — and the far ones are behind the ridge
    // anyway, where the tree does not reach.
    drawTree(ctx, growth, { sway, light, sunSide, shake, pulse, age });
    ctx.drawImage(props.canvas, 0, 0);
    drawMotes(ctx, now, light, growers);
  };
}

